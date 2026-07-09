/**
 * contentPlanner.ts
 *
 * Builds a ContentPlan(DRAFT) + items for the AI content manager. Loads the
 * channel's BrandKit (topic/voice) and, when the source includes uploads, its
 * ProjectDoc texts, then asks DeepSeek for a cohesive N-item series (working
 * titles / angles / research queries). Rubrics are assigned in code (round-robin,
 * auto-creating one if the channel has none). Scheduling slots are spread across
 * the day. See docs/content-manager-plan.md.
 */

import { prisma } from '../db';
import { env } from '../env';

export const MAX_POSTS_PER_DAY = 5;
export const MAX_DAYS = 14;
export const MAX_TOTAL_POSTS = 30; // hard ceiling on one plan's size

export interface GenerateContentPlanParams {
  channelId: string;
  topic: string;
  postsPerDay: number;
  days: number;
  startDate: Date;
  source: 'web' | 'uploads' | 'both';
  rubricHint?: string;
  /** Publish times per day as "HH:MM" (MSK). One per post/day if given; when
   *  absent or short, the remaining slots are spread across 09–21. */
  times?: string[];
}

export interface ContentPlanItemDTO {
  id: string;
  orderIndex: number;
  scheduledAt: string;
  rubricId: string | null;
  rubricName: string | null;
  workingTitle: string;
  angle: string;
  searchQuery: string;
}

export interface ContentPlanDTO {
  id: string;
  channelId: string;
  topic: string;
  postsPerDay: number;
  days: number;
  startDate: string;
  source: string;
  status: string;
  totalPosts: number;
  items: ContentPlanItemDTO[];
}

interface Rubric { id: string; name: string; description?: string; mode?: string }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Real 'now' (Moscow) for date-anchoring — the models default to their training
 *  cutoff (2024/2025) otherwise, poisoning search queries and post facts. */
