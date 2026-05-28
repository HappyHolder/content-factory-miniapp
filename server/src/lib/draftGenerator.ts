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
import { generatePostVariants } from './aiGenerator';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CreateDraftParams {
  channelId:  string;
  input:      string;
  sourceType: string;
  sourceUrl:  string | null;
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
  const { channelId, input, sourceType, sourceUrl } = params;

  // ── Load channel ──────────────────────────────────────────────────────────
  const channel = await prisma.channel.findUniqueOrThrow({
    where:  { id: channelId },
    select: { id: true, handle: true, name: true },
  });

  // ── Load BrandKit (non-fatal — generation continues without style if absent) ─
  let brandKit: unknown | null = null;
  try {
    const bk = await prisma.brandKit.findUnique({
      where:  { channelId },
      select: {
        channelAbout: true,
        voiceProfile: true,
        postRules:    true,
        emojiPack:    true,
        linkKit:      true,
        signature:    true,
      },
    });
    brandKit = bk ?? null;
  } catch (err) {
    console.error('[draftGenerator] BrandKit lookup failed:', (err as Error).message);
  }

  // ── Extract button links from BrandKit (non-fatal — empty array if absent) ─
  const buttonLinks = extractButtonLinks(brandKit);

  // ── Generate variant drafts (AI or placeholder fallback) ──────────────────
  const title         = buildTitle(input);
  const sourceSummary = input.slice(0, 120);
  const variantDrafts = await generatePostVariants({
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
        sourceUrl:   sourceUrl ?? null,
        status:      'NEW',
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

  // ── Map to frontend shape ─────────────────────────────────────────────────
  // - status always 'new' (just created)
  // - createdAt as ISO string (frontend does new Date() on receipt)
  // - linkButtons: BrandKit links with usage 'button' | 'always' (may be [])
  // - channelUsername: handle preferred; name as fallback
  return {
    id:               dbPost.id,
    title:            dbPost.title,
    sourceType:       dbPost.sourceType ?? sourceType,
    sourceUrl:        dbPost.sourceUrl ?? null,
    sourceSummary:    dbPost.sourceSummary ?? '',
    channelId:        dbPost.channelId,
    channelUsername:  channel.handle ?? channel.name,
    variants: dbPost.variants.map(v => ({
      id:         v.id,
      label:      v.label ?? 'Variant',
      text:       v.text,
      isSelected: v.id === dbPost.selectedVariantId,
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
