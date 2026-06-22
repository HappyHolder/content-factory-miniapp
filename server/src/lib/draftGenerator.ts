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
import { env } from '../env';
import { generatePostVariants, generateImagePromptWithAI, classifyPostForTemplate, selectHtmlTemplate, fillTemplateSlots } from './aiGenerator';
import { generateImageForPost, type GeneratedCover } from './imageGenerator';
import { renderTemplateCover, extractBrand } from './templateRenderer';
import { renderHtmlTemplate, renderHtmlString } from './playwrightRenderer';
import { generateHtmlCover, generateHtmlOverlay, buildFallbackOverlayHtml, composeTemplateOverPhoto } from './claudeHtmlGenerator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parses visualKit.htmlTemplates into a clean { name, url } list. */
function parseHtmlTemplates(vkObj: Record<string, unknown>): { name: string; url: string }[] {
  const raw = vkObj['htmlTemplates'];
  return Array.isArray(raw)
    ? (raw as unknown[])
        .filter((t): t is { name: string; url: string } =>
          !!t && typeof t === 'object' &&
          typeof (t as Record<string, unknown>)['name'] === 'string' &&
          typeof (t as Record<string, unknown>)['url']  === 'string' &&
          !!(t as Record<string, unknown>)['url'])
    : [];
}

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
  coverModeOverride?: 'ai' | 'html' | 'ai_html'; // per-generation cover engine; overrides channel setting
  modelTier?: 'LOW' | 'HIGH'; // LOW = DeepSeek/Flux (default); HIGH = Claude/GPT Image
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
  coverMode:         'ai' | 'html' | 'ai_html';
  coverAspectRatio:  '1:1' | '16:9' | '4:5' | '9:16';
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
  const { channelId, input, sourceType, sourceUrl, imagePrompt, useBrandKit = true, imageOnly = false, allowHtmlCovers = true, coverModeOverride, modelTier = 'LOW' } = params;

  // HIGH tier routes the AI picture model to GPT Image; LOW keeps Flux (env.IMAGE_MODEL).
  const imageModel = modelTier === 'HIGH' ? env.HIGH_IMAGE_MODEL : env.IMAGE_MODEL;

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
      }, modelTier);

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
  // Per-generation override (Create tab switch) wins over the channel setting.
  const rawCoverMode = coverModeOverride
    ?? (typeof vkObj?.['coverMode'] === 'string' ? vkObj['coverMode'] as string : 'ai');
  const normalizedCoverMode: 'ai' | 'html' | 'ai_html' =
    rawCoverMode === 'html' || rawCoverMode === 'ai_html' ? rawCoverMode : 'ai';
  // HTML and AI+HTML modes use Sonnet (paid); FREE tier is coerced to AI/Flux.
  const isPaidMode = normalizedCoverMode === 'html' || normalizedCoverMode === 'ai_html';
  const coverMode: 'ai' | 'html' | 'ai_html' =
    (isPaidMode && !allowHtmlCovers) ? 'ai' : normalizedCoverMode;
  if (isPaidMode && !allowHtmlCovers) {
    console.warn('[draftGenerator] Paid cover mode not allowed on this plan — using AI/Flux');
  }
  const rawAspectRatio = vkObj?.['aspectRatio'];
  const aspectRatio: '1:1' | '16:9' | '4:5' | '9:16' =
    rawAspectRatio === '16:9' || rawAspectRatio === '4:5' || rawAspectRatio === '9:16'
      ? rawAspectRatio
      : '1:1';
  // Cover text language: 'auto' (default) follows the post language.
  const rawCoverLang = vkObj?.['coverLanguage'];
  const coverLanguage: 'ru' | 'en' | undefined =
    rawCoverLang === 'ru' || rawCoverLang === 'en' ? rawCoverLang as 'ru' | 'en' : undefined;

  // Channel identity for slot filling / overlay — so covers read as THIS channel
  // (author/rubric/tags = the channel's own, content in the channel's voice),
  // never mirrored from the source outlet. Shared by all cover paths below.
  const bkRec = (brandKit && typeof brandKit === 'object') ? brandKit as Record<string, unknown> : null;
  const slotBrandCtx = {
    handle: channel.handle,
    name:   channel.name,
    about:  bkRec && typeof bkRec['channelAbout'] === 'object'
      ? JSON.stringify(bkRec['channelAbout']).slice(0, 400) : undefined,
    voice:  bkRec?.['voiceProfile']
      ? JSON.stringify(bkRec['voiceProfile']).slice(0, 400) : undefined,
  };

  // Persist what this post actually used. The channel setting may change later,
  // and Create can override it for a single generation.
  await prisma.generatedPost.update({
    where: { id: dbPost.id },
    data:  { coverMode, coverAspectRatio: aspectRatio },
  });

  // ── AI+HTML hybrid: Flux themed background + channel-styled overlay on top ──
  if (coverMode === 'ai_html' && useBrandKit && vkObj) {
    const brand = extractBrand(visualKit);
    let classification: Awaited<ReturnType<typeof classifyPostForTemplate>> | null = null;
    let bgUrl: string | null = null;
    try {
      classification = await classifyPostForTemplate(title, sourceSummary, coverLanguage);

      // 1. The channel's HTML template — the overlay must speak the channel's
      //    design language. Without it Sonnet converges on the same generic
      //    scrim+accent-bar look the sharp overlay already draws in AI mode.
      const htmlTemplates = parseHtmlTemplates(vkObj);
      const chosen = htmlTemplates.length > 0
        ? await selectHtmlTemplate(htmlTemplates, title, sourceSummary)
        : null;
      let referenceHtml: string | null = null;
      if (chosen) {
        try {
          const res = await fetch(chosen.url);
          if (res.ok) referenceHtml = await res.text();
        } catch (err) {
          console.warn('[draftGenerator] Hybrid: reference template fetch failed:', (err as Error).message);
        }
      }
      console.log(`[draftGenerator] Hybrid: template=${chosen?.name ?? 'none'} (${htmlTemplates.length} in DB), refHtml=${referenceHtml?.length ?? 0} chars`);

      // 2. Themed background prompt. Always distil through the art director so the
      //    Flux background is a clean, text-free scene — even when the user pastes
      //    the article text into the image-prompt field (raw long text makes Flux
      //    render people + burned-in gibberish). The user's image prompt is passed
      //    only as an art-direction hint; the raw text is a last-resort fallback if
      //    the distiller is unavailable.
      let bgPrompt: string | null = null;
      try {
        bgPrompt = await generateImagePromptWithAI({
          title,
          excerpt: sourceSummary,
          visualKit,
          artDirection: imagePrompt?.trim() || undefined,
        });
      } catch (err) {
        console.warn('[draftGenerator] Hybrid: bg prompt generation failed:', (err as Error).message);
      }
      if (!bgPrompt) bgPrompt = imagePrompt?.trim() || null;

      // 3. Clean, text-free Flux background. One retry — a transient Replicate
      //    failure here would otherwise degrade the cover to a no-photo Satori card.
      if (bgPrompt) {
        for (let attempt = 1; attempt <= 2 && !bgUrl; attempt++) {
          try {
            const bg = await generateImageForPost({ prompt: bgPrompt, visualKit, aspectRatio, backgroundOnly: true, model: imageModel });
            bgUrl = bg?.bannerUrl ?? null;
            if (!bgUrl) console.warn(`[draftGenerator] Hybrid: Flux bg attempt ${attempt} returned no image`);
          } catch (err) {
            console.warn(`[draftGenerator] Hybrid: Flux bg attempt ${attempt} failed:`, (err as Error).message);
          }
        }
      }
      console.log(`[draftGenerator] Hybrid: bgPrompt=${bgPrompt ? 'ok' : 'MISSING'}, bg=${bgUrl ?? 'FAILED'}`);

      // 4a. Deterministic path — the channel HAS a slot template: render THAT
      //     template over the photo (its real design, brand colors/logo, scrim
      //     for readability) instead of letting the model compose a generic card.
      //     This guarantees originality per channel — no AI-composition drift.
      if (bgUrl && referenceHtml && /\{\{\w+\}\}/.test(referenceHtml)) {
        const filled = await fillTemplateSlots(referenceHtml, {
          title:        classification.headline || finalTitle,
          content:      input || finalTitle,
          artDirection: imagePrompt?.trim() || undefined,
          coverLanguage,
        }, slotBrandCtx);
        if (filled) {
          const composed = composeTemplateOverPhoto(filled, bgUrl, brand);
          cover = await renderHtmlString(composed, aspectRatio);
          if (!cover) console.warn('[draftGenerator] Hybrid: template-over-photo render failed');
          else console.log('[draftGenerator] Hybrid: rendered channel template over photo (deterministic)');
        }
      }

      // 4b. No slot template (or fill failed): Sonnet composes the channel-styled
      //     overlay on the photo. One retry.
      if (bgUrl && !cover) {
        const overlayInput = {
          bgImageUrl:    bgUrl,
          referenceHtml: referenceHtml ?? undefined,
          coverLanguage,
          headline:      classification.headline || finalTitle,
          subheadline:   classification.subheadline,
          category:      classification.category,
          postContent:   input || undefined,
          artDirection:  imagePrompt?.trim() || undefined,
          logoUrl:       brand.logoUrl ?? undefined,
          primaryColor:  brand.primaryColor,
          aspectRatio,
          // Channel identity so the overlay's byline/tags stay the channel's own
          // and never mirror the source outlet (e.g. "Anthropic News").
          brand: slotBrandCtx,
        };
        for (let attempt = 1; attempt <= 2 && !cover; attempt++) {
          const overlayHtml = await generateHtmlOverlay(overlayInput);
          if (!overlayHtml) {
            console.warn(`[draftGenerator] Hybrid: overlay generation attempt ${attempt} produced nothing`);
            continue;
          }
          cover = await renderHtmlString(overlayHtml, aspectRatio);
          if (!cover) console.warn(`[draftGenerator] Hybrid: overlay render attempt ${attempt} failed`);
        }
      }
    } catch (err) {
      console.warn('[draftGenerator] AI+HTML hybrid failed (non-fatal):', (err as Error).message);
    }

    // The photo exists but Sonnet/render failed twice — render our own minimal
    // branded overlay. Keeps the photo and crisp HTML text; never sharp.
    if (!cover && bgUrl) {
      console.warn('[draftGenerator] Hybrid: using deterministic overlay fallback');
      try {
        cover = await renderHtmlString(buildFallbackOverlayHtml({
          bgImageUrl:   bgUrl,
          headline:     classification?.headline || finalTitle,
          subheadline:  classification?.subheadline,
          category:     classification?.category,
          logoUrl:      brand.logoUrl ?? undefined,
          primaryColor: brand.primaryColor,
          aspectRatio,
        }), aspectRatio);
      } catch (err) {
        console.warn('[draftGenerator] Hybrid: fallback overlay render failed:', (err as Error).message);
      }
    }

    // Last resort — no background photo at all (Flux down twice): branded Satori
    // template. Never Flux+sharp, whose burned-in text this mode exists to avoid.
    if (!cover) {
      try {
        if (!classification) classification = await classifyPostForTemplate(title, sourceSummary, coverLanguage);
        console.warn('[draftGenerator] Hybrid: no photo and no overlay — falling back to Satori');
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
      } catch (err) {
        console.warn('[draftGenerator] Hybrid: Satori fallback failed (non-fatal):', (err as Error).message);
      }
    }
  }

  // ── HTML mode: user templates + Sonnet ────────────────────────────────────
  // HTML mode NEVER falls through to Flux — it stays in the template engine
  // (Sonnet → slot render → Satori). Flux would replace the brand layout with a
  // generic neural image and burn the wrong (costly) engine.
  if (coverMode === 'html' && useBrandKit && vkObj) {
    try {
      const brand = extractBrand(visualKit);
      const classification = await classifyPostForTemplate(title, sourceSummary, coverLanguage);

      // Load named HTML templates (multi-template system)
      const htmlTemplates = parseHtmlTemplates(vkObj);

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
          const hasSlots = /\{\{\w+\}\}/.test(refHtml);

          if (hasSlots) {
            // Slot template: fill {{SLOTS}} with AI content and render the RAW
            // template untouched — its layout and colors stay exactly 1:1.
            // Pass the channel identity so author/rubric/tag slots stay the
            // channel's own and content is written in the channel's voice —
            // never mirrored from the source outlet.
            const filled = await fillTemplateSlots(refHtml, {
              title:        classification.headline || finalTitle,
              content:      input || finalTitle,
              artDirection: imagePrompt?.trim() || undefined,
              coverLanguage,
            }, slotBrandCtx);
            if (filled) {
              cover = await renderHtmlString(filled, aspectRatio);
            }
          } else {
            // Free-form template (no slots): Sonnet composes the cover using the
            // template as the design to follow, with the post's real content.
            const generatedHtml = await generateHtmlCover({
              referenceHtml: refHtml,
              coverLanguage,
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
  // Same engine as POST /api/posts/regenerate-visual. Only runs in pure AI mode —
  // html and ai_html handle their own fallbacks above and must never reach
  // Flux+sharp with its burned-in text.
  if (!cover && coverMode === 'ai') {
    // Always distil through the art director so the Flux prompt is a clean,
    // text-free scene even when the user pasted the article into the image-prompt
    // field. The user's prompt is passed as an art-direction hint; the raw text is
    // only a fallback when distillation is unavailable (e.g. no AI provider).
    let resolvedImagePrompt: string | null = null;

    if (useBrandKit) {
      try {
        resolvedImagePrompt = await generateImagePromptWithAI({
          title,
          excerpt: sourceSummary,
          visualKit,
          artDirection: imagePrompt?.trim() || undefined,
        });
      } catch (err) {
        console.warn('[draftGenerator] Auto image prompt generation failed:', (err as Error).message);
      }
    }
    if (!resolvedImagePrompt) resolvedImagePrompt = imagePrompt?.trim() || null;

    if (resolvedImagePrompt) {
      // Sharp burns the post title onto the cover; when the channel pins a
      // cover language, take a translated headline from the classifier instead.
      let aiHeadline = finalTitle;
      if (coverLanguage && useBrandKit && vkObj?.['textOnCover'] !== false) {
        try {
          const c = await classifyPostForTemplate(title, sourceSummary, coverLanguage);
          aiHeadline = c.headline || finalTitle;
        } catch (err) {
          console.warn('[draftGenerator] Cover-language headline failed, using title:', (err as Error).message);
        }
      }
      try {
        cover = await generateImageForPost({
          prompt:   resolvedImagePrompt,
          visualKit,
          aspectRatio,
          headline: aiHeadline,
          model:    imageModel,
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
    coverMode,
    coverAspectRatio: aspectRatio,
  };
}
