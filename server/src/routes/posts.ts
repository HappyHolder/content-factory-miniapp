import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';

const router = Router();

// ─── Placeholder generation helpers ──────────────────────────────────────────
// No AI — deterministic templates that embed the user's input.
// Replaced by real AI in a later phase without changing the route contract.

function buildTitle(input: string): string {
  const firstLine = input.split('\n')[0]?.trim() ?? '';
  if (!firstLine) return 'Generated post';
  return firstLine.length <= 60 ? firstLine : firstLine.slice(0, 57) + '…';
}

interface VariantDraft {
  label: string;
  text:  string;
}

function buildVariants(input: string, title: string): VariantDraft[] {
  const preview = input.length > 200 ? input.slice(0, 200) + '…' : input;
  const short   = input.length > 80  ? input.slice(0, 80)  + '…' : input;

  // Variant A — concise: title + full preview + brief close
  const textA =
    `${title}\n\n` +
    `${preview}\n\n` +
    `Worth paying close attention to.`;

  // Variant B — structured: header + bullet list + close
  const textB =
    `${title}\n\n` +
    `Here's what matters:\n\n` +
    `→ ${short}\n` +
    `→ The context shapes everything here\n` +
    `→ The details will determine the outcome\n\n` +
    `More signal, less noise.`;

  // Variant C — punchy: short hook + sharp close
  const textC =
    `${short}\n\n` +
    `Here's the real point: this changes the picture.\n\n` +
    `Not hype. Signal worth tracking.`;

  return [
    { label: 'Variant A', text: textA },
    { label: 'Variant B', text: textB },
    { label: 'Variant C', text: textC },
  ];
}

// Maps DB PostStatus enum value to the frontend lowercase string.
function mapStatus(s: string): 'new' | 'scheduled' | 'published' {
  if (s === 'SCHEDULED') return 'scheduled';
  if (s === 'PUBLISHED') return 'published';
  return 'new';   // NEW, FAILED, ARCHIVED all surface as 'new' in the Mini App
}

// ─── POST /api/posts/generate ─────────────────────────────────────────────────
//
// Creates a GeneratedPost + 3 PostVariant rows in Neon using placeholder text.
// No AI call. Designed to be upgraded to real generation without breaking the
// route contract (same request / response shape).
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

  // ── 5. Build placeholder content ─────────────────────────────────────────
  const title         = buildTitle(trimmedInput);
  const sourceSummary = trimmedInput.slice(0, 120);
  const variantDrafts = buildVariants(trimmedInput, title);

  // ── 6. Persist: GeneratedPost + 3 PostVariant rows ───────────────────────
  // Interactive transaction (Prisma 5, GA):
  //   Step A — create post with nested variants in one round-trip
  //   Step B — write selectedVariantId (needs variant IDs from step A)
  let dbPost: {
    id:               string;
    title:            string;
    channelId:        string;
    sourceType:       string | null;
    sourceSummary:    string | null;
    status:           string;
    selectedVariantId: string | null;
    createdAt:        Date;
    variants: {
      id:         string;
      label:      string | null;
      text:       string;
      isSelected: boolean;
    }[];
  };

  try {
    dbPost = await prisma.$transaction(async (tx) => {
      const created = await tx.generatedPost.create({
        data: {
          title,
          channelId:     channel!.id,
          sourceType:    sourceType as string,
          sourceSummary,
          status:        'NEW',
          variants: {
            create: variantDrafts.map((v, i) => ({
              label:        v.label,
              variantIndex: i,
              text:         v.text,
              isSelected:   i === 0,
            })),
          },
        },
        include: {
          variants: { orderBy: { variantIndex: 'asc' } },
        },
      });

      const firstVariantId = created.variants[0]!.id;

      await tx.generatedPost.update({
        where: { id: created.id },
        data:  { selectedVariantId: firstVariantId },
      });

      // Return the fully assembled object — selectedVariantId is now set
      return { ...created, selectedVariantId: firstVariantId };
    });
  } catch (err) {
    console.error('[posts/generate] DB transaction failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  // ── 7. Map to frontend shape and respond ─────────────────────────────────
  // - status: DB enum (uppercase) → frontend string (lowercase)
  // - createdAt: Date → ISO string (frontend converts back with new Date())
  // - banner: omitted entirely (optional in frontend type; PostCard handles absent gracefully)
  // - linkButtons: [] required by frontend GeneratedPost type
  // - channelUsername: Channel.handle preferred; Channel.name as fallback
  res.json({
    post: {
      id:               dbPost.id,
      title:            dbPost.title,
      sourceType:       dbPost.sourceType ?? sourceType,
      sourceUrl:        null,
      sourceSummary:    dbPost.sourceSummary ?? '',
      channelId:        dbPost.channelId,
      channelUsername:  channel.handle ?? channel.name,
      variants:         dbPost.variants.map(v => ({
        id:         v.id,
        label:      v.label ?? 'Variant',
        text:       v.text,
        isSelected: v.id === dbPost.selectedVariantId,
      })),
      selectedVariantId: dbPost.selectedVariantId,
      linkButtons:       [],
      status:            mapStatus(dbPost.status),
      createdAt:         dbPost.createdAt.toISOString(),
      scheduledAt:       null,
      publishedAt:       null,
      textRegensUsed:    0,
      imageRegensUsed:   0,
    },
  });
});

export default router;
