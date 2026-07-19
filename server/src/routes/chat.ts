import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import { TIER_LIMITS } from '../lib/subscriptionLimits';
import type { PlanTier } from '@prisma/client';
import { webSearch } from '../lib/webSearch';
import { terraText, terraTextStream, terraJson, type TerraEffort } from '../lib/assistantModel';
import { generateContentPlan, type ContentPlanDTO, MAX_POSTS_PER_DAY, MAX_DAYS } from '../lib/contentPlanner';

const router = Router();

const HISTORY_LIMIT = 100; // messages fed to the model as context
const STORE_LIMIT   = 300; // messages kept per session in DB

// Daily assistant message caps per plan — cost protection, generous for normal use.
const CHAT_DAILY_LIMIT: Record<PlanTier, number> = { FREE: 0, STARTER: 50, CREATOR: 200, STUDIO_PRO: 500 };

/** Validates initData and resolves the DB user. Throws with a message on failure. */
async function authChatUser(initData: unknown): Promise<{ id: string; name: string | null }> {
  if (typeof initData !== 'string' || !initData.trim()) throw new Error('initData required');
  const parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  const dbUser = await prisma.user.findUnique({ where: { telegramId: String(parsed.user.id) }, select: { id: true, name: true } });
  if (!dbUser) throw new Error('User not found');
  return dbUser;
}

const sessionTitleFrom = (text: string) => text.trim().replace(/\s+/g, ' ').slice(0, 60);

/** One-time lazy migration: wraps a user's legacy session-less messages into a single session. */
async function adoptLegacyMessages(userId: string): Promise<void> {
  const orphan = await prisma.chatMessage.findFirst({ where: { userId, sessionId: null }, select: { id: true } });
  if (!orphan) return;
  const firstUserMsg = await prisma.chatMessage.findFirst({ where: { userId, sessionId: null, role: 'user' }, orderBy: { createdAt: 'asc' }, select: { content: true } });
  const session = await prisma.chatSession.create({ data: { userId, title: firstUserMsg ? sessionTitleFrom(firstUserMsg.content) : 'Прежний диалог' } });
  await prisma.chatMessage.updateMany({ where: { userId, sessionId: null }, data: { sessionId: session.id } });
}

/** Retitles sessions still carrying a placeholder name from their first user message. */
async function retitlePlaceholderSessions(userId: string): Promise<void> {
  const placeholders = await prisma.chatSession.findMany({ where: { userId, title: { in: ['Прежний диалог', 'Новый чат'] } }, select: { id: true } });
  for (const s of placeholders) {
    const firstUserMsg = await prisma.chatMessage.findFirst({ where: { sessionId: s.id, role: 'user' }, orderBy: { createdAt: 'asc' }, select: { content: true } });
    if (firstUserMsg) await prisma.chatSession.update({ where: { id: s.id }, data: { title: sessionTitleFrom(firstUserMsg.content) } }).catch(() => undefined);
  }
}

// ─── Chat sessions ────────────────────────────────────────────────────────────

router.get('/sessions', async (req: Request, res: Response): Promise<void> => {
  let user;
  try { user = await authChatUser((req.query as { initData?: string }).initData); }
  catch (err) { res.status(401).json({ error: (err as Error).message }); return; }
  await adoptLegacyMessages(user.id).catch(() => undefined);
  await retitlePlaceholderSessions(user.id).catch(() => undefined);
  const sessions = await prisma.chatSession.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: { id: true, title: true, channelId: true, updatedAt: true },
  });
  res.json({ sessions });
});

router.post('/sessions', async (req: Request, res: Response): Promise<void> => {
  const { initData, channelId } = req.body as { initData?: unknown; channelId?: unknown };
  let user;
  try { user = await authChatUser(initData); }
  catch (err) { res.status(401).json({ error: (err as Error).message }); return; }
  const session = await prisma.chatSession.create({
    data: { userId: user.id, channelId: typeof channelId === 'string' && channelId ? channelId : null },
    select: { id: true, title: true, channelId: true, updatedAt: true },
  });
  res.status(201).json({ session });
});

router.delete('/sessions/:sessionId', async (req: Request, res: Response): Promise<void> => {
  let user;
  try { user = await authChatUser((req.query as { initData?: string }).initData ?? (req.body as { initData?: unknown })?.initData); }
  catch (err) { res.status(401).json({ error: (err as Error).message }); return; }
  const session = await prisma.chatSession.findFirst({ where: { id: req.params['sessionId'], userId: user.id }, select: { id: true } });
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  await prisma.chatSession.delete({ where: { id: session.id } }); // messages cascade
  res.json({ ok: true });
});

