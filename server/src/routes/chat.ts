import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import { TIER_LIMITS } from '../lib/subscriptionLimits';
import { webSearch } from '../lib/webSearch';
import { replicateText } from '../lib/replicateText';

const router = Router();

const HISTORY_LIMIT = 100; // messages kept per user

/**
 * HIGH-tier chat reply: Claude on Replicate. Replicate's text API has no
 * OpenAI-style tool-calling, so we run an optional Tavily search ourselves
 * first (a cheap DeepSeek call decides the query) and inject the results into
 * the prompt. Returns the reply text, or null to fall back to the DeepSeek loop.
 */
async function generateHighChatReply(opts: {
  systemPrompt: string;
  history:      { role: string; content: string }[];
  message:      string;
  canSearch:    boolean;
  currentYear:  number;
}): Promise<string | null> {
  const { systemPrompt, history, message, canSearch, currentYear } = opts;

  // 1. Optional web search — a cheap DeepSeek JSON call decides the query.
  let searchBlock = '';
  if (canSearch && env.DEEPSEEK_API_KEY) {
    try {
      const decideRes = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}` },
        body: JSON.stringify({
          model:           env.DEEPSEEK_MODEL,
          response_format: { type: 'json_object' },
          max_tokens:      80,
          temperature:     0.1,
          messages: [
            { role: 'system', content: `Decide if answering the user needs a fresh web search (recent events, news, prices, "latest", current facts). If yes, return a focused query using the year ${currentYear} when time-relevant. Return ONLY JSON: {"query":"<query or empty string>"}` },
            { role: 'user', content: message },
          ],
        }),
      });
      if (decideRes.ok) {
        const d = await decideRes.json() as { choices?: { message?: { content?: string } }[] };
        const q = JSON.parse(d.choices?.[0]?.message?.content ?? '{}')?.query;
        if (typeof q === 'string' && q.trim()) {
          const results = await webSearch(q.trim());
          if (results) searchBlock = `\n\nWEB SEARCH RESULTS (use for current facts; cite briefly):\n${results}\n`;
        }
      }
    } catch { /* non-fatal — answer without search */ }
  }

  // 2. Flatten the conversation into a single prompt for Claude on Replicate.
  const convo = history
    .map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
    .join('\n\n');
  const prompt = `${convo ? convo + '\n\n' : ''}${searchBlock}User: ${message}\n\nAssistant:`;

  return replicateText({
    model:        env.HIGH_TEXT_MODEL,
    systemPrompt,
    prompt,
    maxTokens:    1024,
    temperature:  0.6,
    timeoutMs:    90_000,
  });
}

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
    select: { tier: true, modelTier: true },
  }).catch(() => null);
  const tier = sub?.tier ?? 'FREE';
  const modelTier: 'LOW' | 'HIGH' = sub?.modelTier ?? 'LOW';
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

  // Anchor the model to the real current date. Without this it falls back to its
  // training cutoff and gets the year/month wrong — and builds web_search queries
  // for the wrong year (e.g. returning last edition of a tournament).
  const now = new Date();
  const MSK_TZ = 'Europe/Moscow';
  const todayLine = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: MSK_TZ,
  });
  const currentYear = Number(now.toLocaleDateString('en-US', { year: 'numeric', timeZone: MSK_TZ }));

  const systemPrompt =
    `You are a personal AI content assistant inside the "Publium" Telegram Mini App.\n` +
    (userName ? `You are talking with ${userName}.\n` : '') +
    `\nCURRENT DATE: today is ${todayLine} (Moscow time, MSK). The current year is ${currentYear}. ` +
    `This is the single source of truth for the date — use it for anything about "today", "now", "current", "this year", or "this season". ` +
    `Do NOT rely on your own memory for the date; your training data is older than today.\n` +
    `\nThe user manages ${allChannels.length} Telegram channel(s). Currently active: ${activeLabel}.\n` +
    `\nAll connected channels and their styles:\n${channelsSummary}\n` +
    `\nYou help with: content ideas, post drafts, image prompts, content strategy, audience engagement, post editing.\n` +
    `Tailor all advice to the active channel's BrandKit style and audience.\n` +
    `If the user asks about a different channel, switch context accordingly.\n` +
    `Always respond in the same language the user writes in.\n` +
    (canSearch
      ? (modelTier === 'HIGH'
          ? `If a "WEB SEARCH RESULTS" block appears in the conversation, it holds current information fetched for you — base any time-sensitive or factual answer on it and briefly mention the sources, building reasoning around the year ${currentYear}. If no such block is present and the question depends on very recent events, answer from your knowledge and note any uncertainty rather than guessing.\n`
          : `You have a web_search tool. You do NOT inherently know anything that happened after your training cutoff, including recent or live events. ` +
            `For ANYTHING time-sensitive or factual — sports fixtures/scores, news, prices, "what is happening now", recent statistics, "latest" anything — you MUST call web_search before answering, and you MUST build the query using the current year ${currentYear} (e.g. "FIFA World Cup ${currentYear} schedule") rather than a year from memory. ` +
            `Never answer such questions from memory. After searching, answer in your own words and briefly mention the sources. If the search returns nothing useful, say so plainly instead of guessing.\n`)
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
    let reply = '';

    // HIGH tier: Claude on Replicate, with an optional manual Tavily pre-search
    // (Replicate's text API has no tool-calling). Falls through to the DeepSeek
    // tool-loop below if it yields nothing.
    if (modelTier === 'HIGH' && env.REPLICATE_API_TOKEN) {
      const high = await generateHighChatReply({ systemPrompt, history, message, canSearch, currentYear });
      if (high && high.trim()) reply = high.trim();
    }

    // LOW (or HIGH fallback): up to 3 turns; the model may call web_search and
    // we feed the results back before it produces the final answer.
    for (let step = 0; !reply && step < 3; step++) {
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
