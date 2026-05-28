import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import { sendBotMessage, TelegramApiError, TelegramInlineKeyboard } from '../lib/telegramBot';
import { createDraftPostForChannel } from '../lib/draftGenerator';

const router = Router();

// ─── Local helpers ────────────────────────────────────────────────────────────

// Maps DB PostStatus enum value to the frontend lowercase string.
function mapStatus(s: string): 'new' | 'scheduled' | 'published' {
  if (s === 'SCHEDULED') return 'scheduled';
  if (s === 'PUBLISHED') return 'published';
  return 'new';   // NEW, FAILED, ARCHIVED all surface as 'new' in the Mini App
}

/**
 * Normalises a link URL for use in a Telegram inline keyboard button.
 * Telegram requires http:// or https:// URLs.
 *   "@handle"          → "https://t.me/handle"
 *   "https://…"        → unchanged
 *   "http://…"         → unchanged
 *   anything else      → null (button skipped)
 */
function normalizeTelegramUrl(raw: unknown): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const u = raw.trim();
  if (!u) return null;
  if (u.startsWith('https://') || u.startsWith('http://')) return u;
  if (u.startsWith('@')) return `https://t.me/${u.slice(1)}`;
  return null;
}

// ─── POST /api/posts/generate ─────────────────────────────────────────────────
//
// Generates 3 post variants via AI (or placeholder when AI_PROVIDER=placeholder)
// and persists them as a GeneratedPost + 3 PostVariant rows in Neon.
//
// Request body: { initData, channelId, input, sourceType }
// Response 200: { post: MappedGeneratedPost }
// Response 400: missing / empty fields
// Response 401: invalid initData / user not found
// Response 403: channel belongs to another user
// Response 404: channel not found
// Response 500: DB error

