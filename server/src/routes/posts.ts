import { Router, Request, Response } from 'express';
import multer from 'multer';
import { putObject, deleteObject } from '../lib/storage';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import { sendChannelPost, sendRichChannelPost, TelegramApiError, TelegramInlineKeyboard } from '../lib/telegramBot';
import type { PostBlock } from '../lib/richPost';

/** Returns the variant's structured blocks if present and non-empty, else null. */
function variantBlocks(v: { blocks?: unknown }): PostBlock[] | null {
  return Array.isArray(v.blocks) && v.blocks.length > 0 ? (v.blocks as PostBlock[]) : null;
}

/** Collects every stored media URL (cover + block images/videos) from variants. */
function collectMediaUrls(variants: { bannerUrl?: string | null; blocks?: unknown }[]): string[] {
  const urls = new Set<string>();
  for (const v of variants) {
    if (v.bannerUrl) urls.add(v.bannerUrl);
    for (const b of variantBlocks(v) ?? []) {
      if (b.type === 'image' && b.url) urls.add(b.url);
      else if (b.type === 'video') { if (b.url) urls.add(b.url); if (b.poster) urls.add(b.poster); }
      else if (b.type === 'gallery') for (const u of b.urls) if (u) urls.add(u);
    }
  }
  return [...urls];
}
import { createDraftPostForChannel } from '../lib/draftGenerator';
import { fetchArticle } from '../lib/urlContentExtractor';
import { extractImageContentFromUrl } from '../lib/visionExtractor';
import { generateImageForPost, buildVisualKitPromptHints, renderCoverFromBase } from '../lib/imageGenerator';
import { generateImagePromptWithAI } from '../lib/aiGenerator';
import { isCreatesLimitReached, applyMonthlyQuotaReset, canUseHtmlCovers, MAX_TEXT_REGENS_PER_POST, MAX_IMAGE_REGENS_PER_POST } from '../lib/subscriptionLimits';
import { generatePostVariants } from '../lib/aiGenerator';

// ─── Multer for image uploads ─────────────────────────────────────────────────
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Unsupported file type'));
  },
});