/**
 * Search decision: a cheap low-effort Terra call decides whether answering
 * needs a fresh web search, and with what query. Replaces the old behavior of
 * force-searching EVERY message (cost + latency on "спасибо"-grade replies).
 * On classifier failure falls back to searching the user's literal words —
 * over-searching is safer than hallucinating.
 */
async function decideSearchBlock(message: string, history: { role: string; content: string }[], currentYear: number): Promise<string> {
  const trimmed = message.trim();
  if (trimmed.length < 6) return '';
  const recent = history.slice(-4).map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content.slice(0, 300)}`).join('\n');
  const decision = await terraJson({
    system:
      `Decide if answering the user's LATEST message needs a fresh web search (recent events, news, prices, stats, "latest", current facts, anything after the model's training cutoff). ` +
      `Chit-chat, editing requests, rewrites of earlier text, brainstorming on evergreen topics need NO search. ` +
      `If search is needed, build ONE focused query preserving the user's specifics (names, places), using the year ${currentYear} when time-relevant. ` +
      `Return ONLY JSON: {"query":"<query, or empty string when no search needed>"}`,
    prompt: (recent ? `Conversation so far:\n${recent}\n\n` : '') + `LATEST user message: ${trimmed.slice(0, 600)}`,
    maxTokens: 120,
    effort: 'low',
    noFallback: true,
    timeoutMs: 30_000,
  });
  let query: string | null = null;
  if (decision) {
    query = typeof decision['query'] === 'string' && decision['query'].trim() ? decision['query'].trim().slice(0, 400) : '';
  } else {
    query = trimmed.slice(0, 400); // classifier down → literal search, as before
  }
  if (!query) return '';
  const results = await webSearch(query);
  if (results) return `\n\nWEB SEARCH RESULTS (current facts fetched for you — base any recent/real-world answer ONLY on these, cite briefly):\n${results}\n`;
  return '';
}

/**
 * Deterministic content-plan intent detector — a cheap Terra JSON classifier
 * over the conversation (models narrate "building the plan" instead of acting,
 * so the server decides). Only fires `ready` when the user is clearly asking to
 * BUILD a multi-post series AND topic + postsPerDay + days + startDate + times
 * are all known. Returns null when not ready or on error.
 */
interface PlanIntent {
  topic: string; postsPerDay: number; days: number; startDate: string;
  source: 'web' | 'uploads' | 'both'; rubricHint?: string; times: string[];
}
async function detectPlanIntent(
  history: { role: string; content: string }[],
  message: string,
  todayISO: string,
): Promise<PlanIntent | null> {
  const transcript = [...history.slice(-12), { role: 'user', content: message }]
    .map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
    .join('\n');

  const system =
    `Today is ${todayISO}. You decide whether the user is confirming that they want to BUILD a SERIES of multiple posts ` +
    `(a mini-course / multi-day content plan) to be scheduled — and whether enough is known to build it right now.\n` +
    `Return ONLY JSON: {"ready":bool,"topic":str,"postsPerDay":int,"days":int,"startDate":"YYYY-MM-DD","times":["HH:MM"],"source":"web|uploads|both","rubricHint":str}.\n` +
    `Set ready=true ONLY if ALL of these are known from the conversation: the topic, how many posts per day, over how many days (derive days from a total like "7 posts, 1/day" = 7 days), a start date, AND the publish time(s) of day. Resolve relative dates ("с 13 июля", "послезавтра") against today into an absolute YYYY-MM-DD.\n` +
    `"times": the daily publish times the user asked for, as "HH:MM" 24h (e.g. ["10:00"] or ["10:00","18:00"] for 2/day). If the user has NOT specified a posting time yet, set ready=false — the assistant must ask for it first. Interpret "утром"≈09:00, "днём"≈13:00, "вечером"≈19:00.\n` +
    `Set ready=false if the user is still asking questions, brainstorming, wants a single post, or any of topic/postsPerDay/days/startDate/times is missing. When ready=false the other fields are ignored.\n` +
    `IMPORTANT: only use parameters the user has given for the CURRENT request. If the latest request is a NEW series and the user hasn't restated the start date / time / cadence for it, set ready=false and let the assistant ask — do NOT silently reuse details from an earlier, already-built plan in the history.\n` +
    `source: "web" for internet research, "uploads" for the user's own documents, "both". Default "web". rubricHint: a category name if the user named one, else "".`;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = await terraJson({ system, prompt: transcript, maxTokens: 250, effort: 'low', noFallback: true, timeoutMs: 30_000 }) as any;
    if (!p || p.ready !== true) return null;
    const topic = typeof p.topic === 'string' ? p.topic.trim() : '';
    const postsPerDay = Number(p.postsPerDay);
    const days = Number(p.days);
    const startDate = typeof p.startDate === 'string' ? p.startDate : '';
    const times = Array.isArray(p.times)
      ? p.times.filter((t: unknown): t is string => typeof t === 'string' && /^\d{1,2}(:\d{1,2})?$/.test(t.trim())).map((t: string) => t.trim())
      : [];
    // Time is required — without it we won't build (the assistant should ask).
    if (!topic || !Number.isFinite(postsPerDay) || !Number.isFinite(days)
      || !/^\d{4}-\d{2}-\d{2}/.test(startDate) || times.length === 0) return null;
    return {
      topic, postsPerDay, days, startDate, times,
      source: p.source === 'uploads' || p.source === 'both' ? p.source : 'web',
      rubricHint: typeof p.rubricHint === 'string' && p.rubricHint.trim() ? p.rubricHint.trim() : undefined,
    };
  } catch {
    return null;
  }
}