router.post('/generate', async (req: Request, res: Response): Promise<void> => {
  const { initData, channelId, input, sourceType } = req.body as {
    initData?:   unknown;
    channelId?:  unknown;
    input?:      unknown;
    sourceType?: unknown;
  };

  // ── 1. Input validation ───────────────────────────────────────────────────
  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' });
    return;
  }
  if (typeof channelId !== 'string' || !channelId.trim()) {
    res.status(400).json({ error: 'channelId is required' });
    return;
  }
  if (typeof input !== 'string' || !input.trim()) {
    res.status(400).json({ error: 'input is required and must be a non-empty string' });
    return;
  }
  if (input.length > 8000) {
    res.status(400).json({ error: 'input exceeds maximum length of 8000 characters' });
    return;
  }
  if (typeof sourceType !== 'string' || !sourceType.trim()) {
    res.status(400).json({ error: 'sourceType is required' });
    return;
  }

  const trimmedInput = input.trim();

  // ── 2. Validate Telegram initData ────────────────────────────────────────
  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Invalid initData',
    });
    return;
  }

  // ── 3. Resolve authenticated user ────────────────────────────────────────
  const telegramId = String(parsed.user.id);
  let dbUser: { id: string } | null = null;
  try {
    dbUser = await prisma.user.findUnique({
      where:  { telegramId },
      select: { id: true },
    });
  } catch (err) {
    console.error('[posts/generate] User lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  if (!dbUser) {
    res.status(401).json({ error: 'User not found. Please re-open the app.' });
    return;
  }

  // ── 4. Find channel + verify ownership ───────────────────────────────────
  let channel: { id: string; userId: string; handle: string | null; name: string } | null = null;
  try {
    channel = await prisma.channel.findUnique({
      where:  { id: channelId },
      select: { id: true, userId: true, handle: true, name: true },
    });
  } catch (err) {
    console.error('[posts/generate] Channel lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  if (!channel) {
    res.status(404).json({ error: 'Channel not found.' });
    return;
  }
  if (channel.userId !== dbUser.id) {
    res.status(403).json({ error: 'This channel does not belong to your account.' });
    return;
  }

  // ── 5. Create draft: BrandKit load + AI generation + DB persist ─────────────
  // Delegated to the shared draftGenerator helper so the logic is not
  // duplicated between this route and the bot webhook auto-draft flow.
  try {
    const draft = await createDraftPostForChannel({
      channelId:  channel.id,
      input:      trimmedInput,
      sourceType: sourceType as string,
      sourceUrl:  null,
    });
    res.json({ post: draft });
  } catch (err) {
    console.error('[posts/generate] Draft creation failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/posts/list ─────────────────────────────────────────────────────
//
// Returns actionable GeneratedPosts for the authenticated user (all channels).
// FAILED and ARCHIVED statuses are intentionally excluded:
//   - FAILED posts have no usable content and would surface as a confusing 'new'
//   - ARCHIVED posts are intentionally hidden from the user
//
// Request body: { initData }
// Response 200: { posts: MappedGeneratedPost[] }   — empty array if none
// Response 400: missing initData
// Response 401: invalid initData / user not found
// Response 500: DB error

router.post('/list', async (req: Request, res: Response): Promise<void> => {
  const { initData } = req.body as { initData?: unknown };

  // ── 1. Input validation ───────────────────────────────────────────────────
  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' });
    return;
  }

  // ── 2. Validate Telegram initData ────────────────────────────────────────
  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Invalid initData',
    });
    return;
  }

  // ── 3. Resolve authenticated user ────────────────────────────────────────
  const telegramId = String(parsed.user.id);
  let dbUser: { id: string } | null = null;
  try {
    dbUser = await prisma.user.findUnique({
      where:  { telegramId },
      select: { id: true },
    });
  } catch (err) {
    console.error('[posts/list] User lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  if (!dbUser) {
    res.status(401).json({ error: 'User not found. Please re-open the app.' });
    return;
  }

  // ── 4. Query all actionable posts for this user's channels ────────────────
  // Join via channel.userId — GeneratedPost has no direct userId column.
  // Limit 50, newest first.
  let dbPosts;
  try {
    dbPosts = await prisma.generatedPost.findMany({
      where: {
        channel: { userId: dbUser.id },
        status:  { in: ['NEW', 'SCHEDULED', 'PUBLISHED'] },
      },
      include: {
        channel:  { select: { handle: true, name: true } },
        variants: {
          orderBy: { variantIndex: 'asc' },
          select:  { id: true, label: true, text: true, isSelected: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });
  } catch (err) {
    console.error('[posts/list] Query failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  // ── 5. Map to frontend shape ──────────────────────────────────────────────
  // Rules:
  //   - status: DB enum (uppercase) → frontend lowercase via mapStatus()
  //   - dates: Date → ISO string; null stays null
  //   - linkButtons: null in DB → [] for frontend
  //   - banner: omitted entirely (no banner storage yet; frontend treats absent as undefined)
  //   - isSelected: recomputed from selectedVariantId to stay consistent
  res.json({
    posts: dbPosts.map(post => ({
      id:               post.id,
      title:            post.title,
      sourceType:       post.sourceType ?? 'prompt',
      sourceUrl:        post.sourceUrl ?? null,
      sourceSummary:    post.sourceSummary ?? '',
      channelId:        post.channelId,
      channelUsername:  post.channel.handle ?? post.channel.name,
      variants:         post.variants.map(v => ({
        id:         v.id,
        label:      v.label ?? 'Variant',
        text:       v.text,
        isSelected: v.id === post.selectedVariantId,
      })),
      selectedVariantId: post.selectedVariantId,
      linkButtons:       Array.isArray(post.linkButtons) ? post.linkButtons : [],
      status:            mapStatus(post.status),
      createdAt:         post.createdAt.toISOString(),
      scheduledAt:       post.scheduledAt?.toISOString() ?? null,
      publishedAt:       post.publishedAt?.toISOString() ?? null,
      textRegensUsed:    post.textRegensUsed,
      imageRegensUsed:   post.imageRegensUsed,
    })),
  });
});

// ─── POST /api/posts/publish ──────────────────────────────────────────────────
//
// Publishes the selected variant text to the Telegram channel via Bot API, then
// persists status=PUBLISHED + publishedAt in Neon.
//
// Order is intentional: Telegram send happens BEFORE the DB update so we never
// mark a post as published if the message was not actually delivered.
//
// Request body: { initData, postId }
// Response 200: { post: { id, status: 'published', publishedAt: ISO string } }
// Response 400: missing fields / no variant text
// Response 401: invalid initData / user not found
// Response 403: post belongs to another user
// Response 404: post not found
// Response 409: already published
// Response 502: Telegram API rejected the message
// Response 500: DB error

router.post('/publish', async (req: Request, res: Response): Promise<void> => {
  const { initData, postId } = req.body as {
    initData?: unknown;
    postId?:   unknown;
  };

  // ── 1. Input validation ───────────────────────────────────────────────────
  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' });
    return;
  }
  if (typeof postId !== 'string' || !postId.trim()) {
    res.status(400).json({ error: 'postId is required' });
    return;
  }

  // ── 2. Validate Telegram initData ────────────────────────────────────────
  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Invalid initData',
    });
    return;
  }

  // ── 3. Resolve authenticated user ────────────────────────────────────────
  const telegramId = String(parsed.user.id);
  let dbUser: { id: string } | null = null;
  try {
    dbUser = await prisma.user.findUnique({
      where:  { telegramId },
      select: { id: true },
    });
  } catch (err) {
    console.error('[posts/publish] User lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  if (!dbUser) {
    res.status(401).json({ error: 'User not found. Please re-open the app.' });
    return;
  }

  // ── 4. Load post with channel + variants ─────────────────────────────────
  let post: {
    id:                string;
    status:            string;
    selectedVariantId: string | null;
    linkButtons:       unknown;           // Json? — LinkItem[] stored by draftGenerator
    channel: {
      userId: string;
      handle: string | null;
      name:   string;
    };
    variants: { id: string; text: string }[];
  } | null = null;

  try {
    post = await prisma.generatedPost.findUnique({
      where:  { id: postId },
      select: {
        id:                true,
        status:            true,
        selectedVariantId: true,
        linkButtons:       true,
        channel: {
          select: { userId: true, handle: true, name: true },
        },
        variants: {
          orderBy: { variantIndex: 'asc' },
          select:  { id: true, text: true },
        },
      },
    });
  } catch (err) {
    console.error('[posts/publish] Post lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  if (!post) {
    res.status(404).json({ error: 'Post not found.' });
    return;
  }

  // ── 5. Ownership check ───────────────────────────────────────────────────
  if (post.channel.userId !== dbUser.id) {
    res.status(403).json({ error: 'This post does not belong to your account.' });
    return;
  }

  // ── 6. Idempotency guard — prevent double publish ────────────────────────
  if (post.status === 'PUBLISHED') {
    res.status(409).json({ error: 'Post is already published.' });
    return;
  }

  // ── 7. Resolve variant text ───────────────────────────────────────────────
  const selectedVariant =
    post.variants.find(v => v.id === post!.selectedVariantId) ?? post.variants[0];

  if (!selectedVariant?.text?.trim()) {
    res.status(400).json({ error: 'Post has no variant text to publish.' });
    return;
  }

  // ── 8. Require channel handle ────────────────────────────────────────────
  // Channels connected through the app always have a handle (enforced by
  // the /api/channels/connect normaliseUsername step), but guard anyway.
  if (!post.channel.handle) {
    res.status(500).json({ error: 'Channel has no public username — cannot publish.' });
    return;
  }

  // ── 9. Build optional inline keyboard from stored link buttons ───────────
  // linkButtons was populated from BrandKit at draft-creation time and stored
  // as Json in GeneratedPost. Each button with a valid URL becomes one row.
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

  // ── 10. Send to Telegram channel ─────────────────────────────────────────
  // DB is only updated AFTER a successful Telegram delivery so status never
  // shows PUBLISHED for a message that was never actually sent.
  try {
    await sendBotMessage(
      `@${post.channel.handle}`,
      selectedVariant.text,
      env.TELEGRAM_BOT_TOKEN,
      replyMarkup,
    );
  } catch (err) {
    const msg = err instanceof TelegramApiError
      ? err.message
      : (err as Error).message ?? 'Telegram API error';
    console.error('[posts/publish] sendMessage failed:', msg);
    res.status(502).json({ error: `Telegram rejected the publish request: ${msg}` });
    return;
  }

  // ── 11. Persist PUBLISHED status ─────────────────────────────────────────
  const publishedAt = new Date();
  try {
    await prisma.generatedPost.update({
      where: { id: postId },
      data:  { status: 'PUBLISHED', publishedAt },
    });
  } catch (err) {
    console.error('[posts/publish] DB update failed:', (err as Error).message);
    // The message was already delivered to Telegram. Return 500 so the
    // frontend knows the persisted state is inconsistent and can show a warning.
    res.status(500).json({
      error: 'Post was sent to Telegram but status could not be saved. Please reload the app.',
    });
    return;
  }

  // ── 12. Return updated post fields ───────────────────────────────────────
  res.json({
    post: {
      id:          postId,
      status:      'published',
      publishedAt: publishedAt.toISOString(),
    },
  });
});

// ─── POST /api/posts/update-variant ──────────────────────────────────────────
//
// Persists edited variant text to PostVariant.text in Neon.
// Called by the "Save" button in PostTextEditor after the user finishes editing.
//
// Request body: { initData, postId, variantId, text }
// Response 200: { ok: true }
// Response 400: missing / invalid fields
// Response 401: invalid initData / user not found
// Response 403: post belongs to another user
// Response 404: variant not found / does not belong to post
// Response 500: DB error

router.post('/update-variant', async (req: Request, res: Response): Promise<void> => {
  const { initData, postId, variantId, text } = req.body as {
    initData?:  unknown;
    postId?:    unknown;
    variantId?: unknown;
    text?:      unknown;
  };

  // ── 1. Input validation ───────────────────────────────────────────────────
  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' }); return;
  }
  if (typeof postId !== 'string' || !postId.trim()) {
    res.status(400).json({ error: 'postId is required' }); return;
  }
  if (typeof variantId !== 'string' || !variantId.trim()) {
    res.status(400).json({ error: 'variantId is required' }); return;
  }
  if (typeof text !== 'string') {
    res.status(400).json({ error: 'text must be a string' }); return;
  }
  if (text.length > 16_000) {
    res.status(400).json({ error: 'text exceeds maximum length of 16000 characters' }); return;
  }

  // ── 2. Validate Telegram initData ────────────────────────────────────────
  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return;
  }

  // ── 3. Resolve authenticated user ────────────────────────────────────────
  const telegramId = String(parsed.user.id);
  let dbUser: { id: string } | null = null;
  try {
    dbUser = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  } catch (err) {
    console.error('[posts/update-variant] User lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
  if (!dbUser) {
    res.status(401).json({ error: 'User not found. Please re-open the app.' }); return;
  }

  // ── 4. Load variant + post + channel for ownership check ─────────────────
  // Prisma relation name from PostVariant → GeneratedPost is "generatedPost".
  let variant: {
    id:              string;
    generatedPostId: string;
    generatedPost:   { id: string; channel: { userId: string } };
  } | null = null;
  try {
    variant = await prisma.postVariant.findUnique({
      where:  { id: variantId },
      select: {
        id:              true,
        generatedPostId: true,
        generatedPost: {
          select: {
            id:      true,
            channel: { select: { userId: true } },
          },
        },
      },
    });
  } catch (err) {
    console.error('[posts/update-variant] Variant lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
  if (!variant) {
    res.status(404).json({ error: 'Variant not found.' }); return;
  }
  if (variant.generatedPostId !== postId) {
    res.status(404).json({ error: 'Variant does not belong to this post.' }); return;
  }
  if (variant.generatedPost.channel.userId !== dbUser.id) {
    res.status(403).json({ error: 'This post does not belong to your account.' }); return;
  }

  // ── 5. Persist updated text ───────────────────────────────────────────────
  try {
    await prisma.postVariant.update({
      where: { id: variantId },
      data:  { text },
    });
  } catch (err) {
    console.error('[posts/update-variant] DB update failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }

  res.json({ ok: true });
});

// ─── POST /api/posts/schedule ─────────────────────────────────────────────────
//
// Schedules a post: sets status=SCHEDULED and scheduledAt in GeneratedPost.
//
// Request body: { initData, postId, scheduledAt }  — scheduledAt: ISO 8601 string
// Response 200: { post: { id, status: 'scheduled', scheduledAt: ISO string } }
// Response 400: missing / invalid fields
// Response 401: invalid initData / user not found
// Response 403: post belongs to another user
// Response 404: post not found
// Response 409: post is already published
// Response 500: DB error

router.post('/schedule', async (req: Request, res: Response): Promise<void> => {
  const { initData, postId, scheduledAt: scheduledAtRaw } = req.body as {
    initData?:    unknown;
    postId?:      unknown;
    scheduledAt?: unknown;
  };

  // ── 1. Input validation ───────────────────────────────────────────────────
  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' }); return;
  }
  if (typeof postId !== 'string' || !postId.trim()) {
    res.status(400).json({ error: 'postId is required' }); return;
  }
  if (typeof scheduledAtRaw !== 'string' || !scheduledAtRaw.trim()) {
    res.status(400).json({ error: 'scheduledAt is required' }); return;
  }
  const scheduledAt = new Date(scheduledAtRaw);
  if (isNaN(scheduledAt.getTime())) {
    res.status(400).json({ error: 'scheduledAt must be a valid ISO 8601 date string' }); return;
  }

  // ── 2. Validate Telegram initData ────────────────────────────────────────
  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return;
  }

  // ── 3. Resolve authenticated user ────────────────────────────────────────
  const telegramId = String(parsed.user.id);
  let dbUser: { id: string } | null = null;
  try {
    dbUser = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  } catch (err) {
    console.error('[posts/schedule] User lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
  if (!dbUser) {
    res.status(401).json({ error: 'User not found. Please re-open the app.' }); return;
  }

  // ── 4. Load post + channel for ownership check ────────────────────────────
  let post: { id: string; status: string; channel: { userId: string } } | null = null;
  try {
    post = await prisma.generatedPost.findUnique({
      where:  { id: postId },
      select: {
        id:      true,
        status:  true,
        channel: { select: { userId: true } },
      },
    });
  } catch (err) {
    console.error('[posts/schedule] Post lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
  if (!post) {
    res.status(404).json({ error: 'Post not found.' }); return;
  }
  if (post.channel.userId !== dbUser.id) {
    res.status(403).json({ error: 'This post does not belong to your account.' }); return;
  }
  if (post.status === 'PUBLISHED') {
    res.status(409).json({ error: 'Cannot schedule an already published post.' }); return;
  }

  // ── 5. Persist SCHEDULED status + scheduledAt ─────────────────────────────
  try {
    await prisma.generatedPost.update({
      where: { id: postId },
      data:  { status: 'SCHEDULED', scheduledAt },
    });
  } catch (err) {
    console.error('[posts/schedule] DB update failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }

  res.json({
    post: {
      id:          postId,
      status:      'scheduled',
      scheduledAt: scheduledAt.toISOString(),
    },
  });
});

export default router;
