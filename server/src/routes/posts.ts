import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import { sendBotMessage, TelegramApiError } from '../lib/telegramBot';
import { createDraftPostForChannel } from '../lib/draftGenerator';

const router = Router();

// ─── Local helpers ────────────────────────────────────────────────────────────

// Maps DB PostStatus enum value to the frontend lowercase string.
function mapStatus(s: string): 'new' | 'scheduled' | 'published' {
  if (s === 'SCHEDULED') return 'scheduled';
  if (s === 'PUBLISHED') return 'published';
  return 'new';   // NEW, FAILED, ARCHIVED all surface as 'new' in the Mini App
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

  // ── 9. Send to Telegram channel ──────────────────────────────────────────
  // DB is only updated AFTER a successful Telegram delivery so status never
  // shows PUBLISHED for a message that was never actually sent.
  try {
    await sendBotMessage(
      `@${post.channel.handle}`,
      selectedVariant.text,
      env.TELEGRAM_BOT_TOKEN,
    );
  } catch (err) {
    const msg = err instanceof TelegramApiError
      ? err.message
      : (err as Error).message ?? 'Telegram API error';
    console.error('[posts/publish] sendMessage failed:', msg);
    res.status(502).json({ error: `Telegram rejected the publish request: ${msg}` });
    return;
  }

  // ── 10. Persist PUBLISHED status ─────────────────────────────────────────
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

  // ── 11. Return updated post fields ───────────────────────────────────────
  res.json({
    post: {
      id:          postId,
      status:      'published',
      publishedAt: publishedAt.toISOString(),
    },
  });
});

export default router;
