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

import { cleanupInterventionContext } from '../moderator/interventionEngine';
import { prisma } from '../db';
import { env } from '../env';
import { moderatorTokenForCommunity } from '../moderator/managedBotCrypto';
import { sendChannelPost, sendRichChannelPost, buildInlineKeyboard, deleteBotMessage, kickChatUser, restrictChatUser } from './telegramBot';
import { deleteObject, purgeOldFiles } from './storage';
import { POST_EDIT_WINDOW_MS } from './postRetention';
import { normalizePostBlocks, type PostBlock } from './richPost';

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
    channel:           { id: string; handle: string | null; name: string; tgChatId: string | null };
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
          select: { id: true, handle: true, name: true, tgChatId: true },
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

    const normalizedBlocks = normalizePostBlocks(selectedVariant?.blocks);
    const blocks = normalizedBlocks?.length ? normalizedBlocks : null;
    if (!selectedVariant?.text?.trim() && !blocks) {
      console.error(`[scheduler] Post ${post.id}: no publishable content — skipping`);
      continue;
    }

    // Prefer the stable numeric chat id (rename-proof); fall back to @handle.
    if (!post.channel.tgChatId && !post.channel.handle) {
      console.error(`[scheduler] Post ${post.id}: no channel id/handle — skipping`);
      continue;
    }
    const channelTarget = post.channel.tgChatId ?? `@${post.channel.handle}`;

    // Build optional inline keyboard from stored link buttons
    const replyMarkup = buildInlineKeyboard(post.linkButtons);

    // Send to Telegram — short post → native photo+caption; long post → full
    // text message with the cover as a large preview card (sendChannelPost).
    let sentRef: Awaited<ReturnType<typeof sendRichChannelPost>> = null;
    try {
      if (blocks) {
        sentRef = await sendRichChannelPost({
          chatId:      channelTarget,
          blocks,
          title:       post.title,
          siteName:    post.channel.name || post.channel.handle || undefined,
          token:       env.TELEGRAM_BOT_TOKEN,
          replyMarkup,
        });
      } else {
        sentRef = await sendChannelPost({
          chatId:      channelTarget,
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

    // Self-heal: remember the numeric chat id so future publishes are rename-proof.
    if (!post.channel.tgChatId && sentRef?.chatId) {
      prisma.channel.update({ where: { id: post.channel.id }, data: { tgChatId: String(sentRef.chatId) } })
        .catch(e => console.error(`[scheduler] Post ${post.id}: tgChatId backfill failed:`, (e as Error).message));
    }

    // Mark PUBLISHED in DB — store the sent message ref for the 5-hour
    // edit-in-place window (mirrors the manual /publish route).
    const publishedAt = new Date();
    try {
      await prisma.generatedPost.update({
        where: { id: post.id },
        data:  {
          status:      'PUBLISHED',
          publishedAt,
          tgChatId:    sentRef ? String(sentRef.chatId) : null,
          tgMessageId: sentRef?.messageId ?? null,
        },
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

// ─── Retention purge ──────────────────────────────────────────────────────────
// A published post "lives fully" only for POST_EDIT_WINDOW_MS (5h) — during it
// the user can pull it back, edit and re-publish (edit in place). After that we
// drop the DB row and its stored media so data doesn't accumulate forever. The
// Telegram message itself stays in the channel; we just stop tracking it.

/** Collects every stored media URL (cover + block media) from a post's variants. */
function mediaUrlsOf(variants: { bannerUrl: string | null; blocks: unknown }[]): string[] {
  const urls = new Set<string>();
  for (const v of variants) {
    if (v.bannerUrl) urls.add(v.bannerUrl);
    const blocks = Array.isArray(v.blocks) ? (v.blocks as PostBlock[]) : [];
    for (const b of blocks) {
      if (b.type === 'image' && b.url) urls.add(b.url);
      else if (b.type === 'video') { if (b.url) urls.add(b.url); if (b.poster) urls.add(b.poster); }
      else if (b.type === 'document' && b.url) urls.add(b.url);
      else if (b.type === 'gallery') for (const u of b.urls) if (u) urls.add(u);
    }
  }
  return [...urls];
}

async function purgeExpiredPublished(): Promise<void> {
  const cutoff = new Date(Date.now() - POST_EDIT_WINDOW_MS);

  let expired: { id: string; variants: { bannerUrl: string | null; blocks: unknown }[] }[];
  try {
    expired = await prisma.generatedPost.findMany({
      where:  { status: 'PUBLISHED', publishedAt: { lt: cutoff } },
      select: { id: true, variants: { select: { bannerUrl: true, blocks: true } } },
      take:   100, // bound each sweep
    });
  } catch (err) {
    console.error('[scheduler] purge query failed:', (err as Error).message);
    return;
  }
  if (expired.length === 0) return;

  for (const post of expired) {
    // Best-effort media cleanup — a failed delete never blocks the row removal.
    for (const url of mediaUrlsOf(post.variants)) {
      try { await deleteObject(url); }
      catch (err) { console.error(`[scheduler] purge media delete failed (${url}):`, (err as Error).message); }
    }
    try {
      await prisma.generatedPost.delete({ where: { id: post.id } }); // cascades to variants
    } catch (err) {
      console.error(`[scheduler] purge delete failed for ${post.id}:`, (err as Error).message);
    }
  }
  console.log(`[scheduler] purged ${expired.length} expired published post(s)`);
}

async function purgeModerationSamples(): Promise<void> {
  await prisma.moderationMessageSample.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } } });
}

async function processScheduledModerationActions(): Promise<void> {
  const actions = await prisma.scheduledModerationAction.findMany({
    where: { status: 'PENDING', executeAt: { lte: new Date() } }, orderBy: { executeAt: 'asc' }, take: 100,
  });
  for (const action of actions) {
    try {
      const moderatorToken = await moderatorTokenForCommunity(action.communityId);
      if (action.actionType === 'UNMUTE_USER' && action.tgUserId) { await restrictChatUser(action.tgChatId, Number(action.tgUserId), false, moderatorToken); await prisma.communityMember.updateMany({ where: { communityId: action.communityId, tgUserId: action.tgUserId, status: 'MUTED' }, data: { status: 'ACTIVE', muteUntil: null } }); await prisma.moderationEvent.create({ data: { communityId: action.communityId, telegramUpdateId: `scheduled:${action.id}`, telegramMessageId: action.telegramMessageId, tgUserId: action.tgUserId, eventType: 'SANCTION_EXPIRED', action: 'UNMUTE', status: 'PROCESSED' } }); } else if (action.actionType.startsWith('CAPTCHA_TIMEOUT') && action.tgUserId) { const claimed = await prisma.communityMember.updateMany({ where: { communityId: action.communityId, tgUserId: action.tgUserId, captchaStatus: 'PENDING' }, data: { captchaStatus: 'TIMEOUT_PROCESSING' } }); if (claimed.count !== 1) { await prisma.scheduledModerationAction.update({ where: { id: action.id }, data: { status: 'CANCELLED', completedAt: new Date() } }); continue; } if (action.actionType === 'CAPTCHA_TIMEOUT_KICK') await kickChatUser(action.tgChatId, Number(action.tgUserId), moderatorToken); await prisma.communityMember.updateMany({ where: { communityId: action.communityId, tgUserId: action.tgUserId, captchaStatus: 'TIMEOUT_PROCESSING' }, data: { captchaStatus: 'FAILED', status: action.actionType === 'CAPTCHA_TIMEOUT_KICK' ? 'REMOVED' : 'RESTRICTED' } }); await deleteBotMessage(action.tgChatId, action.telegramMessageId, moderatorToken).catch(() => undefined); await prisma.moderationEvent.create({ data: { communityId: action.communityId, telegramUpdateId: `scheduled:${action.id}`, telegramMessageId: action.telegramMessageId, tgUserId: action.tgUserId, eventType: 'CAPTCHA_TIMEOUT', action: action.actionType === 'CAPTCHA_TIMEOUT_KICK' ? 'KICK' : 'KEEP_RESTRICTED', status: 'PROCESSED' } }); } else await deleteBotMessage(action.tgChatId, action.telegramMessageId, moderatorToken);
      await prisma.scheduledModerationAction.update({ where: { id: action.id }, data: { status: 'COMPLETED', completedAt: new Date(), attempts: { increment: 1 } } });
    } catch (err) {
      if (action.actionType.startsWith('CAPTCHA_TIMEOUT') && action.tgUserId) await prisma.communityMember.updateMany({ where: { communityId: action.communityId, tgUserId: action.tgUserId, captchaStatus: 'TIMEOUT_PROCESSING' }, data: { captchaStatus: 'PENDING', status: 'RESTRICTED' } }).catch(() => undefined);
      const attempts = action.attempts + 1;
      await prisma.scheduledModerationAction.update({ where: { id: action.id }, data: { attempts, status: attempts >= 3 ? 'FAILED' : 'PENDING', lastError: (err as Error).message.slice(0, 500), executeAt: new Date(Date.now() + 60_000) } }).catch(() => undefined);
    }
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function startScheduler(): void {
  const INTERVAL_MS = 60_000; // 1 minute

  console.log(`[scheduler] Started — polling every ${INTERVAL_MS / 1000}s`);

  const sweep = async () => {
    await publishDuePosts().catch(err =>
      console.error('[scheduler] Publish sweep failed:', (err as Error).message)
    );
    await purgeExpiredPublished().catch(err =>
      console.error('[scheduler] Purge sweep failed:', (err as Error).message)
    );
    await purgeModerationSamples().catch(err => console.error('[scheduler] Moderation sample purge failed:', (err as Error).message));
    // Assistant chat screenshots are deleted right after vision extraction;
    // this sweeps any orphaned by a failed request (upload with no send, etc.).
    await purgeOldFiles('chat', 6 * 60 * 60 * 1000).then(n => { if (n) console.log(`[scheduler] purged ${n} orphan chat image(s)`); }).catch(() => undefined);
    await processScheduledModerationActions().catch(err =>
      console.error('[scheduler] Moderation action sweep failed:', (err as Error).message)
    );
  };

  // Initial sweep: catch posts that became due (or expired) while we were down.
  sweep().catch(err => console.error('[scheduler] Startup sweep failed:', (err as Error).message));

  // Recurring sweep
  setInterval(() => {
    cleanupInterventionContext().catch(() => undefined);
    sweep().catch(err => console.error('[scheduler] Sweep failed:', (err as Error).message));
  }, INTERVAL_MS);
}