function todayContext(): { iso: string; year: string } {
  const iso = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' }); // YYYY-MM-DD
  return { iso, year: iso.slice(0, 4) };
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

/** Default hours-of-day for `n` posts, spread between 09:00 and 21:00. */
function dayHours(n: number): number[] {
  if (n <= 1) return [10];
  const start = 9, end = 21;
  const step = (end - start) / (n - 1);
  return Array.from({ length: n }, (_, i) => Math.round(start + i * step));
}

/** Parses "HH:MM" / "H" / "9:30" → {h, m}, clamped to a valid time, or null. */
function parseHHMM(s: string): { h: number; m: number } | null {
  const m = /^\s*(\d{1,2})(?::(\d{1,2}))?\s*$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] !== undefined ? Number(m[2]) : 0;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

/** Publish times-of-day for one day: honors the user's `times`, falling back to
 *  a 09–21 spread for any slots the user didn't specify. */
function slotTimes(postsPerDay: number, times?: string[]): { h: number; m: number }[] {
  const given = (times ?? []).map(parseHHMM).filter((t): t is { h: number; m: number } => t !== null);
  if (given.length >= postsPerDay) return given.slice(0, postsPerDay);
  if (given.length === 0) return dayHours(postsPerDay).map(h => ({ h, m: 0 }));
  // Some times given but fewer than needed — keep them, spread the rest.
  const result = [...given];
  for (const h of dayHours(postsPerDay)) {
    if (result.length >= postsPerDay) break;
    if (!result.some(r => r.h === h)) result.push({ h, m: 0 });
  }
  return result.sort((a, b) => a.h - b.h || a.m - b.m).slice(0, postsPerDay);
}

/** Produces `total` datetime slots starting at `startDate`, `postsPerDay` per day. */
function computeSlots(startDate: Date, days: number, postsPerDay: number, total: number, times?: string[]): Date[] {
  const daily = slotTimes(postsPerDay, times);
  const slots: Date[] = [];
  for (let d = 0; d < days && slots.length < total; d++) {
    for (const t of daily) {
      if (slots.length >= total) break;
      const dt = new Date(startDate);
      dt.setDate(dt.getDate() + d);
      dt.setHours(t.h, t.m, 0, 0);
      slots.push(dt);
    }
  }
  return slots;
}

// ─── Rubric resolution ────────────────────────────────────────────────────────

function slug(): string {
  return `rub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Resolves the rubric pool for the plan. If `rubricHint` is given, uses the
 * matching (or newly-created) single rubric for the whole series; otherwise
 * round-robins across existing rubrics — auto-creating a default one if none.
 * Persists any newly-created rubric back into visualKit.rubrics.
 */
async function resolveRubrics(
  channelId: string,
  visualKit: Record<string, unknown>,
  voiceProfile: Record<string, unknown>,
  rubricHint?: string,
): Promise<Rubric[]> {
  const existing: Rubric[] = Array.isArray(visualKit['rubrics'])
    ? (visualKit['rubrics'] as Rubric[]).filter(r => r && typeof r.id === 'string' && typeof r.name === 'string')
    : [];

  const lang = typeof voiceProfile['language'] === 'string' ? voiceProfile['language'] : '';
  const isRu = /ru|рус/i.test(lang) || !lang; // default to Russian for this audience

  const persist = async (rubrics: Rubric[]) => {
    const newVk = { ...visualKit, rubrics };
    await prisma.brandKit.upsert({
      where: { channelId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: { visualKit: newVk as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { channelId, visualKit: newVk as any },
    }).catch(() => {});
  };

  if (rubricHint && rubricHint.trim()) {
    const hint = rubricHint.trim().toLowerCase();
    const match = existing.find(r => r.name.toLowerCase().includes(hint) || hint.includes(r.name.toLowerCase()));
    if (match) return [match];
    // Create a rubric named after the hint.
    const created: Rubric = { id: slug(), name: rubricHint.trim().slice(0, 40), description: '', mode: 'ai' };
    await persist([...existing, created]);
    return [created];
  }

  if (existing.length > 0) return existing;

  // No rubrics at all — auto-create a sensible default.
  const created: Rubric = { id: slug(), name: isRu ? 'Обучение' : 'Learn', description: '', mode: 'ai' };
  await persist([created]);
  return [created];
}

// ─── Item generation (DeepSeek) ───────────────────────────────────────────────

interface RawItem { workingTitle: string; angle: string; searchQuery: string }

/** Loads ProjectDoc excerpts for the channel, capped for prompt inclusion. */
async function loadDocContext(channelId: string): Promise<string> {
  const docs = await prisma.projectDoc
    .findMany({ where: { channelId }, orderBy: { createdAt: 'desc' }, take: 5, select: { name: true, text: true } })
    .catch(() => []);
  if (docs.length === 0) return '';
  const parts = docs.map(d => `### ${d.name}\n${d.text.slice(0, 2500)}`);
  return parts.join('\n\n').slice(0, 10_000);
}

function buildStyleContext(channelAbout: Record<string, unknown>, voiceProfile: Record<string, unknown>): string {
  const lines: string[] = [];
  const push = (label: string, v: unknown) => { if (typeof v === 'string' && v.trim()) lines.push(`${label}: ${v.trim()}`); };
  push('Channel topic', channelAbout['topic']);
  push('Audience', channelAbout['targetAudience']);
  push('Content goal', channelAbout['contentGoal']);
  push('Language', voiceProfile['language']);
  push('Tone', voiceProfile['tone']);
  return lines.join('\n');
}

async function generateItems(
  params: GenerateContentPlanParams,
  styleContext: string,
  docContext: string,
  count: number,
): Promise<RawItem[]> {
  const fallback = (): RawItem[] =>
    Array.from({ length: count }, (_, i) => ({
      workingTitle: `${params.topic} — часть ${i + 1}`,
      angle: '',
      searchQuery: `${params.topic}`,
    }));

  if (!env.DEEPSEEK_API_KEY) return fallback();

  const { iso, year } = todayContext();
  const system =
    `Today's real date is ${iso} (current year ${year}). This is the source of truth for "now" — do NOT rely on your training cutoff. ` +
    'You are a content-series planner for a Telegram channel. Given a topic and the channel style, ' +
    `design a cohesive, logically progressing series of exactly ${count} posts (like a mini-course). ` +
    'For each post return: workingTitle (short, in the channel language), angle (one sentence on what it covers), ' +
    'and searchQuery (a focused web-search query, in the topic language, to research that specific post). ' +
    `For anything time-sensitive (platforms, trends, prices, "best", "latest", stats), put the CURRENT year ${year} in the searchQuery — never an older year like 2024 or 2025. ` +
    'Titles must not repeat and should build on each other. ' +
    'Return ONLY strict JSON: {"items":[{"workingTitle":"","angle":"","searchQuery":""}, ...]}';

  const user =
    `Topic: ${params.topic}\n` +
    `Number of posts: ${count}\n` +
    (styleContext ? `\nChannel style:\n${styleContext}\n` : '') +
    (docContext ? `\nProject reference material (base the series on this where relevant):\n${docContext}\n` : '') +
    `\nProduce the ${count}-item JSON plan now:`;

  try {
    const res = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL,
        response_format: { type: 'json_object' },
        max_tokens: 4000,
        temperature: 0.7,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!res.ok) { console.warn(`[contentPlanner] DeepSeek HTTP ${res.status}`); return fallback(); }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}') as { items?: unknown };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const cleaned: RawItem[] = [];
    for (const raw of items) {
      const it = raw as Record<string, unknown>;
      const title = typeof it['workingTitle'] === 'string' ? it['workingTitle'].trim() : '';
      if (!title) continue;
      cleaned.push({
        workingTitle: title.slice(0, 200),
        angle: (typeof it['angle'] === 'string' ? it['angle'] : '').trim().slice(0, 500),
        searchQuery: (typeof it['searchQuery'] === 'string' && it['searchQuery'].trim()
          ? it['searchQuery'] : params.topic).trim().slice(0, 300),
      });
    }
    if (cleaned.length === 0) return fallback();
    // Pad or trim to exactly `count`.
    while (cleaned.length < count) cleaned.push(fallback()[cleaned.length]);
    return cleaned.slice(0, count);
  } catch (err) {
    console.warn('[contentPlanner] item generation failed:', (err as Error).message);
    return fallback();
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates a DRAFT ContentPlan + items for the channel and returns it as a DTO.
 * Clamps postsPerDay/days/total to safe bounds. Never publishes — the plan sits
 * DRAFT until the user confirms («Приступить»).
 */
export async function generateContentPlan(params: GenerateContentPlanParams): Promise<ContentPlanDTO> {
  const postsPerDay = clamp(params.postsPerDay, 1, MAX_POSTS_PER_DAY);
  const days = clamp(params.days, 1, MAX_DAYS);
  const total = Math.min(postsPerDay * days, MAX_TOTAL_POSTS);

  // Normalize startDate: floor to the day, and never schedule in the past.
  const startDate = new Date(params.startDate);
  if (isNaN(startDate.getTime())) startDate.setTime(Date.now());
  startDate.setHours(0, 0, 0, 0);
  const todayFloor = new Date(); todayFloor.setHours(0, 0, 0, 0);
  if (startDate < todayFloor) startDate.setTime(todayFloor.getTime());

  const bk = await prisma.brandKit
    .findUnique({ where: { channelId: params.channelId }, select: { channelAbout: true, voiceProfile: true, visualKit: true } })
    .catch(() => null);
  const channelAbout = (bk?.channelAbout ?? {}) as Record<string, unknown>;
  const voiceProfile = (bk?.voiceProfile ?? {}) as Record<string, unknown>;
  const visualKit = (bk?.visualKit ?? {}) as Record<string, unknown>;

  const [rubrics, docContext] = await Promise.all([
    resolveRubrics(params.channelId, visualKit, voiceProfile, params.rubricHint),
    params.source === 'uploads' || params.source === 'both' ? loadDocContext(params.channelId) : Promise.resolve(''),
  ]);

  const styleContext = buildStyleContext(channelAbout, voiceProfile);
  const rawItems = await generateItems(params, styleContext, docContext, total);
  const slots = computeSlots(startDate, days, postsPerDay, total, params.times);

  const created = await prisma.contentPlan.create({
    data: {
      channelId: params.channelId,
      topic: params.topic.slice(0, 300),
      postsPerDay,
      days,
      startDate,
      source: params.source,
      status: 'DRAFT',
      items: {
        create: rawItems.map((it, i) => {
          const rubric = rubrics[i % rubrics.length];
          return {
            orderIndex: i,
            scheduledAt: slots[i] ?? slots[slots.length - 1],
            rubricId: rubric.id,
            rubricName: rubric.name,
            workingTitle: it.workingTitle,
            angle: it.angle,
            searchQuery: it.searchQuery,
            status: 'PENDING' as const,
          };
        }),
      },
    },
    include: { items: { orderBy: { orderIndex: 'asc' } } },
  });

  return {
    id: created.id,
    channelId: created.channelId,
    topic: created.topic,
    postsPerDay: created.postsPerDay,
    days: created.days,
    startDate: created.startDate.toISOString(),
    source: created.source,
    status: created.status,
    totalPosts: created.items.length,
    items: created.items.map(it => ({
      id: it.id,
      orderIndex: it.orderIndex,
      scheduledAt: it.scheduledAt.toISOString(),
      rubricId: it.rubricId,
      rubricName: it.rubricName,
      workingTitle: it.workingTitle,
      angle: it.angle,
      searchQuery: it.searchQuery,
    })),
  };
}
