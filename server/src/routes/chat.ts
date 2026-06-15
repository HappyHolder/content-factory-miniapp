import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import { TIER_LIMITS } from '../lib/subscriptionLimits';
import { webSearch } from '../lib/webSearch';

const router = Router();

const HISTORY_LIMIT = 100; // messages kept per user

// ─── GET /api/chat/history ────────────────────────────────────────────────────
// Returns the user's full chat history (oldest → newest).
// Query: { initData }

router.get('/history', async (req: Request, res: Response): Promise<void> => {
  const { initData } = req.query as { initData?: string };
  if (!initData?.trim()) { res.status(400).json({ error: 'initData required' }); return; }

  let parsed;
  try { parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN); }
  catch { res.status(401).json({ error: 'Invalid initData' }); return; }

  const telegramId = String(parsed.user.id);
  const dbUser = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } }).catch(() => null);
  if (!dbUser) { res.status(401).json({ error: 'User not found' }); return; }

  const history = await prisma.chatMessage.findMany({
    where:   { userId: dbUser.id },
    orderBy: { createdAt: 'asc' },
    take:    HISTORY_LIMIT,
    select:  { role: true, content: true },
  });

  res.json({ messages: history });
});

// ─── POST /api/chat ───────────────────────────────────────────────────────────
// Sends the latest user message to DeepSeek using full DB history as context.
// Saves both the user message and the AI reply to DB.
// Request body: { initData, channelId, message: string }
// Response 200: { reply: string }

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { initData, channelId, message } = req.body as {
    initData?:  unknown;
    channelId?: unknown;
    message?:   unknown;
  };

  if (typeof initData  !== 'string' || !initData.trim())  { res.status(400).json({ error: 'initData required' });  return; }
  if (typeof channelId !== 'string' || !channelId.trim()) { res.status(400).json({ error: 'channelId required' }); return; }
  if (typeof message   !== 'string' || !message.trim())   { res.status(400).json({ error: 'message required' });   return; }

  let parsed;
  try { parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN); }
  catch (err) { res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return; }

  const telegramId = String(parsed.user.id);
  const dbUser = await prisma.user.findUnique({
    where:  { telegramId },
    select: { id: true, name: true },
  }).catch(() => null);
  if (!dbUser) { res.status(401).json({ error: 'User not found' }); return; }

  // Gate the AI assistant by plan tier — FREE has no access.
  const sub = await prisma.subscription.findUnique({
    where:  { userId: dbUser.id },
    select: { tier: true },
  }).catch(() => null);
  const tier = sub?.tier ?? 'FREE';
  if (!TIER_LIMITS[tier].canUseAiAssistant) {
    res.status(403).json({ error: 'AI ассистент доступен на тарифе Starter и выше.', code: 'UPGRADE_REQUIRED' });
    return;
  }

  if (!env.DEEPSEEK_API_KEY) { res.status(503).json({ error: 'AI not configured' }); return; }

  const [activeChannel, allChannels] = await Promise.all([
    prisma.channel.findUnique({
      where:  { id: channelId },
      select: { id: true, handle: true, name: true, userId: true },
    }).catch(() => null),
    prisma.channel.findMany({
      where:   { userId: dbUser.id },
      orderBy: { createdAt: 'asc' },
      select:  {
        id: true, handle: true, name: true,
        brandKit: { select: { channelAbout: true, voiceProfile: true, postRules: true } },
      },
    }).catch(() => []),
  ]);

  if (!activeChannel || activeChannel.userId !== dbUser.id) {
    res.status(403).json({ error: 'Channel not found or access denied' }); return;
  }

  // Load existing history from DB
  const history = await prisma.chatMessage.findMany({
    where:   { userId: dbUser.id },
    orderBy: { createdAt: 'asc' },
    take:    HISTORY_LIMIT,
    select:  { role: true, content: true },
  });

  // Build system prompt
  const userName    = dbUser.name?.trim() || null;
  const activeLabel = activeChannel.handle ? `@${activeChannel.handle}` : activeChannel.name;

  function brandKitLines(bk: typeof allChannels[number]['brandKit']): string[] {
    const lines: string[] = [];
    if (bk?.channelAbout && typeof bk.channelAbout === 'object') {
      const a = bk.channelAbout as Record<string, unknown>;
      if (typeof a['topic']          === 'string' && a['topic'])          lines.push(`  Topic: ${a['topic']}`);
      if (typeof a['targetAudience'] === 'string' && a['targetAudience']) lines.push(`  Audience: ${a['targetAudience']}`);
      if (typeof a['contentGoal']    === 'string' && a['contentGoal'])    lines.push(`  Goal: ${a['contentGoal']}`);
    }
    if (bk?.voiceProfile && typeof bk.voiceProfile === 'object') {
      const vp = bk.voiceProfile as Record<string, unknown>;
      if (typeof vp['tone']       === 'string' && vp['tone'])       lines.push(`  Tone: ${vp['tone']}`);
      if (typeof vp['language']   === 'string' && vp['language'])   lines.push(`  Language: ${vp['language']}`);
      if (typeof vp['authorRole'] === 'string' && vp['authorRole']) lines.push(`  Author role: ${vp['authorRole']}`);
      if (typeof vp['postLength'] === 'string' && vp['postLength']) lines.push(`  Post length: ${vp['postLength']}`);
    }
    if (bk?.voiceProfile && typeof bk.voiceProfile === 'object') {
      const vp = bk.voiceProfile as Record<string, unknown>;
      if (typeof vp['customNote'] === 'string' && vp['customNote'].trim())
        lines.push(`  Owner guidance (text): ${vp['customNote'].trim()}`);
    }
    if (bk?.postRules && typeof bk.postRules === 'object') {
      const pr = bk.postRules as Record<string, unknown>;
      if (typeof pr['defaultStructure'] === 'string' && pr['defaultStructure'])
        lines.push(`  Structure: ${pr['defaultStructure']}`);
      if (typeof pr['customNote'] === 'string' && pr['customNote'].trim())
        lines.push(`  Owner guidance (format): ${pr['customNote'].trim()}`);
    }
    return lines;
  }

  const channelsSummary = allChannels.map(ch => {
    const label = ch.handle ? `@${ch.handle}` : ch.name;
    const isActive = ch.id === channelId;
    const lines = brandKitLines(ch.brandKit);
    return `${isActive ? '▶ ' : '  '}${label}${isActive ? ' (currently active)' : ''}\n` +
           (lines.length > 0 ? lines.join('\n') : '  (no BrandKit configured)');
  }).join('\n\n');

  const canSearch = !!env.TAVILY_API_KEY;

  const systemPrompt =
    `You are a personal AI content assistant inside the "Publium" Telegram Mini App.\n` +
    (userName ? `You are talking with ${userName}.\n` : '') +
    `\nThe user manages ${allChannels.length} Telegram channel(s). Currently active: ${activeLabel}.\n` +
    `\nAll connected channels and their styles:\n${channelsSummary}\n` +
    `\nYou help with: content ideas, post drafts, image prompts, content strategy, audience engagement, post editing.\n` +
    `Tailor all advice to the active channel's BrandKit style and audience.\n` +
    `If the user asks about a different channel, switch context accordingly.\n` +
    `Always respond in the same language the user writes in.\n` +
    (canSearch
      ? `You can search the web with the web_search tool for fresh or factual information (news, prices, recent events, statistics). Use it when the user asks about something current or you are not sure of a fact, then answer in your own words and briefly mention the sources.\n`
      : '') +
    `Be concise, practical, and creative. Give actionable advice.`;

  // Web-search tool, only offered when Tavily is configured.
  const tools = canSearch ? [{
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for up-to-date or factual information. Returns a short summary and the top results with title, URL and snippet.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: "Search query, ideally in the user's language" },
        },
        required: ['query'],
      },
    },
  }] : undefined;

  // Conversation buffer for the tool-use loop. Typed loosely because assistant /
  // tool turns carry extra fields (tool_calls, tool_call_id) beyond {role, content}.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: message },
  ];

  async function callModel() {
    const response = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model:       env.DEEPSEEK_MODEL,
        messages,
        max_tokens:  1024,
        // 0.6 + top_p 0.9 — the assistant should stay grounded and factual;
        // 0.8 made it drift into confident nonsense on some answers.
        temperature: 0.6,
        top_p:       0.9,
        ...(tools ? { tools, tool_choice: 'auto' } : {}),
      }),
    });
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await response.json() as { choices?: { message?: any }[] };
    return data.choices?.[0]?.message ?? null;
  }

  try {
    // Up to 3 turns: the model may call web_search (we run it and feed the
    // results back) before producing the final answer.
    let reply = '';
    for (let step = 0; step < 3; step++) {
      const msg = await callModel();
      if (!msg) break;

      const toolCalls = msg.tool_calls as
        | { id: string; function: { name: string; arguments: string } }[]
        | undefined;

      if (toolCalls && toolCalls.length > 0) {
        messages.push(msg); // assistant turn carrying the tool calls
        for (const tc of toolCalls) {
          let result = 'No results found.';
          if (tc.function?.name === 'web_search') {
            let query = '';
            try { query = String(JSON.parse(tc.function.arguments || '{}').query ?? ''); } catch { /* ignore */ }
            result = (query && await webSearch(query)) || 'No results found.';
          }
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
        continue; // ask the model again with the tool results
      }

      reply = String(msg.content ?? '').trim();
      break;
    }

    if (!reply) reply = 'Не удалось получить ответ. Попробуй переформулировать.';

    // Save user + final assistant reply to DB (non-fatal). Intermediate tool
    // turns are not persisted — history stays a clean {role, content} log.
    prisma.chatMessage.createMany({
      data: [
        { userId: dbUser.id, role: 'user',      content: message },
        { userId: dbUser.id, role: 'assistant', content: reply   },
      ],
    }).catch(err => console.error('[chat] DB save failed:', (err as Error).message));

    // Trim old messages if over limit (keep newest HISTORY_LIMIT)
    prisma.chatMessage.findMany({
      where:   { userId: dbUser.id },
      orderBy: { createdAt: 'asc' },
      skip:    HISTORY_LIMIT,
      select:  { id: true },
    }).then(old => {
      if (old.length > 0) {
        prisma.chatMessage.deleteMany({ where: { id: { in: old.map(m => m.id) } } }).catch(() => {});
      }
    }).catch(() => {});

    res.json({ reply });

  } catch (err) {
    console.error('[chat] Error:', (err as Error).message);
    res.status(502).json({ error: 'AI request failed' });
  }
});

export default router;
