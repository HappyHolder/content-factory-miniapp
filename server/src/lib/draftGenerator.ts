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
import { generatePostVariants, generateImagePromptWithAI, classifyPostForTemplate, selectHtmlTemplate } from './aiGenerator';
import { generateImageForPost, type GeneratedCover } from './imageGenerator';
import { renderTemplateCover, extractBrand } from './templateRenderer';
import { renderHtmlTemplate, renderHtmlString } from './playwrightRenderer';
import { generateHtmlCover } from './claudeHtmlGenerator';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CreateDraftParams {
  channelId:    string;
  input:        string;
  sourceType:   string;
  sourceUrl:    string | null;
  imagePrompt?: string;    // optional; if provided, Replicate image generation is attempted
  useBrandKit?: boolean;   // default true; false = ignore channel style for this generation
  imageOnly?:   boolean;   // skip text AI generation, produce one empty-text variant
  allowHtmlCovers?: boolean; // default true; false (FREE tier) forces coverMode 'ai'
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
 * Derives a clean headline from the generated post text: the first non-empty
 * line with markdown markers stripped, capped to ~80 chars. Used for the post
 * title and cover headline so they reflect the actual post, not the raw input's
 * first line (which for links/tweets is often an author handle or URL).
 */
function extractHeadline(text: string): string {
  const firstLine = text.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
  const cleaned = firstLine
    .replace(/^#{1,6}\s*/, '')   // markdown heading marker
    .replace(/^[-*•>]\s*/, '')   // bullet / quote marker
    .replace(/\*\*|__/g, '')     // bold markers
    .trim();
  if (!cleaned) return '';
  return cleaned.length <= 80 ? cleaned : cleaned.slice(0, 79).replace(/[\s.,;:!?—-]*$/, '') + '…';
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
  const { channelId, input, sourceType, sourceUrl, imagePrompt, useBrandKit = true, imageOnly = false, allowHtmlCovers = true } = params;

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

  // Prefer the AI-written headline (first line of the generated post) over the
  // raw input's first line — for links/tweets the latter is often junk (author
  // handle, URL). Falls back to the input-based title (and for image-only mode).
  const contentHeadline = imageOnly ? '' : extractHeadline(variantDrafts[0]?.text ?? '');
  const finalTitle = contentHeadline || title;

  // ── Persist: GeneratedPost + 3 PostVariant rows (interactive transaction) ─
  // Step A — create post with nested variants in one round-trip.
  // Step B — write selectedVariantId (needs variant IDs from step A).
  const dbPost = await prisma.$transaction(async (tx) => {
    const created = await tx.generatedPost.create({
      data: {
        title: finalTitle,
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

  // ── Cover generation ─────────────────────────────────────────────────────
  // Two modes, driven by visualKit.coverMode (chosen in the UI):
  //   'ai'   — Flux neural image via Replicate (same engine as "Regenerate visual")
  //   'html' — user's HTML style templates → Sonnet composes a unique cover,
  //            Playwright renders it (Satori only as an internal fallback)
  let cover: GeneratedCover | null = null;

  const vkObj = (visualKit && typeof visualKit === 'object')
    ? visualKit as Record<string, unknown>
    : null;
  const rawCoverMode = typeof vkObj?.['coverMode'] === 'string'
    ? vkObj['coverMode'] as string : 'ai';
  // HTML mode is a paid feature; FREE tier (allowHtmlCovers=false) is coerced to AI.
  const coverMode = (rawCoverMode === 'html' && !allowHtmlCovers) ? 'ai' : rawCoverMode;
  if (rawCoverMode === 'html' && !allowHtmlCovers) {
    console.warn('[draftGenerator] HTML cover mode not allowed on this plan — using AI/Flux');
  }
  const aspectRatio = (typeof vkObj?.['aspectRatio'] === 'string'
    ? vkObj['aspectRatio'] : '1:1') as '1:1' | '16:9' | '4:5' | '9:16';

  // ── HTML mode: user templates + Sonnet ────────────────────────────────────
  // HTML mode NEVER falls through to Flux — it stays in the template engine
  // (Sonnet → slot render → Satori). Flux would replace the brand layout with a
  // generic neural image and burn the wrong (costly) engine.
  if (coverMode === 'html' && useBrandKit && vkObj) {
    try {
      const brand = extractBrand(visualKit);
      const classification = await classifyPostForTemplate(title, sourceSummary);

      // Load named HTML templates (multi-template system)
      const rawTemplates = vkObj['htmlTemplates'];
      const htmlTemplates: { name: string; url: string }[] =
        Array.isArray(rawTemplates)
          ? (rawTemplates as unknown[])
              .filter((t): t is { name: string; url: string } =>
                !!t && typeof t === 'object' &&
                typeof (t as Record<string, unknown>)['name'] === 'string' &&
                typeof (t as Record<string, unknown>)['url']  === 'string' &&
                !!(t as Record<string, unknown>)['url'])
          : [];

      const chosen = htmlTemplates.length > 0
        ? await selectHtmlTemplate(htmlTemplates, title, sourceSummary)
        : null;

      console.log(`[draftGenerator] HTML mode: ${htmlTemplates.length} template(s) in DB, chosen=${chosen?.url ?? 'none'}`);

      if (chosen) {
        // Fetch the reference HTML from Blob
        let refHtml: string | null = null;
        try {
          const res = await fetch(chosen.url);
          if (res.ok) refHtml = await res.text();
        } catch (err) {
          console.warn('[draftGenerator] Failed to fetch reference HTML:', (err as Error).message);
        }

        if (refHtml) {
          // Sonnet composes a unique cover in the channel's visual style.
          // Pass the full post input so it uses real facts, not invented text,
          // and the user's prompt as art direction (layout / card wishes).
          const generatedHtml = await generateHtmlCover({
            referenceHtml: refHtml,
            headline:      classification.headline || finalTitle,
            subheadline:   classification.subheadline,
            stat:          classification.stat,
            category:      classification.category,
            postContent:   input || undefined,
            artDirection:  imagePrompt?.trim() || undefined,
            logoUrl:       brand.logoUrl ?? undefined,
            primaryColor:  brand.primaryColor,
            bgColor:       brand.bgColor,
            aspectRatio,
          });
          if (generatedHtml) {
            cover = await renderHtmlString(generatedHtml, aspectRatio);
          }
        }

        // Slot-based render of the chosen template if Sonnet failed.
        if (!cover) {
          cover = await renderHtmlTemplate({
            htmlTemplateUrl: chosen.url,
            brand,
            classification,
            headline: classification.headline || finalTitle,
            aspectRatio,
          });
        }
      }

      // Final fallback for HTML mode: branded Satori template. Runs when there
      // are no templates uploaded, or when every HTML attempt failed.
      if (!cover) {
        console.warn(htmlTemplates.length === 0
          ? '[draftGenerator] HTML mode but no templates uploaded — using Satori'
          : '[draftGenerator] HTML cover attempts failed — falling back to Satori');
        cover = await renderTemplateCover({
          template:    classification.template,
          headline:    classification.headline || finalTitle,
          subheadline: classification.subheadline,
          stat:        classification.stat,
          statCards:   classification.statCards,
          category:    classification.category,
          brand,
          aspectRatio,
        });
      }
    } catch (err) {
      console.warn('[draftGenerator] HTML cover render failed (non-fatal):', (err as Error).message);
    }
  }

  // ── AI mode: Flux neural image via Replicate ───────────────────────────────
  // Same engine as POST /api/posts/regenerate-visual. Only runs in AI mode —
  // HTML mode handles its own fallbacks above and must never reach Flux.
  if (!cover && coverMode !== 'html') {
    let resolvedImagePrompt: string | null = imagePrompt?.trim() || null;

    if (!resolvedImagePrompt && useBrandKit) {
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
      try {
        cover = await generateImageForPost({
          prompt:   resolvedImagePrompt,
          visualKit,
          headline: finalTitle,
        });
      } catch (err) {
        console.warn('[draftGenerator] Image generation failed (non-fatal):', (err as Error).message);
      }
    }
  }

  // Persist cover URLs to DB (non-fatal)
  if (cover?.bannerUrl) {
    const variantIds = dbPost.variants.map(v => v.id);
    if (variantIds.length > 0) {
      try {
        await prisma.postVariant.updateMany({
          where: { id: { in: variantIds } },
          data:  { bannerUrl: cover.bannerUrl },
        });
        firstVariantBannerUrl = cover.bannerUrl;
        if (cover.coverBaseUrl) {
          await prisma.generatedPost.update({
            where: { id: dbPost.id },
            data:  { coverBaseUrl: cover.coverBaseUrl },
          }).catch(() => { /* non-fatal: text editing just won't be available */ });
        }
      } catch (err) {
        console.error('[draftGenerator] Failed to persist bannerUrl to DB:', (err as Error).message);
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
