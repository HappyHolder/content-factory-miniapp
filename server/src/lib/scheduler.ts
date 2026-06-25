/**
 * scheduler.ts
 *
 * Background polling loop that auto-publishes SCHEDULED posts whose
 * scheduledAt timestamp has passed.
 *
 * Design:
 *   - Pure setInterval — no extra dependencies.
 *   - Runs once at server startup (to catch posts missed during downtime),
 *     then every 60 s.
 *   - Single-instance safe: the stack runs one `api` container, so no
 *     distributed lock is needed for this app.
 *   - Delivery order: Telegram send THEN DB update (same as the manual
 *     publish route). If the DB update fails after a successful send the
 *     post remains SCHEDULED and will be retried; Telegram may receive a
 *     duplicate. This is acceptable at MVP scale.
 */

import { prisma } from '../db';
import { env } from '../env';
import { sendChannelPost, sendRichChannelPost, TelegramInlineKeyboard } from './telegramBot';
import type { PostBlock } from './richPost';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalises a link URL for a Telegram inline keyboard button.
 * Mirrors the identical helper in routes/posts.ts.
 */
function normalizeTelegramUrl(raw: unknown): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const u = raw.trim();
  if (!u) return null;
  if (u.startsWith('https://') || u.startsWith('http://')) return u;
  if (u.startsWith('@')) return `https://t.me/${u.slice(1)}`;
  return null;
}

// ─── In-flight guard ─────────────────────────────────────────────────────────
// Prevents two concurrent sweeps (e.g. a slow sweep + the next setInterval tick)
// from processing the same post twice within the same process.
// Does not help across multiple processes (only one runs on Render anyway).
const inFlight = new Set<string>();

// ─── Core publish sweep ───────────────────────────────────────────────────────

async function publishDuePosts(): Promise<void> {
  const now = new Date();

  // ── Find all due posts ────────────────────────────────────────────────────
  let duePosts: {
    id:                string;
    title:             string;
    selectedVariantId: string | null;
    linkButtons:       unknown;
    channel:           { handle: string | null; name: string };
    variants:          { id: string; text: string; bannerUrl: string | null; blocks: unknown }[];
  }[];

  try {
    duePosts = await prisma.generatedPost.findMany({
      where: {
        status:      'SCHEDULED',
        scheduledAt: { lte: now },
      },
      select: {
        id:                true,
        title:             true,
        selectedVariantId: true,
        linkButtons:       true,
        channel: {
          select: { handle: true, name: true },
        },
        variants: {
          orderBy: { variantIndex: 'asc' },
          select:  { id: true, text: true, bannerUrl: true, blocks: true },
        },
      },
    });
  } catch (err) {
    console.error('[scheduler] DB query failed:', (err as Error).message);
    return;
  }

  if (duePosts.length === 0) return;

  console.log(`[scheduler] ${duePosts.length} post(s) due — publishing…`);

  // ── Process each due post ─────────────────────────────────────────────────
  for (const post of duePosts) {

    // Skip posts already being handled by a concurrent sweep in this process
    if (inFlight.has(post.id)) continue;
    inFlight.add(post.id);

    try {

    // Resolve selected variant text
    const selectedVariant =
      post.variants.find(v => v.id === post.selectedVariantId) ?? post.variants[0];

    if (!selectedVariant?.text?.trim()) {
      console.error(`[scheduler] Post ${post.id}: no variant text — skipping`);
      continue;
    }

    // Require channel handle
    if (!post.channel.handle) {
      console.error(`[scheduler] Post ${post.id}: no channel handle — skipping`);
      continue;
    }

    // Build optional inline keyboard from stored link buttons
    let replyMarkup: TelegramInlineKeyboard | undefined;
    if (Array.isArray(post.linkButtons) && post.linkButtons.length > 0) {
      const rows = (post.linkButtons as Record<string, unknown>[])
        .map(btn => {
          const url = normalizeTelegramUrl(btn['url']);
          if (!url) return null;
          const text = String(btn['buttonLabel'] || btn['label'] || url).trim() || url;
          return [{ text, url }];
        })
        .filter((row): row is { text: string; url: string }[] => row !== null);
      if (rows.length > 0) {
        replyMarkup = { inline_keyboard: rows };
      }
    }

    // Send to Telegram — short post → native photo+caption; long post → full
    // text message with the cover as a large preview card (sendChannelPost).
    try {
      const blocks = Array.isArray(selectedVariant.blocks) && selectedVariant.blocks.length > 0
        ? (selectedVariant.blocks as PostBlock[])
        : null;
      if (blocks) {
        await sendRichChannelPost({
          chatId:      `@${post.channel.handle}`,
          blocks,
          title:       post.title,
          siteName:    post.channel.name || post.channel.handle || undefined,
          token:       env.TELEGRAM_BOT_TOKEN,
          replyMarkup,
        });
      } else {
        await sendChannelPost({
          chatId:      `@${post.channel.handle}`,
          text:        selectedVariant.text,
          bannerUrl:   selectedVariant.bannerUrl,
          title:       post.title,
          siteName:    post.channel.name || post.channel.handle || undefined,
          token:       env.TELEGRAM_BOT_TOKEN,
          replyMarkup,
        });
      }
    } catch (err) {
      console.error(`[scheduler] Post ${post.id}: Telegram send failed — will retry next poll:`, (err as Error).message);
      // Leave status=SCHEDULED so the next sweep retries.
      continue;
    }

    // Mark PUBLISHED in DB
    const publishedAt = new Date();
    try {
      await prisma.generatedPost.update({
        where: { id: post.id },
        data:  { status: 'PUBLISHED', publishedAt },
      });
      console.log(`[scheduler] Post ${post.id} published at ${publishedAt.toISOString()}`);
    } catch (err) {
      console.error(`[scheduler] Post ${post.id}: DB update failed — message was sent to Telegram:`, (err as Error).message);
    }

    } finally {
      inFlight.delete(post.id);
    }
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function startScheduler(): void {
  const INTERVAL_MS = 60_000; // 1 minute

  console.log(`[scheduler] Started — polling every ${INTERVAL_MS / 1000}s`);

  // Initial sweep: catch any posts that became due while the server was down.
  publishDuePosts().catch(err =>
    console.error('[scheduler] Startup sweep failed:', (err as Error).message)
  );

  // Recurring sweep
  setInterval(() => {
    publishDuePosts().catch(err =>
      console.error('[scheduler] Sweep failed:', (err as Error).message)
    );
  }, INTERVAL_MS);
}
