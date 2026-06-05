/**
 * draftGenerator.ts
 *
 * Shared helper: given a channelId + source text, loads BrandKit, generates
 * 3 post variants via AI (or placeholder fallback), persists GeneratedPost +
 * PostVariant rows in a Prisma transaction, and returns the frontend-compatible
 * post shape identical to what POST /api/posts/generate returns.
 *
 * Used by:
 *   - POST /api/posts/generate (manual Create → Generate flow)
 *   - POST /api/bot/webhook   (automatic draft from bot source)
 */

import { prisma } from '../db';
import { generatePostVariants, generateImagePromptWithAI } from './aiGenerator';
import { generateImageForPost } from './imageGenerator';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CreateDraftParams {
  channelId:    string;
  input:        string;
  sourceType:   string;
  sourceUrl:    string | null;
  imagePrompt?: string;    // optional; if provided, Replicate image generation is attempted
  useBrandKit?: boolean;   // default true; false = ignore channel style for this generation
  imageOnly?:   boolean;   // skip text AI generation, produce one empty-text variant
}

/** Frontend-compatible post shape — identical to what /api/posts/generate returns. */
export interface DraftPost {
  id:               string;
  title:            string;
  sourceType:       string;
  sourceUrl:        string | null;
  sourceSummary:    string;
  channelId:        string;
  channelUsername:  string;
  variants: {
    id:         string;
    label:      string;
    text:       string;
    isSelected: boolean;
    bannerUrl:  string | null;
  }[];
  selectedVariantId: string | null;
  linkButtons:       unknown[];
  status:            'new';
  createdAt:         string;   // ISO string
  scheduledAt:       null;
  publishedAt:       null;
  textRegensUsed:    number;
  imageRegensUsed:   number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildTitle(input: string): string {
  const firstLine = input.split('\n')[0]?.trim() ?? '';
  if (!firstLine) return 'Generated post';
  return firstLine.length <= 60 ? firstLine : firstLine.slice(0, 57) + '…';
}

/**
 * Extracts LinkItem entries from the BrandKit linkKit that should appear as
 * Telegram inline keyboard buttons (usage === 'button' | 'always').
 * brandKit is typed as unknown because Prisma Json columns arrive untyped.
 */
function extractButtonLinks(brandKit: unknown): {
  id: string; label: string; url: string;
  anchorText: string; buttonLabel: string; usage: string;
}[] {
  if (!brandKit || typeof brandKit !== 'object') return [];
  const lk = (brandKit as Record<string, unknown>)['linkKit'];
  if (!lk || typeof lk !== 'object' || Array.isArray(lk)) return [];
  const links = (lk as Record<string, unknown>)['links'];
  if (!Array.isArray(links)) return [];
  return links.filter((l): l is {
    id: string; label: string; url: string;
    anchorText: string; buttonLabel: string; usage: string;
  } => {
    if (!l || typeof l !== 'object') return false;
    const usage = (l as Record<string, unknown>)['usage'];
    return usage === 'button' || usage === 'always';
  });
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Creates a GeneratedPost with exactly 3 PostVariant rows for the given channel.
 *
 * - Loads BrandKit for Channel Style context (non-fatal if absent or DB error).
 * - Calls generatePostVariants() — uses DeepSeek or placeholder fallback.
 * - Runs a Prisma interactive transaction: create post+variants → set selectedVariantId.
 * - Returns the mapped frontend post shape.
 *
 * Throws on channel-not-found or DB transaction failure.
 * Callers decide how to surface those errors to users.
 */
export async function createDraftPostForChannel(
  params: CreateDraftParams,
): Promise<DraftPost> {
  const { channelId, input, sourceType, sourceUrl, imagePrompt, useBrandKit = true, imageOnly = false } = params;

  // ── Load channel ──────────────────────────────────────────────────────────
  const channel = await prisma.channel.findUniqueOrThrow({
    where:  { id: channelId },
    select: { id: true, handle: true, name: true },
  });

  // ── Load BrandKit (skipped when useBrandKit === false) ───────────────────
  // When useBrandKit is false the user has explicitly asked the model to follow
  // their prompt directly, ignoring channel style. BrandKit is not loaded so
  // the AI receives no style context, and no link buttons are injected.
  let brandKit: unknown | null = null;
  if (useBrandKit) {
    try {
      const bk = await prisma.brandKit.findUnique({
        where:  { channelId },
        select: {
          channelAbout: true,
          voiceProfile: true,
          postRules:    true,
          linkKit:      true,
          signature:    true,
          visualKit:    true,
        },
      });
      brandKit = bk ?? null;
    } catch (err) {
      console.error('[draftGenerator] BrandKit lookup failed:', (err as Error).message);
    }
  }

  // ── Extract button links from BrandKit (empty when useBrandKit === false) ─
  const buttonLinks = extractButtonLinks(brandKit);

  // ── Generate variant drafts (AI or placeholder fallback) ──────────────────
  const title         = buildTitle(input || imagePrompt || 'Image post');
  const sourceSummary = (input || imagePrompt || '').slice(0, 120);
  const variantDrafts = imageOnly
    ? [{ label: 'Visual', text: '' }]
    : await generatePostVariants({
        input,
        sourceType,
        channel: { handle: channel.handle, name: channel.name },
        brandKit,
      });

  // ── Persist: GeneratedPost + 3 PostVariant rows (interactive transaction) ─
  // Step A — create post with nested variants in one round-trip.
  // Step B — write selectedVariantId (needs variant IDs from step A).
  const dbPost = await prisma.$transaction(async (tx) => {
    const created = await tx.generatedPost.create({
      data: {
        title,
        channelId,
        sourceType,
        sourceSummary,
        sourceUrl:    sourceUrl ?? null,
        imagePrompt:  imagePrompt?.trim() || null,
        status:       'NEW',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        linkButtons: buttonLinks as any,
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

    // Return fully assembled object — selectedVariantId is now set
    return { ...created, selectedVariantId: firstVariantId };
  });

  // ── Image generation (non-fatal) ─────────────────────────────────────────
  // Image prompt priority:
  //   1. User-provided imagePrompt (explicit override — use as-is)
  //   2. AI-generated prompt from post title + BrandKit visual style (auto)
  //   3. Skip image generation (AI_PROVIDER=placeholder, no DeepSeek configured)
  //
  // The AI translates post topic + brand colors/mood into natural visual English
  // so the image model receives "electric blue neon road, dark space atmosphere"
  // instead of raw hex tokens that get rendered as visible text on the image.
  //
  // DB persistence is in a separate try/catch so a write failure doesn't leave
  // the response inconsistent with what /list will return from DB.
  let firstVariantBannerUrl: string | null = null;

  const visualKit = (useBrandKit && brandKit && typeof brandKit === 'object')
    ? (brandKit as Record<string, unknown>)['visualKit'] ?? undefined
    : undefined;

  // Resolve final image prompt
  let resolvedImagePrompt: string | null = imagePrompt?.trim() || null;

  if (!resolvedImagePrompt && useBrandKit) {
    // Auto-generate a clean visual prompt using DeepSeek
    try {
      resolvedImagePrompt = await generateImagePromptWithAI({
        title,
        excerpt: sourceSummary,
        visualKit,
      });
    } catch (err) {
      console.warn('[draftGenerator] Auto image prompt generation failed:', (err as Error).message);
    }
  }

  if (resolvedImagePrompt) {
    // Step 1: generate image (non-fatal)
    let generatedImageUrl: string | null = null;
    try {
      generatedImageUrl = await generateImageForPost({
        prompt:    resolvedImagePrompt,
        visualKit, // brand style tokens (color names, mood) appended as suffix
        headline:  title, // overlaid as crisp text when visualKit.textOnCover !== false
      });
    } catch (err) {
      console.warn('[draftGenerator] Image generation failed (non-fatal):', (err as Error).message);
    }

    // Step 2: persist bannerUrl to ALL variants — cover is a post-level asset,
    // not tied to a specific text variant. This way switching variants keeps the visual.
    if (generatedImageUrl) {
      const variantIds = dbPost.variants.map(v => v.id);
      if (variantIds.length > 0) {
        try {
          await prisma.postVariant.updateMany({
            where: { id: { in: variantIds } },
            data:  { bannerUrl: generatedImageUrl },
          });
          firstVariantBannerUrl = generatedImageUrl;
        } catch (err) {
          console.error('[draftGenerator] Failed to persist bannerUrl to DB — clearing from response:', (err as Error).message);
        }
      }
    }
  }

  // ── Map to frontend shape ─────────────────────────────────────────────────
  // - status always 'new' (just created)
  // - createdAt as ISO string (frontend does new Date() on receipt)
  // - linkButtons: BrandKit links with usage 'button' | 'always' (may be [])
  // - channelUsername: handle preferred; name as fallback
  // - bannerUrl: only set on variant[0] if image was generated, null otherwise
  return {
    id:               dbPost.id,
    title:            dbPost.title,
    sourceType:       dbPost.sourceType ?? sourceType,
    sourceUrl:        dbPost.sourceUrl ?? null,
    sourceSummary:    dbPost.sourceSummary ?? '',
    channelId:        dbPost.channelId,
    channelUsername:  channel.handle ?? channel.name,
    variants: dbPost.variants.map((v, i) => ({
      id:         v.id,
      label:      v.label ?? 'Variant',
      text:       v.text,
      isSelected: v.id === dbPost.selectedVariantId,
      bannerUrl:  i === 0 ? firstVariantBannerUrl : null,
    })),
    selectedVariantId: dbPost.selectedVariantId,
    linkButtons:       buttonLinks,
    status:            'new',
    createdAt:         dbPost.createdAt.toISOString(),
    scheduledAt:       null,
    publishedAt:       null,
    textRegensUsed:    0,
    imageRegensUsed:   0,
  };
}