// Video uploads — capped at 20 MB because Telegram fetches the video by URL when
// we send it in a Rich Message, and URL-based sends are limited to ~20 MB.
const uploadVideoMiddleware = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 }, // 20 MB (Telegram URL fetch limit)
  fileFilter: (_req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/quicktime'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Unsupported video type — use MP4'));
  },
});

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
  const { initData, channelId, input, sourceType, imagePrompt, useBrandKit, imageOnly, coverMode, imageUrl } = req.body as {
    initData?:    unknown;
    channelId?:   unknown;
    input?:       unknown;
    sourceType?:  unknown;
    imagePrompt?: unknown;
    useBrandKit?: unknown;
    imageOnly?:   unknown;
    coverMode?:   unknown;
    imageUrl?:    unknown;  // uploaded screenshot URL → vision-extracted into the source
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
  // input is required unless imageOnly mode (image prompt is used as the creative brief)
  const isImageOnly = imageOnly === true;
  const hasImageUrl = typeof imageUrl === 'string' && /^https?:\/\//i.test(imageUrl);
  // input is required unless: imageOnly mode, or a screenshot (imageUrl) is provided.
  if (!isImageOnly && !hasImageUrl && (typeof input !== 'string' || !input.trim())) {
    res.status(400).json({ error: 'input is required and must be a non-empty string' });
    return;
  }
  if (typeof input === 'string' && input.length > 8000) {
    res.status(400).json({ error: 'input exceeds maximum length of 8000 characters' });
    return;
  }
  if (typeof sourceType !== 'string' || !sourceType.trim()) {
    res.status(400).json({ error: 'sourceType is required' });
    return;
  }

  const trimmedInput = typeof input === 'string' ? input.trim() : (typeof imagePrompt === 'string' ? imagePrompt.trim() : '');

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

  // ── 4. Check Create-mode generation quota (with lazy monthly reset) ──────
  let subscription: { aiCreatesLimit: number | null; aiCreatesUsed: number } | null = null;
  // Unknown tier (no row / DB error) → don't block the HTML feature.
  let allowHtmlCovers = true;
  let modelTier: 'LOW' | 'HIGH' = 'LOW';
  try {
    const sub = await prisma.subscription.findUnique({
      where:  { userId: dbUser.id },
      select: { tier: true, modelTier: true, aiPostsLimit: true, aiPostsUsed: true, aiCreatesLimit: true, aiCreatesUsed: true, quotaResetAt: true },
    });
    if (sub) {
      const fresh = await applyMonthlyQuotaReset({ userId: dbUser.id, ...sub });
      subscription = { aiCreatesLimit: fresh.aiCreatesLimit, aiCreatesUsed: fresh.aiCreatesUsed };
      allowHtmlCovers = canUseHtmlCovers(sub.tier);
      modelTier = sub.modelTier;
    }
  } catch (err) {
    console.error('[posts/generate] Subscription lookup failed:', (err as Error).message);
  }
  if (subscription && isCreatesLimitReached(subscription.aiCreatesUsed, subscription.aiCreatesLimit)) {
    res.status(403).json({
      error:       'Monthly Create-mode generation limit reached. Upgrade your plan.',
      code:        'CREATES_LIMIT_REACHED',
      used:        subscription.aiCreatesUsed,
      limit:       subscription.aiCreatesLimit,
    });
    return;
  }

  // ── 5. Find channel + verify ownership ───────────────────────────────────
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

  // ── 5b. Resolve a rich source: screenshot (vision) or pasted link (article) ──
  // Mirrors the bot flow so Create accepts the same inputs. Non-fatal: on any
  // failure we fall back to the raw text the user typed.
  let effectiveInput = trimmedInput;
  let resolvedSourceUrl: string | null = null;
  try {
    if (hasImageUrl) {
      const vis = await extractImageContentFromUrl(imageUrl as string);
      if (vis) effectiveInput = [trimmedInput, vis].filter(s => s && s.trim()).join('\n\n');
    } else {
      const urlMatch = trimmedInput.match(/https?:\/\/\S+/);
      // Treat the input as a link only when it is essentially just a URL.
      if (urlMatch && trimmedInput.replace(urlMatch[0], '').trim().length < 40) {
        const article = await fetchArticle(urlMatch[0]);
        if (article && article.text.trim()) {
          effectiveInput = `${article.title}\n\n${article.text}`.trim();
          resolvedSourceUrl = urlMatch[0];
        }
      }
    }
  } catch (err) {
    console.warn('[posts/generate] source extraction failed (non-fatal):', (err as Error).message);
  }

  // ── 6. Create draft: BrandKit load + AI generation + DB persist ─────────────
  // Delegated to the shared draftGenerator helper so the logic is not
  // duplicated between this route and the bot webhook auto-draft flow.
  try {
    const draft = await createDraftPostForChannel({
      channelId:   channel.id,
      input:       effectiveInput,
      sourceType:  sourceType as string,
      sourceUrl:   resolvedSourceUrl,
      imagePrompt: typeof imagePrompt === 'string' ? imagePrompt : undefined,
      useBrandKit: useBrandKit === false ? false : true,
      imageOnly:   isImageOnly,
      allowHtmlCovers,
      coverModeOverride: (coverMode === 'ai' || coverMode === 'html' || coverMode === 'ai_html') ? coverMode : undefined,
      modelTier,
    });

    // Increment Create-mode usage counter (non-fatal if it fails)
    if (subscription) {
      prisma.subscription.update({
        where: { userId: dbUser.id },
        data:  { aiCreatesUsed: { increment: 1 } },
      }).catch(err => console.error('[posts/generate] Usage increment failed:', (err as Error).message));
    }

    res.json({
      post: draft,
      usage: subscription ? {
        aiCreatesUsed:  (subscription.aiCreatesUsed ?? 0) + 1,
        aiCreatesLimit: subscription.aiCreatesLimit,
      } : undefined,
    });
  } catch (err) {
    console.error('[posts/generate] Draft creation failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/posts/create-blank ─────────────────────────────────────────────
//
// Creates an EMPTY draft post for manual composition in the block editor — no AI
// call, no cover generation, no Create quota consumed. The single variant carries
// starter blocks (an empty heading + paragraph) so the formatted-post block editor
// opens immediately. Channel link buttons (usage button|always) are attached so a
// manually built post can still publish with the channel's buttons. Returns the
// same mapped shape as /generate so the frontend can addPost() it directly.
//
// Request body: { initData, channelId, title? }
// Response 200: { post: MappedGeneratedPost }

router.post('/create-blank', async (req: Request, res: Response): Promise<void> => {
  const { initData, channelId, title } = req.body as {
    initData?:  unknown;
    channelId?: unknown;
    title?:     unknown;
  };

  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' }); return;
  }
  if (typeof channelId !== 'string' || !channelId.trim()) {
    res.status(400).json({ error: 'channelId is required' }); return;
  }

  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return;
  }

  const telegramId = String(parsed.user.id);
  const dbUser = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } }).catch(() => null);
  if (!dbUser) { res.status(401).json({ error: 'User not found. Please re-open the app.' }); return; }

  // Channel + ownership.
  const channel = await prisma.channel.findUnique({
    where:  { id: channelId },
    select: { id: true, userId: true, handle: true, name: true, brandKit: { select: { visualKit: true, linkKit: true } } },
  }).catch(() => null);
  if (!channel) { res.status(404).json({ error: 'Channel not found.' }); return; }
  if (channel.userId !== dbUser.id) {
    res.status(403).json({ error: 'This channel does not belong to your account.' }); return;
  }

  // Mirror the channel's cover settings (only coverAspectRatio actually matters
  // for manual posts — generate-block-image reads it for AI illustration aspect).
  const vk = (channel.brandKit?.visualKit && typeof channel.brandKit.visualKit === 'object')
    ? channel.brandKit.visualKit as Record<string, unknown> : null;
  const rawMode = typeof vk?.['coverMode'] === 'string' ? vk['coverMode'] as string : 'ai';
  const coverMode: 'ai' | 'html' | 'ai_html' = rawMode === 'html' || rawMode === 'ai_html' ? rawMode : 'ai';
  const rawAr = vk?.['aspectRatio'];
  const coverAspectRatio: '1:1' | '16:9' | '4:5' | '9:16' =
    rawAr === '16:9' || rawAr === '4:5' || rawAr === '9:16' ? rawAr : '1:1';

  // No channel buttons on a from-scratch post — the user adds their own buttons
  // in the block editor (PATCH /:postId/buttons). Manual = fully hand-built.
  const buttonLinks: unknown[] = [];

  // A truly blank canvas — the user builds every block themselves. The post is
  // still treated as block-based on the frontend (by sourceType 'manual'), so the
  // block editor opens even with zero blocks.
  const starterBlocks: PostBlock[] = [];

  const finalTitle = typeof title === 'string' && title.trim() ? title.trim().slice(0, 80) : 'Новый пост';

  let dbPost;
  try {
    dbPost = await prisma.$transaction(async (tx) => {
      const created = await tx.generatedPost.create({
        data: {
          title:        finalTitle,
          channelId:    channel.id,
          sourceType:   'manual',
          sourceSummary: '',
          status:       'NEW',
          coverMode,
          coverAspectRatio,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          linkButtons:  buttonLinks as any,
          variants: {
            create: [{
              label:        'Текст',
              variantIndex: 0,
              text:         '',
              isSelected:   true,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              blocks:       starterBlocks as any,
            }],
          },
        },
        include: { variants: true },
      });
      const firstVariantId = created.variants[0]!.id;
      await tx.generatedPost.update({ where: { id: created.id }, data: { selectedVariantId: firstVariantId } });
      return { ...created, selectedVariantId: firstVariantId };
    });
  } catch (err) {
    console.error('[posts/create-blank] Create failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }

  res.json({
    post: {
      id:               dbPost.id,
      title:            dbPost.title,
      sourceType:       'manual',
      sourceUrl:        null,
      sourceSummary:    '',
      channelId:        dbPost.channelId,
      channelUsername:  channel.handle ?? channel.name,
      variants: dbPost.variants.map(v => ({
        id:         v.id,
        label:      v.label ?? 'Текст',
        text:       v.text,
        isSelected: v.id === dbPost.selectedVariantId,
        bannerUrl:  null,
        blocks:     starterBlocks,
      })),
      selectedVariantId: dbPost.selectedVariantId,
      linkButtons:       buttonLinks,
      status:            'new',
      createdAt:         dbPost.createdAt.toISOString(),
      scheduledAt:       null,
      publishedAt:       null,
      textRegensUsed:    0,
      imageRegensUsed:   0,
      coverMode,
      coverAspectRatio,
    },
  });
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
          select:  { id: true, label: true, text: true, isSelected: true, bannerUrl: true, blocks: true },
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
        bannerUrl:  v.bannerUrl ?? null,
        blocks:     variantBlocks(v),
      })),
      selectedVariantId: post.selectedVariantId,
      linkButtons:       Array.isArray(post.linkButtons) ? post.linkButtons : [],
      status:            mapStatus(post.status),
      createdAt:         post.createdAt.toISOString(),
      scheduledAt:       post.scheduledAt?.toISOString() ?? null,
      publishedAt:       post.publishedAt?.toISOString() ?? null,
      textRegensUsed:    post.textRegensUsed,
      imageRegensUsed:   post.imageRegensUsed,
      coverMode:         post.coverMode,
      coverAspectRatio:  post.coverAspectRatio,
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
    title:  string;
    channel: {
      userId: string;
      handle: string | null;
      name:   string;
    };
    variants: { id: string; text: string; bannerUrl: string | null; blocks: unknown }[];
  } | null = null;

  try {
    post = await prisma.generatedPost.findUnique({
      where:  { id: postId },
      select: {
        id:                true,
        status:            true,
        title:             true,
        selectedVariantId: true,
        linkButtons:       true,
        channel: {
          select: { userId: true, handle: true, name: true },
        },
        variants: {
          orderBy: { variantIndex: 'asc' },
          select:  { id: true, text: true, bannerUrl: true, blocks: true },
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

  // Publishable when there's variant text OR structured blocks (a manually built
  // post has empty text but real blocks — its content lives entirely in blocks).
  if (!selectedVariant?.text?.trim() && !variantBlocks(selectedVariant)) {
    res.status(400).json({ error: 'Post has no content to publish.' });
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
  // sendChannelPost picks the method: short post → native photo+caption;
  // long post → full text message with the cover as a large preview card.
  try {
    const blocks = variantBlocks(selectedVariant);
    if (blocks) {
      // Formatted post — structured blocks → Rich Message (with internal fallback
      // to the legacy plain path inside sendRichChannelPost if the API rejects it).
      await sendRichChannelPost({
        chatId:      `@${post.channel.handle}`,
        blocks,
        title:       post.title,
        siteName:    post.channel.name || post.channel.handle || undefined,
        token:       env.TELEGRAM_BOT_TOKEN,
        replyMarkup,
      });
    } else {
      // Legacy posts created before formatting existed (no stored blocks).
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
    const msg = err instanceof TelegramApiError
      ? err.message
      : (err as Error).message ?? 'Telegram API error';
    console.error('[posts/publish] Telegram send failed:', msg);
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

// ─── PATCH /api/posts/:postId/blocks ─────────────────────────────────────────
// Saves the user's edited formatted-post layout (PostBlock[]) onto a variant.
// Body: { initData, variantId, blocks }
// Response 200: { ok: true }
router.patch('/:postId/blocks', async (req: Request, res: Response): Promise<void> => {
  const { postId } = req.params as { postId: string };
  const { initData, variantId, blocks } = req.body as {
    initData?: unknown; variantId?: unknown; blocks?: unknown;
  };

  if (typeof initData !== 'string' || !initData.trim()) { res.status(400).json({ error: 'initData is required' }); return; }
  if (typeof variantId !== 'string' || !variantId.trim()) { res.status(400).json({ error: 'variantId is required' }); return; }
  if (!Array.isArray(blocks)) { res.status(400).json({ error: 'blocks must be an array' }); return; }
  if (blocks.length > 80) { res.status(400).json({ error: 'too many blocks' }); return; }

  let parsed;
  try { parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN); }
  catch (err) { res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return; }

  const dbUser = await prisma.user.findUnique({ where: { telegramId: String(parsed.user.id) }, select: { id: true } }).catch(() => null);
  if (!dbUser) { res.status(401).json({ error: 'User not found. Please re-open the app.' }); return; }

  // Verify the variant belongs to a post on a channel owned by this user.
  const variant = await prisma.postVariant.findUnique({
    where:  { id: variantId },
    select: { id: true, generatedPost: { select: { id: true, channel: { select: { userId: true } } } } },
  }).catch(() => null);
  if (!variant || variant.generatedPost.id !== postId) { res.status(404).json({ error: 'Variant not found.' }); return; }
  if (variant.generatedPost.channel.userId !== dbUser.id) { res.status(403).json({ error: 'This post does not belong to your account.' }); return; }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.postVariant.update({ where: { id: variantId }, data: { blocks: blocks as any } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[posts/blocks] update failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /api/posts/:postId/buttons ────────────────────────────────────────
// Saves the post's inline-keyboard buttons (label + URL) — used by the manual
// block editor, where the user adds their own buttons instead of inheriting the
// channel's. Stored on GeneratedPost.linkButtons in the LinkItem shape so publish
// builds the keyboard from them exactly like channel buttons.
// Body: { initData, buttons: { id?, label, url }[] }   Response 200: { ok, buttons }
router.patch('/:postId/buttons', async (req: Request, res: Response): Promise<void> => {
  const { postId } = req.params as { postId: string };
  const { initData, buttons } = req.body as { initData?: unknown; buttons?: unknown };

  if (typeof initData !== 'string' || !initData.trim()) { res.status(400).json({ error: 'initData is required' }); return; }
  if (!Array.isArray(buttons)) { res.status(400).json({ error: 'buttons must be an array' }); return; }
  if (buttons.length > 10) { res.status(400).json({ error: 'too many buttons (max 10)' }); return; }

  let parsed;
  try { parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN); }
  catch (err) { res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return; }

  const dbUser = await prisma.user.findUnique({ where: { telegramId: String(parsed.user.id) }, select: { id: true } }).catch(() => null);
  if (!dbUser) { res.status(401).json({ error: 'User not found. Please re-open the app.' }); return; }

  const post = await prisma.generatedPost.findUnique({
    where:  { id: postId },
    select: { id: true, channel: { select: { userId: true } } },
  }).catch(() => null);
  if (!post) { res.status(404).json({ error: 'Post not found.' }); return; }
  if (post.channel.userId !== dbUser.id) { res.status(403).json({ error: 'This post does not belong to your account.' }); return; }

  // Sanitize into the LinkItem shape publish understands. Drop entries without
  // both a label and a URL. URL validity is re-checked at publish (normalizeTelegramUrl).
  const clean = (buttons as unknown[])
    .filter(b => b && typeof b === 'object')
    .map((b, i) => {
      const o = b as Record<string, unknown>;
      const label = typeof o['label'] === 'string' ? o['label'].trim().slice(0, 64) : '';
      const url   = typeof o['url']   === 'string' ? o['url'].trim().slice(0, 500) : '';
      const id    = typeof o['id'] === 'string' && o['id'] ? o['id'] : `btn-${Date.now()}-${i}`;
      return { id, label, url, anchorText: '', buttonLabel: label, usage: 'button' };
    })
    .filter(b => b.label && b.url);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.generatedPost.update({ where: { id: postId }, data: { linkButtons: clean as any } });
    res.json({ ok: true, buttons: clean });
  } catch (err) {
    console.error('[posts/buttons] update failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/posts/upload-block-image ──────────────────────────────────────
// Uploads an image to use inside a formatted post's image/gallery block and
// returns its public URL. Does NOT touch the DB — the caller puts the URL into
// the block and persists via PATCH /:postId/blocks.
// Request: multipart { initData, image }   Response 200: { url }
router.post('/upload-block-image', uploadMiddleware.single('image'), async (req: Request, res: Response): Promise<void> => {
  const initData = req.body['initData'] as unknown;
  const file = req.file;
  if (typeof initData !== 'string' || !initData.trim()) { res.status(400).json({ error: 'initData is required' }); return; }
  if (!file) { res.status(400).json({ error: 'image is required' }); return; }

  let parsed;
  try { parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN); }
  catch (err) { res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return; }

  const dbUser = await prisma.user.findUnique({ where: { telegramId: String(parsed.user.id) }, select: { id: true } }).catch(() => null);
  if (!dbUser) { res.status(401).json({ error: 'User not found. Please re-open the app.' }); return; }

  try {
    const ext = (file.originalname.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg';
    const obj = await putObject(`posts/blocks/${dbUser.id}-${Date.now()}.${ext}`, file.buffer, { contentType: file.mimetype });
    res.json({ url: obj.url });
  } catch (err) {
    console.error('[posts/upload-block-image] upload failed:', (err as Error).message);
    res.status(500).json({ error: 'Upload failed. Try again.' });
  }
});

// ─── POST /api/posts/upload-block-video ──────────────────────────────────────
// Uploads a video to use inside a formatted post's video block and returns its
// public URL. Telegram fetches this URL when the post is sent (≤20 MB, MP4).
// Request: multipart { initData, video }   Response 200: { url }
router.post('/upload-block-video', uploadVideoMiddleware.single('video'), async (req: Request, res: Response): Promise<void> => {
  const initData = req.body['initData'] as unknown;
  const file = req.file;
  if (typeof initData !== 'string' || !initData.trim()) { res.status(400).json({ error: 'initData is required' }); return; }
  if (!file) { res.status(400).json({ error: 'video is required' }); return; }

  let parsed;
  try { parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN); }
  catch (err) { res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return; }

  const dbUser = await prisma.user.findUnique({ where: { telegramId: String(parsed.user.id) }, select: { id: true } }).catch(() => null);
  if (!dbUser) { res.status(401).json({ error: 'User not found. Please re-open the app.' }); return; }

  try {
    const ext = file.mimetype === 'video/webm' ? 'webm' : file.mimetype === 'video/quicktime' ? 'mov' : 'mp4';
    const obj = await putObject(`posts/blocks/${dbUser.id}-${Date.now()}.${ext}`, file.buffer, { contentType: file.mimetype });
    res.json({ url: obj.url });
  } catch (err) {
    console.error('[posts/upload-block-video] upload failed:', (err as Error).message);
    res.status(500).json({ error: 'Upload failed. Try again.' });
  }
});

// ─── POST /api/posts/generate-block-image ────────────────────────────────────
// Generates an AI illustration for a post block (clean scene, no burned-in title)
// and returns its URL. Optional `prompt` lets the user art-direct it; otherwise
// it's derived from the post + channel style. Does NOT touch bannerUrl.
// Request: { initData, postId, prompt? }   Response 200: { url }
router.post('/generate-block-image', async (req: Request, res: Response): Promise<void> => {
  const { initData, postId, prompt: userPrompt } = req.body as { initData?: unknown; postId?: unknown; prompt?: unknown };
  if (typeof initData !== 'string' || !initData.trim()) { res.status(400).json({ error: 'initData is required' }); return; }
  if (typeof postId !== 'string' || !postId.trim()) { res.status(400).json({ error: 'postId is required' }); return; }

  let parsed;
  try { parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN); }
  catch (err) { res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return; }

  const dbUser = await prisma.user.findUnique({ where: { telegramId: String(parsed.user.id) }, select: { id: true } }).catch(() => null);
  if (!dbUser) { res.status(401).json({ error: 'User not found. Please re-open the app.' }); return; }

  const post = await prisma.generatedPost.findUnique({
    where:  { id: postId },
    select: {
      title: true, sourceSummary: true, coverAspectRatio: true,
      channel: { select: { userId: true, brandKit: { select: { visualKit: true } } } },
    },
  }).catch(() => null);
  if (!post) { res.status(404).json({ error: 'Post not found.' }); return; }
  if (post.channel.userId !== dbUser.id) { res.status(403).json({ error: 'This post does not belong to your account.' }); return; }

  const visualKit = post.channel.brandKit?.visualKit ?? undefined;
  const vkObj = visualKit && typeof visualKit === 'object' ? visualKit as Record<string, unknown> : null;
  const rawAr = post.coverAspectRatio ?? vkObj?.['aspectRatio'];
  const aspectRatio: '1:1' | '16:9' | '4:5' | '9:16' =
    rawAr === '16:9' || rawAr === '4:5' || rawAr === '9:16' ? rawAr : '1:1';

  const art = typeof userPrompt === 'string' && userPrompt.trim() ? userPrompt.trim().slice(0, 400) : undefined;
  let prompt = art ?? `abstract cover art, ${(post.title ?? '').slice(0, 80)}, dark premium background, modern aesthetic`;
  try {
    const aiPrompt = await generateImagePromptWithAI({
      title: post.title, excerpt: post.sourceSummary ?? post.title, visualKit, artDirection: art,
    });
    if (aiPrompt) prompt = aiPrompt;
  } catch { /* non-fatal — use fallback prompt */ }

  let modelTier: 'LOW' | 'HIGH' = 'LOW';
  try {
    const sub = await prisma.subscription.findUnique({ where: { userId: dbUser.id }, select: { modelTier: true } });
    if (sub) modelTier = sub.modelTier;
  } catch { /* default LOW */ }

  let cover: Awaited<ReturnType<typeof generateImageForPost>> = null;
  try {
    // No headline → a clean illustration for the post body (not a cover with text).
    cover = await generateImageForPost({ prompt, visualKit, aspectRatio, model: modelTier === 'HIGH' ? env.HIGH_IMAGE_MODEL : env.IMAGE_MODEL });
  } catch (err) {
    console.warn('[posts/generate-block-image] generation threw:', (err as Error).message);
  }
  if (!cover?.bannerUrl) { res.status(502).json({ error: 'Не удалось сгенерировать картинку. Попробуй ещё раз.' }); return; }
  res.json({ url: cover.bannerUrl });
});

// ─── POST /api/posts/select-variant ──────────────────────────────────────────
//
// Persists the user's variant selection to GeneratedPost.selectedVariantId.
// Must be called whenever the user picks a different variant in the UI so that
// both manual publish and the scheduler use the correct variant text.
//
// Request body: { initData, postId, variantId }
// Response 200: { ok: true }
// Response 400: missing / invalid fields
// Response 401: invalid initData / user not found
// Response 403: post belongs to another user
// Response 404: variant not found / does not belong to post
// Response 500: DB error

router.post('/select-variant', async (req: Request, res: Response): Promise<void> => {
  const { initData, postId, variantId } = req.body as {
    initData?:  unknown;
    postId?:    unknown;
    variantId?: unknown;
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
    console.error('[posts/select-variant] User lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
  if (!dbUser) {
    res.status(401).json({ error: 'User not found. Please re-open the app.' }); return;
  }

  // ── 4. Load variant + post + channel for ownership check ─────────────────
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
    console.error('[posts/select-variant] Variant lookup failed:', (err as Error).message);
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

  // ── 5. Persist selectedVariantId ─────────────────────────────────────────
  try {
    await prisma.generatedPost.update({
      where: { id: postId },
      data:  { selectedVariantId: variantId },
    });
  } catch (err) {
    console.error('[posts/select-variant] DB update failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }

  res.json({ ok: true });
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

  // ── 4. Check scheduling permission (Creator+ only) ───────────────────────
  const sub = await prisma.subscription.findUnique({
    where:  { userId: dbUser.id },
    select: { tier: true },
  }).catch(() => null);
  if (sub?.tier === 'STARTER') {
    res.status(403).json({ error: 'Scheduled posts are available on the Creator plan and above.', code: 'UPGRADE_REQUIRED' }); return;
  }

  // ── 5. Load post + channel for ownership check ────────────────────────────
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

  // ── 6. Persist SCHEDULED status + scheduledAt ─────────────────────────────
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

// ─── POST /api/posts/delete ──────────────────────────────────────────────────
//
// Permanently deletes a GeneratedPost and all its PostVariant rows from the DB.
//
// ⚠  Published posts: deleting here removes the post from Publium ONLY.
//    The Telegram channel message is NOT deleted because message IDs are not
//    stored in this app. The post will simply disappear from the Posts list.
//
// Cascade: PostVariant rows are deleted automatically by the DB (onDelete: Cascade
// is configured on the PostVariant → GeneratedPost relation in schema.prisma).
// No explicit child-row cleanup is needed.
//
// Scheduled posts: once the row is gone the scheduler will never pick it up,
// so deletion naturally cancels any pending scheduled publish.
//
// Request body: { initData, postId }
// Response 200: { ok: true }
// Response 400: missing / invalid fields
// Response 401: invalid initData / user not found
// Response 403: post belongs to another user
// Response 404: post not found
// Response 500: DB error

router.post('/delete', async (req: Request, res: Response): Promise<void> => {
  const { initData, postId } = req.body as {
    initData?: unknown;
    postId?:   unknown;
  };

  // ── 1. Input validation ───────────────────────────────────────────────────
  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' }); return;
  }
  if (typeof postId !== 'string' || !postId.trim()) {
    res.status(400).json({ error: 'postId is required' }); return;
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
    console.error('[posts/delete] User lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
  if (!dbUser) {
    res.status(401).json({ error: 'User not found. Please re-open the app.' }); return;
  }

  // ── 4. Load post with ownership check (+ media for file cleanup) ──────────
  let post: { id: string; channel: { userId: string }; variants: { bannerUrl: string | null; blocks: unknown }[] } | null = null;
  try {
    post = await prisma.generatedPost.findUnique({
      where:  { id: postId },
      select: { id: true, channel: { select: { userId: true } }, variants: { select: { bannerUrl: true, blocks: true } } },
    });
  } catch (err) {
    console.error('[posts/delete] Post lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
  if (!post) {
    res.status(404).json({ error: 'Post not found.' }); return;
  }
  if (post.channel.userId !== dbUser.id) {
    res.status(403).json({ error: 'This post does not belong to your account.' }); return;
  }

  // ── 5. Delete post (cascade removes PostVariant rows automatically) ───────
  try {
    await prisma.generatedPost.delete({ where: { id: postId } });
  } catch (err) {
    console.error('[posts/delete] Delete failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }

  // ── 6. Best-effort: remove the post's stored media files (cover + block media)
  // so deleted posts don't leave orphaned files growing on disk. Non-fatal.
  try {
    await Promise.all(collectMediaUrls(post.variants).map(deleteObject));
  } catch (err) {
    console.warn('[posts/delete] media cleanup failed (non-fatal):', (err as Error).message);
  }

  res.json({ ok: true });
});

// ─── POST /api/posts/regenerate-visual ───────────────────────────────────────
//
// Regenerates the cover image for a specific PostVariant using Replicate.
// The original imagePrompt is not stored, so a new prompt is synthesised
// from the variant text and (optionally) the channel BrandKit visualKit.
//
// Request body: { initData, postId, variantId }
// Response 200: { bannerUrl: string }
// Response 400: missing / invalid fields
// Response 401: invalid initData / user not found
// Response 403: variant belongs to another user
// Response 404: variant not found / does not belong to post
// Response 502: image generation failed or returned no URL
// Response 500: DB error

/**
 * Builds the image prompt for the regenerate-visual path.
 *
 * Priority:
 *  1. savedImagePrompt — the original prompt the user typed. Use as-is.
 *  2. postTitle — short topic anchor for an abstract cover.
 *  3. Generic fallback — abstract cover with no topic.
 *
 * NEVER uses variantText (full post body) — that's Russian content prose,
 * not a visual description, and models render it as visible text on the image.
 */
function buildVisualPromptFromVariant(params: {
  savedImagePrompt?: string | null;
  postTitle?:        string | null;
}): string {
  const { savedImagePrompt, postTitle } = params;

  // If the original image prompt was saved, reuse it directly.
  if (savedImagePrompt?.trim()) return savedImagePrompt.trim();

  // Fallback: build a minimal abstract visual concept from the post title only.
  const title = postTitle?.trim().slice(0, 80);
  if (title) return `abstract cover art, ${title}, dark premium background, modern tech aesthetic`;

  return 'abstract dark premium cover art, modern tech aesthetic';
}

router.post('/regenerate-visual', async (req: Request, res: Response): Promise<void> => {
  const { initData, postId, variantId } = req.body as {
    initData?:  unknown;
    postId?:    unknown;
    variantId?: unknown;
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
    console.error('[posts/regenerate-visual] User lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
  if (!dbUser) {
    res.status(401).json({ error: 'User not found. Please re-open the app.' }); return;
  }

  // ── 4. Load variant with ownership and style context ─────────────────────
  let variant: {
    id:              string;
    generatedPostId: string;
    text:            string;
    bannerUrl:       string | null;
    generatedPost: {
      id:              string;
      title:           string;
      sourceSummary:   string | null;
      imagePrompt:     string | null;
      imageRegensUsed: number;
      coverMode:       string | null;
      coverAspectRatio:string | null;
      channel: {
        userId:   string;
        brandKit: { visualKit: unknown } | null;
      };
    };
  } | null = null;

  try {
    variant = await prisma.postVariant.findUnique({
      where:  { id: variantId },
      select: {
        id:              true,
        generatedPostId: true,
        text:            true,
        bannerUrl:       true,
        generatedPost: {
          select: {
            id:              true,
            title:           true,
            sourceSummary:   true,
            imagePrompt:     true,
            imageRegensUsed: true,
            coverMode:       true,
            coverAspectRatio:true,
            channel: {
              select: {
                userId:   true,
                brandKit: { select: { visualKit: true } },
              },
            },
          },
        },
      },
    });
  } catch (err) {
    console.error('[posts/regenerate-visual] Variant lookup failed:', (err as Error).message);
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

  // ── 4a. Block visual regeneration in HTML cover mode ─────────────────────
  // HTML covers are composed by Sonnet (costly) from the channel templates.
  // The Flux regenerate path here would replace that brand layout with a
  // generic neural image, so it is disabled for HTML-mode channels.
  {
    const vk = variant.generatedPost.channel.brandKit?.visualKit;
    const mode = variant.generatedPost.coverMode ?? ((vk && typeof vk === 'object')
      ? (vk as Record<string, unknown>)['coverMode']
      : undefined);
    if (mode === 'html' || mode === 'ai_html') {
      res.status(403).json({
        error: 'Перегенерация визуала недоступна в этом режиме обложек.',
        code:  'REGEN_DISABLED_HTML_MODE',
      });
      return;
    }
  }

  // ── 4b. Enforce per-post visual regeneration cap ─────────────────────────
  if (variant.generatedPost.imageRegensUsed >= MAX_IMAGE_REGENS_PER_POST) {
    res.status(403).json({
      error: `Лимит перегенераций визуала исчерпан (${MAX_IMAGE_REGENS_PER_POST} на пост).`,
      code:  'IMAGE_REGENS_LIMIT_REACHED',
      used:  variant.generatedPost.imageRegensUsed,
      limit: MAX_IMAGE_REGENS_PER_POST,
    });
    return;
  }

  // ── 5. Build image prompt ────────────────────────────────────────────────
  // Priority: saved imagePrompt → AI-generated → simple title fallback.
  // Never uses variantText (post body prose renders as visible text on image).
  const visualKit = variant.generatedPost.channel.brandKit?.visualKit ?? undefined;
  const vkObj = visualKit && typeof visualKit === 'object'
    ? visualKit as Record<string, unknown>
    : null;
  const rawAspectRatio = variant.generatedPost.coverAspectRatio ?? vkObj?.['aspectRatio'];
  const aspectRatio: '1:1' | '16:9' | '4:5' | '9:16' =
    rawAspectRatio === '16:9' || rawAspectRatio === '4:5' || rawAspectRatio === '9:16'
      ? rawAspectRatio
      : '1:1';

  let prompt = buildVisualPromptFromVariant({
    savedImagePrompt: variant.generatedPost.imagePrompt,
    postTitle:        variant.generatedPost.title,
  });

  // If no saved prompt, ask AI to generate one from title + brand style
  if (!variant.generatedPost.imagePrompt?.trim()) {
    try {
      const aiPrompt = await generateImagePromptWithAI({
        title:     variant.generatedPost.title,
        excerpt:   variant.generatedPost.sourceSummary ?? variant.generatedPost.title,
        visualKit,
      });
      if (aiPrompt) prompt = aiPrompt;
    } catch {
      // non-fatal — use the simple fallback prompt
    }
  }

  // Model variant for this user (HIGH → GPT Image; default LOW → Flux).
  let modelTier: 'LOW' | 'HIGH' = 'LOW';
  try {
    const sub = await prisma.subscription.findUnique({ where: { userId: dbUser.id }, select: { modelTier: true } });
    if (sub) modelTier = sub.modelTier;
  } catch { /* non-fatal — default LOW */ }
  const imageModel = modelTier === 'HIGH' ? env.HIGH_IMAGE_MODEL : env.IMAGE_MODEL;

  // ── 6. Generate new image via Replicate ───────────────────────────────────
  let cover: Awaited<ReturnType<typeof generateImageForPost>> = null;
  try {
    cover = await generateImageForPost({
      prompt,
      visualKit,
      aspectRatio,
      headline: variant.generatedPost.title,
      model:    imageModel,
    });
  } catch (err) {
    console.warn('[posts/regenerate-visual] generateImageForPost threw:', (err as Error).message);
  }

  const imageUrl = cover?.bannerUrl ?? null;
  if (!imageUrl) {
    res.status(502).json({ error: 'Image generation failed or returned no result. Try again.' });
    return;
  }

  // ── 7. Persist new bannerUrl to PostVariant + increment regen counter ─────
  // Old bannerUrl is replaced only after a successful generation.
  // The cover is a post-level asset: apply to ALL variants so switching the
  // selected text variant keeps the regenerated image.
  try {
    await prisma.$transaction([
      prisma.postVariant.updateMany({
        where: { generatedPostId: postId },
        data:  { bannerUrl: imageUrl },
      }),
      prisma.generatedPost.update({
        where: { id: postId },
        data:  {
          imageRegensUsed: { increment: 1 },
          // Persist the clean base so the headline can be edited later.
          ...(cover?.coverBaseUrl ? { coverBaseUrl: cover.coverBaseUrl } : {}),
        },
      }),
    ]);
  } catch (err) {
    console.error('[posts/regenerate-visual] DB update failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }

  res.json({
    bannerUrl:       imageUrl,
    imageRegensUsed: variant.generatedPost.imageRegensUsed + 1,
    imageRegensLimit: MAX_IMAGE_REGENS_PER_POST,
  });
});

// ─── POST /api/posts/regenerate-text ─────────────────────────────────────────
//
// Regenerates the text variants for an existing post using the stored source
// summary + channel BrandKit. Old variants are replaced; the existing banner
// (post-level cover) is preserved onto the new variants. Capped per-post via
// GeneratedPost.textRegensUsed.
//
// Request body: { initData, postId }
// Response 200: { variants: MappedVariant[], selectedVariantId, textRegensUsed, textRegensLimit }
// Response 400/401/403/404/500 as elsewhere
// Response 403 code TEXT_REGENS_LIMIT_REACHED when the per-post cap is hit

router.post('/regenerate-text', async (req: Request, res: Response): Promise<void> => {
  const { initData, postId } = req.body as { initData?: unknown; postId?: unknown };

  // ── 1. Input validation ───────────────────────────────────────────────────
  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' }); return;
  }
  if (typeof postId !== 'string' || !postId.trim()) {
    res.status(400).json({ error: 'postId is required' }); return;
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
    console.error('[posts/regenerate-text] User lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
  if (!dbUser) {
    res.status(401).json({ error: 'User not found. Please re-open the app.' }); return;
  }

  // ── 4. Load post + channel + variants for ownership and context ──────────
  let post: {
    id:             string;
    status:         string;
    channelId:      string;
    sourceType:     string | null;
    sourceSummary:  string | null;
    textRegensUsed: number;
    channel: { userId: string; handle: string | null; name: string };
    variants: { id: string; bannerUrl: string | null }[];
  } | null = null;
  try {
    post = await prisma.generatedPost.findUnique({
      where:  { id: postId },
      select: {
        id:             true,
        status:         true,
        channelId:      true,
        sourceType:     true,
        sourceSummary:  true,
        textRegensUsed: true,
        channel:  { select: { userId: true, handle: true, name: true } },
        variants: { select: { id: true, bannerUrl: true }, orderBy: { variantIndex: 'asc' } },
      },
    });
  } catch (err) {
    console.error('[posts/regenerate-text] Post lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
  if (!post) {
    res.status(404).json({ error: 'Post not found.' }); return;
  }
  if (post.channel.userId !== dbUser.id) {
    res.status(403).json({ error: 'This post does not belong to your account.' }); return;
  }
  if (post.status === 'PUBLISHED') {
    res.status(409).json({ error: 'Cannot regenerate an already published post.' }); return;
  }

  // ── 5. Enforce per-post text regeneration cap ────────────────────────────
  if (post.textRegensUsed >= MAX_TEXT_REGENS_PER_POST) {
    res.status(403).json({
      error: `Лимит перегенераций текста исчерпан (${MAX_TEXT_REGENS_PER_POST} на пост).`,
      code:  'TEXT_REGENS_LIMIT_REACHED',
      used:  post.textRegensUsed,
      limit: MAX_TEXT_REGENS_PER_POST,
    });
    return;
  }

  // ── 6. Load BrandKit for style context (non-fatal) ───────────────────────
  let brandKit: unknown | null = null;
  try {
    brandKit = await prisma.brandKit.findUnique({
      where:  { channelId: post.channelId },
      select: { channelAbout: true, voiceProfile: true, postRules: true, linkKit: true, signature: true, visualKit: true },
    });
  } catch (err) {
    console.error('[posts/regenerate-text] BrandKit lookup failed (non-fatal):', (err as Error).message);
    brandKit = null;
  }

  // Model variant for this user (HIGH → Claude; default LOW → DeepSeek).
  let modelTier: 'LOW' | 'HIGH' = 'LOW';
  try {
    const sub = await prisma.subscription.findUnique({ where: { userId: dbUser.id }, select: { modelTier: true } });
    if (sub) modelTier = sub.modelTier;
  } catch { /* non-fatal — default LOW */ }

  // ── 7. Generate fresh variants via AI ────────────────────────────────────
  const input = post.sourceSummary?.trim() || post.channel.name;
  let variantDrafts;
  try {
    variantDrafts = await generatePostVariants({
      input,
      sourceType: post.sourceType ?? 'prompt',
      channel:    { handle: post.channel.handle, name: post.channel.name },
      brandKit,
    }, modelTier);
  } catch (err) {
    console.error('[posts/regenerate-text] AI generation failed:', (err as Error).message);
    res.status(502).json({ error: 'Text generation failed. Try again.' }); return;
  }
  if (!Array.isArray(variantDrafts) || variantDrafts.length === 0) {
    res.status(502).json({ error: 'Text generation returned no variants. Try again.' }); return;
  }

  // Preserve the existing post-level banner (any variant carries it).
  const preservedBanner = post.variants.find(v => v.bannerUrl)?.bannerUrl ?? null;

  // ── 8. Replace variants + increment counter (transaction) ────────────────
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      await tx.postVariant.deleteMany({ where: { generatedPostId: postId } });
      await tx.generatedPost.update({
        where: { id: postId },
        data: {
          textRegensUsed: { increment: 1 },
          selectedVariantId: null,
          variants: {
            create: variantDrafts.map((v, i) => ({
              label:        v.label,
              variantIndex: i,
              text:         v.text,
              isSelected:   i === 0,
              bannerUrl:    preservedBanner,
            })),
          },
        },
        include: { variants: { orderBy: { variantIndex: 'asc' } } },
      });
      const created = await tx.generatedPost.findUniqueOrThrow({
        where:  { id: postId },
        select: { textRegensUsed: true, variants: { orderBy: { variantIndex: 'asc' }, select: { id: true, label: true, text: true, bannerUrl: true } } },
      });
      const firstVariantId = created.variants[0]!.id;
      await tx.generatedPost.update({ where: { id: postId }, data: { selectedVariantId: firstVariantId } });
      return { created, firstVariantId };
    });
  } catch (err) {
    console.error('[posts/regenerate-text] DB transaction failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }

  res.json({
    variants: result.created.variants.map(v => ({
      id:         v.id,
      label:      v.label ?? 'Variant',
      text:       v.text,
      isSelected: v.id === result.firstVariantId,
      bannerUrl:  v.bannerUrl ?? null,
    })),
    selectedVariantId: result.firstVariantId,
    textRegensUsed:    result.created.textRegensUsed,
    textRegensLimit:   MAX_TEXT_REGENS_PER_POST,
  });
});

// ─── POST /api/posts/upload-image ────────────────────────────────────────────
// Uploads a user-provided image and sets it as bannerUrl for a PostVariant.
// Multipart form: fields { initData, variantId } + file field "image".
// Response 200: { bannerUrl: string }

router.post(
  '/upload-image',
  uploadMiddleware.single('image'),
  async (req: Request, res: Response): Promise<void> => {
    const { initData, variantId } = req.body as { initData?: string; variantId?: string };

    if (!initData?.trim())  { res.status(400).json({ error: 'initData required' });  return; }
    if (!variantId?.trim()) { res.status(400).json({ error: 'variantId required' }); return; }

    const file = req.file;
    if (!file) { res.status(400).json({ error: 'image file required' }); return; }

    // Auth
    let parsed;
    try { parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN); }
    catch (err) { res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return; }

    const telegramId = String(parsed.user.id);
    const dbUser = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } }).catch(() => null);
    if (!dbUser) { res.status(401).json({ error: 'User not found' }); return; }

    // Check variant belongs to user's post
    const variant = await prisma.postVariant.findUnique({
      where:  { id: variantId },
      select: {
        id: true,
        generatedPostId: true,
        generatedPost: { select: { channel: { select: { userId: true } } } },
      },
    }).catch(() => null);

    if (!variant || variant.generatedPost.channel.userId !== dbUser.id) {
      res.status(403).json({ error: 'Variant not found or access denied' }); return;
    }

    // Upload to local storage
    const ext      = file.originalname.split('.').pop() ?? 'jpg';
    const filename = `posts/${dbUser.id}/${variantId}-${Date.now()}.${ext}`;
    let bannerUrl: string;
    try {
      const obj = await putObject(filename, file.buffer, { contentType: file.mimetype });
      bannerUrl  = obj.url;
    } catch (err) {
      console.error('[posts/upload-image] Blob upload failed:', (err as Error).message);
      res.status(502).json({ error: 'Image upload failed' }); return;
    }

    // Save to DB
    try {
      await prisma.postVariant.updateMany({
        where: { generatedPostId: variant.generatedPostId },
        data:  { bannerUrl },
      });
    } catch (err) {
      console.error('[posts/upload-image] DB update failed:', (err as Error).message);
      res.status(500).json({ error: 'Internal server error' }); return;
    }

    res.json({ bannerUrl });
  }
);

// ─── POST /api/posts/set-banner ──────────────────────────────────────────────
//
// Sets an already-hosted banner URL on ALL variants of a post (cover is a
// post-level asset). Used by the frontend "restore previous cover" undo: old
// blob images are never deleted, so a prior URL stays valid. Does NOT consume a
// regeneration and does not touch imageRegensUsed.
//
// Request body: { initData, postId, bannerUrl }
// Response 200: { ok: true }
// Response 400/401/403/404/500 as elsewhere

router.post('/set-banner', async (req: Request, res: Response): Promise<void> => {
  const { initData, postId, bannerUrl } = req.body as {
    initData?:  unknown;
    postId?:    unknown;
    bannerUrl?: unknown;
  };

  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' }); return;
  }
  if (typeof postId !== 'string' || !postId.trim()) {
    res.status(400).json({ error: 'postId is required' }); return;
  }
  if (typeof bannerUrl !== 'string' || !/^https:\/\/\S+$/.test(bannerUrl.trim())) {
    res.status(400).json({ error: 'bannerUrl must be an https URL' }); return;
  }

  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return;
  }

  const telegramId = String(parsed.user.id);
  const dbUser = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } }).catch(() => null);
  if (!dbUser) { res.status(401).json({ error: 'User not found. Please re-open the app.' }); return; }

  // Ownership check
  const post = await prisma.generatedPost.findUnique({
    where:  { id: postId },
    select: { id: true, channel: { select: { userId: true } } },
  }).catch(() => null);
  if (!post) { res.status(404).json({ error: 'Post not found.' }); return; }
  if (post.channel.userId !== dbUser.id) {
    res.status(403).json({ error: 'This post does not belong to your account.' }); return;
  }

  try {
    await prisma.postVariant.updateMany({
      where: { generatedPostId: postId },
      data:  { bannerUrl: bannerUrl.trim() },
    });
  } catch (err) {
    console.error('[posts/set-banner] DB update failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }

  res.json({ ok: true });
});

// ─── POST /api/posts/set-cover-text ──────────────────────────────────────────
//
// Re-renders the cover headline over the stored clean base (coverBaseUrl) — the
// picture stays identical, only the overlaid text changes. An empty `text`
// removes the headline. Requires a coverBaseUrl (covers generated before this
// feature don't have one → 409 NO_COVER_BASE, asking the user to regenerate the
// visual once). Does NOT consume a regeneration.
//
// Request body: { initData, postId, text }
// Response 200: { bannerUrl }
// Response 400/401/403/404/409/500/502 as elsewhere

router.post('/set-cover-text', async (req: Request, res: Response): Promise<void> => {
  const { initData, postId, text } = req.body as {
    initData?: unknown;
    postId?:   unknown;
    text?:     unknown;
  };

  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' }); return;
  }
  if (typeof postId !== 'string' || !postId.trim()) {
    res.status(400).json({ error: 'postId is required' }); return;
  }
  if (typeof text !== 'string') {          // empty string allowed (removes text)
    res.status(400).json({ error: 'text must be a string' }); return;
  }
  if (text.length > 300) {
    res.status(400).json({ error: 'text exceeds maximum length of 300 characters' }); return;
  }

  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return;
  }

  const telegramId = String(parsed.user.id);
  const dbUser = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } }).catch(() => null);
  if (!dbUser) { res.status(401).json({ error: 'User not found. Please re-open the app.' }); return; }

  // Load base + brand style for re-render, with ownership check.
  const post = await prisma.generatedPost.findUnique({
    where:  { id: postId },
    select: {
      id:           true,
      coverBaseUrl: true,
      channel: {
        select: {
          userId:   true,
          brandKit: { select: { visualKit: true } },
        },
      },
    },
  }).catch(() => null);

  if (!post) { res.status(404).json({ error: 'Post not found.' }); return; }
  if (post.channel.userId !== dbUser.id) {
    res.status(403).json({ error: 'This post does not belong to your account.' }); return;
  }
  if (!post.coverBaseUrl) {
    res.status(409).json({
      error: 'Regenerate the cover once to enable text editing.',
      code:  'NO_COVER_BASE',
    });
    return;
  }

  const bannerUrl = await renderCoverFromBase(post.coverBaseUrl, text, post.channel.brandKit?.visualKit ?? null);
  if (!bannerUrl) {
    res.status(502).json({ error: 'Could not render the cover text. Try again.' }); return;
  }

  try {
    await prisma.postVariant.updateMany({
      where: { generatedPostId: postId },
      data:  { bannerUrl },
    });
  } catch (err) {
    console.error('[posts/set-cover-text] DB update failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' }); return;
  }

  res.json({ bannerUrl });
});

export default router;