// ─── GET /api/chat/history ────────────────────────────────────────────────────
// Returns the user's full chat history (oldest → newest).
// Query: { initData }

router.get('/history', async (req: Request, res: Response): Promise<void> => {
  const { initData, sessionId, channelId } = req.query as { initData?: string; sessionId?: string; channelId?: string };
  let user;
  try { user = await authChatUser(initData); }
  catch (err) { res.status(401).json({ error: (err as Error).message }); return; }

  await adoptLegacyMessages(user.id).catch(() => undefined);

  // Resolve which session to show: explicit id → that one; otherwise the most
  // recently used session (preferring the active channel's), if any.
  let session = null;
  if (sessionId?.trim()) {
    session = await prisma.chatSession.findFirst({ where: { id: sessionId, userId: user.id }, select: { id: true } });
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  } else {
    if (channelId?.trim()) session = await prisma.chatSession.findFirst({ where: { userId: user.id, channelId }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
    if (!session) session = await prisma.chatSession.findFirst({ where: { userId: user.id }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
  }
  if (!session) { res.json({ sessionId: null, messages: [] }); return; }

  // Newest STORE_LIMIT messages, returned oldest → newest.
  const history = (await prisma.chatMessage.findMany({
    where:   { sessionId: session.id },
    orderBy: { createdAt: 'desc' },
    take:    STORE_LIMIT,
    select:  { role: true, content: true },
  })).reverse();

  res.json({ sessionId: session.id, messages: history });
});

// ─── POST /api/chat ───────────────────────────────────────────────────────────
// Sends the latest user message to DeepSeek using full DB history as context.
// Saves both the user message and the AI reply to DB.
// Request body: { initData, channelId, message: string }
// Response 200: { reply: string }

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { initData, channelId, message, sessionId, stream } = req.body as {
    initData?:  unknown;
    channelId?: unknown;
    message?:   unknown;
    sessionId?: unknown;
    stream?:    unknown;
  };

  // SSE mode: `stream: true` switches the response to text/event-stream with
  // {type:'chunk'|'done'|'error'} events. Pre-generation errors (auth, quota)
  // still return plain JSON — the client checks the content type.
  const wantStream = stream === true;
  let sseStarted = false;
  const sseSend = (payload: Record<string, unknown>) => {
    if (!sseStarted) {
      sseStarted = true;
      res.writeHead(200, {
        'Content-Type':      'text/event-stream; charset=utf-8',
        'Cache-Control':     'no-cache, no-transform',
        'Connection':        'keep-alive',
        'X-Accel-Buffering': 'no',
      });
    }
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  if (typeof channelId !== 'string' || !channelId.trim()) { res.status(400).json({ error: 'channelId required' }); return; }
  if (typeof message   !== 'string' || !message.trim())   { res.status(400).json({ error: 'message required' });   return; }

  let dbUser;
  try { dbUser = await authChatUser(initData); }
  catch (err) { res.status(401).json({ error: (err as Error).message }); return; }

  // Resolve the target session: an owned existing one, or a fresh session
  // titled after the first message.
  let session = typeof sessionId === 'string' && sessionId.trim()
    ? await prisma.chatSession.findFirst({ where: { id: sessionId, userId: dbUser.id }, select: { id: true, title: true } })
    : null;
  if (!session) {
    session = await prisma.chatSession.create({
      data: { userId: dbUser.id, channelId, title: message.trim().replace(/\s+/g, ' ').slice(0, 60) },
      select: { id: true, title: true },
    });
  }

  // Gate the AI assistant by plan tier — FREE has no access.
  const sub = await prisma.subscription.findUnique({
    where:  { userId: dbUser.id },
    select: { tier: true, modelTier: true },
  }).catch(() => null);
  const tier = sub?.tier ?? 'FREE';
  const modelTier: 'LOW' | 'HIGH' = sub?.modelTier ?? 'LOW';
  const canPlan = TIER_LIMITS[tier].canUseContentManager; // AI content-series manager (CREATOR+)
  if (!TIER_LIMITS[tier].canUseAiAssistant) {
    res.status(403).json({ error: 'AI ассистент доступен на тарифе Starter и выше.', code: 'UPGRADE_REQUIRED' });
    return;
  }

  if (!env.REPLICATE_API_TOKEN && !env.DEEPSEEK_API_KEY) { res.status(503).json({ error: 'AI not configured' }); return; }

  // Daily message quota (cost protection). Day boundary = midnight MSK.
  const dailyLimit = CHAT_DAILY_LIMIT[tier] ?? 0;
  const mskTodayISO = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  const mskMidnight = new Date(`${mskTodayISO}T00:00:00+03:00`);
  const usedToday = await prisma.chatMessage.count({ where: { userId: dbUser.id, role: 'user', createdAt: { gte: mskMidnight } } }).catch(() => 0);
  if (usedToday >= dailyLimit) {
    res.status(429).json({ error: `Дневной лимит сообщений ассистента (${dailyLimit}) исчерпан — обнулится в полночь по МСК.`, code: 'CHAT_LIMIT' });
    return;
  }

  // One model (GPT-5.6 Terra), tiered by thinking depth.
  const effort: TerraEffort = tier === 'STUDIO_PRO' || modelTier === 'HIGH' ? 'high' : tier === 'CREATOR' ? 'medium' : 'low';

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
        brandKit: { select: { channelAbout: true, voiceProfile: true, postRules: true, visualKit: true } },
      },
    }).catch(() => []),
  ]);

  if (!activeChannel || activeChannel.userId !== dbUser.id) {
    res.status(403).json({ error: 'Channel not found or access denied' }); return;
  }

  // Model context: the newest HISTORY_LIMIT messages of THIS session, oldest → newest.
  const history = (await prisma.chatMessage.findMany({
    where:   { sessionId: session.id },
    orderBy: { createdAt: 'desc' },
    take:    HISTORY_LIMIT,
    select:  { role: true, content: true },
  })).reverse();

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
    if (bk?.visualKit && typeof bk.visualKit === 'object') {
      const vk = bk.visualKit as Record<string, unknown>;
      if (typeof vk['coverBgStyle'] === 'string' && vk['coverBgStyle'] !== 'auto')
        lines.push('  Required image style: ' + vk['coverBgStyle']);
      if (typeof vk['coverBgDetail'] === 'string')
        lines.push('  Image detail: ' + vk['coverBgDetail']);
      if (typeof vk['visualCoverStyle'] === 'string' && vk['visualCoverStyle'].trim())
        lines.push('  Visual style guide: ' + vk['visualCoverStyle'].trim().replace(/\s+/g, ' ').slice(0, 600));
      if (Array.isArray(vk['brandColors'])) {
        const colors = (vk['brandColors'] as unknown[]).slice(0, 5).flatMap(item => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const color = item as Record<string, unknown>;
          const hex = typeof color['hex'] === 'string' ? color['hex'] : '';
          if (!/^#[0-9a-f]{6}$/i.test(hex)) return [];
          const name = typeof color['name'] === 'string' ? color['name'].trim().slice(0, 50) : '';
          return [(name ? name + ' ' : '') + hex];
        });
        if (colors.length) lines.push('  Brand colors: ' + colors.join(', '));
      }
      if (Array.isArray(vk['references'])) {
        const refs = (vk['references'] as unknown[]).slice(0, 5).flatMap(item => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const description = (item as Record<string, unknown>)['description'];
          return typeof description === 'string' && description.trim()
            ? [description.trim().replace(/\s+/g, ' ').slice(0, 240)]
            : [];
        });
        if (refs.length) lines.push('  Visual references: ' + refs.join(' | '));
      }
      if (Array.isArray(vk['avoidList'])) {
        const avoid = (vk['avoidList'] as unknown[])
          .flatMap(item => typeof item === 'string' && item.trim() ? [item.trim().slice(0, 100)] : [])
          .slice(0, 12);
        if (avoid.length) lines.push('  Avoid in images: ' + avoid.join(', '));
      }
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
    `\nPANORAMA PROMPTS: When the user asks for a prompt for Publium image slicing, determine one of three existing gallery options: horizontal swipe carousel, vertical stack, or 4x4 modular composition. For horizontal or vertical mode, determine the segment count (2-8) and ask briefly if required information is missing. Return one ready-to-paste image prompt in English, while any explanation stays in the user's language. Horizontal and vertical prompts must describe ONE seamless continuous scene, never a collage or separate panels: use a left-to-right journey for horizontal and a top-to-bottom journey for vertical; state the segment count, put a meaningful focal detail in every segment, keep faces, hands, and key objects away from cut lines, and bridge seams with background, light, paths, or motion. For 4x4 mode, write only the visual request for ONE square source image containing exactly four complete synchronized variants side by side. Never mention a grid, 4x4 matrix, sixteen tiles, slicing, cut lines, connectors, coordinates, guides, technical bands, or body-part modules inside the ready-to-paste image prompt because the image model may draw them. Never assume a fixed subject type: the four variants may be environments, seasons, interfaces, products, objects, outfits, living subjects, abstract scenes, or anything else. Infer the intended difference between the variants, while requiring identical camera, crop, perspective, scale, layout, major geometry, horizon, visual anchors, and spatial relationships. Require useful content throughout the full canvas height and no excessive empty space. If the user explicitly requests labels, include only those exact labels once above or near the corresponding variants; otherwise prohibit all text. Always prohibit visible separators, borders, gutters, technical annotations, pseudo-text, logos, and watermarks. In every mode require the active channel BrandKit art direction, palette, detail, and mood.\n` +
    `Tailor all advice to the active channel's BrandKit style and audience.\n` +
    `If the user asks about a different channel, switch context accordingly.\n` +
    `Always respond in the same language the user writes in.\n` +
    `CRITICAL ANTI-HALLUCINATION RULE: never invent or guess facts, news, events, dates, places, names, quotes, numbers, or outcomes. ` +
    `For any question about real-world or recent events, rely ONLY on a "WEB SEARCH RESULTS" block. ` +
    `If there is no such block, or it does not actually contain the answer, say plainly that you can't confirm it (and offer to look it up) — do NOT fabricate a plausible-sounding answer.\n` +
    (canSearch
      ? `If a "WEB SEARCH RESULTS" block appears in the conversation, it holds current information fetched for you — base any time-sensitive or factual answer ONLY on it and briefly mention the sources, building reasoning around the year ${currentYear}. If no such block is present and the question depends on very recent events, say you can't confirm and offer to look it up — never guess.\n`
      : '') +
    (canPlan
      ? `\nCONTENT MANAGER: The system can build a whole SERIES of posts (a mini-course, a themed multi-day plan) and drop them into the user's Отложка (scheduler). When the user asks for a series/mini-course/content-plan of MULTIPLE posts, do NOT write the posts yourself in chat. ` +
        `Your only job is to collect the missing details — ask brief CLARIFYING questions in one message: from which day to start the schedule (so they have time to review before posts go out), **at what time of day to publish** (e.g. 10:00, or 10:00 and 18:00 for two a day), how many posts per day and over how many days (max ${MAX_POSTS_PER_DAY}/day, ${MAX_DAYS} days), the sources (web research / uploaded project docs / both), and a preferred rubric if any. Do NOT invent a posting time — ask the user. ` +
        `Once every detail is known, the system builds the plan AUTOMATICALLY and shows the user a plan card with a «Приступить» button — you never list the posts yourself.\n`
      : '') +
    `Be concise, practical, and creative. Give actionable advice.`;

  try {
    let reply = '';
    let pendingPlan: ContentPlanDTO | null = null; // set when a content-series plan is built

    // ── Deterministic content-plan path (CREATOR+) ────────────────────────────
    // Decided server-side with a cheap Terra classifier — models narrate
    // "building the plan" instead of acting, so the server acts itself.
    if (canPlan) {
      const todayISO = now.toLocaleDateString('en-CA', { timeZone: MSK_TZ }); // YYYY-MM-DD (MSK)
      const intent = await detectPlanIntent(history, message, todayISO).catch(() => null);
      if (intent) {
        try {
          pendingPlan = await generateContentPlan({
            channelId,
            topic:       intent.topic,
            postsPerDay: intent.postsPerDay,
            days:        intent.days,
            startDate:   new Date(intent.startDate),
            source:      intent.source,
            rubricHint:  intent.rubricHint,
            times:       intent.times,
          });
          reply = `Готово — собрал план на ${pendingPlan.totalPosts} ${pendingPlan.totalPosts === 1 ? 'пост' : 'постов'} по теме «${pendingPlan.topic}». Проверь карточку ниже и нажми «Приступить» — я разложу их в Отложку.`;
        } catch (err) {
          console.error('[chat] plan build failed:', (err as Error).message);
          // Fall through to the normal reply (the assistant keeps clarifying).
        }
      }
    }

    // ── Terra reply ───────────────────────────────────────────────────────────
    // Search is decided (not forced), results are injected into the flattened
    // conversation, and one Terra call produces the answer. terraText falls
    // back to a single DeepSeek completion only if Replicate is down.
    let streamedAny = false;
    if (!reply) {
      const searchBlock = canSearch ? await decideSearchBlock(message, history, currentYear).catch(() => '') : '';
      const convo = history.map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`).join('\n\n');
      const prompt = `${convo ? convo + '\n\n' : ''}${searchBlock}User: ${message}\n\nAssistant:`;
      const out = wantStream
        ? await terraTextStream({ system: systemPrompt, prompt, maxTokens: 1024, effort, timeoutMs: 120_000 }, delta => { streamedAny = true; sseSend({ type: 'chunk', text: delta }); })
        : await terraText({ system: systemPrompt, prompt, maxTokens: 1024, effort, timeoutMs: 90_000 });
      if (out) reply = out;
    }

    if (!reply) reply = 'Не удалось получить ответ. Попробуй переформулировать.';

    // Save user + final assistant reply to DB (non-fatal). Intermediate tool
    // turns are not persisted — history stays a clean {role, content} log.
    const sessionRef = session;
    prisma.chatMessage.createMany({
      data: [
        { userId: dbUser.id, sessionId: sessionRef.id, role: 'user',      content: message },
        { userId: dbUser.id, sessionId: sessionRef.id, role: 'assistant', content: reply   },
      ],
    }).then(() =>
      prisma.chatSession.update({ where: { id: sessionRef.id }, data: { channelId } }).catch(() => undefined),
    ).catch(err => console.error('[chat] DB save failed:', (err as Error).message));

    // Trim: keep the newest STORE_LIMIT messages of the session, drop the oldest.
    prisma.chatMessage.findMany({
      where:   { sessionId: sessionRef.id },
      orderBy: { createdAt: 'desc' },
      skip:    STORE_LIMIT,
      select:  { id: true },
    }).then(old => {
      if (old.length > 0) {
        prisma.chatMessage.deleteMany({ where: { id: { in: old.map(m => m.id) } } }).catch(() => {});
      }
    }).catch(() => {});

    if (wantStream) {
      // Plan replies and fallback texts were never streamed — emit them whole.
      if (!streamedAny) sseSend({ type: 'chunk', text: reply });
      sseSend({ type: 'done', sessionId: sessionRef.id, ...(pendingPlan ? { plan: pendingPlan } : {}) });
      res.end();
    } else {
      res.json({ reply, sessionId: sessionRef.id, ...(pendingPlan ? { plan: pendingPlan } : {}) });
    }

  } catch (err) {
    console.error('[chat] Error:', (err as Error).message);
    if (sseStarted) {
      try { sseSend({ type: 'error', error: 'AI request failed' }); res.end(); } catch { /* connection gone */ }
    } else {
      res.status(502).json({ error: 'AI request failed' });
    }
  }
});

export default router;
