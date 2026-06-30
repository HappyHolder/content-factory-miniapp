/**
 * coverBuilder.ts
 *
 * The cover-generation engine, extracted verbatim from draftGenerator so it can be
 * reused: once when a post is first generated, and again when the user overrides a
 * post's rubric (re-render only the cover under the new rubric's recipe).
 *
 * Three modes, decided by the caller (today: from the post's rubric, or the legacy
 * channel coverMode):
 *   'ai'      — Flux neural image + sharp headline overlay.
 *   'html'    — channel HTML template → Sonnet compose / slot-fill → Playwright,
 *               Satori as the internal fallback (never falls through to Flux).
 *   'ai_html' — hybrid: Flux text-free background + HTML overlay on top (4 fallbacks).
 *
 * Never throws — returns null when no cover could be produced so callers degrade.
 */

import {
  generateImagePromptWithAI, classifyPostForTemplate, selectHtmlTemplate, fillTemplateSlots,
} from './aiGenerator';
import { generateImageForPost, type GeneratedCover } from './imageGenerator';
import { renderTemplateCover, extractBrand } from './templateRenderer';
import { renderHtmlTemplate, renderHtmlString, measureContentZone } from './playwrightRenderer';
import {
  generateHtmlCover, generateHtmlOverlay, buildFallbackOverlayHtml, composeTemplateOverPhoto, injectBrandTokens,
} from './claudeHtmlGenerator';

/** Parses visualKit.htmlTemplates into a clean { name, url } list. */
export function parseHtmlTemplates(vkObj: Record<string, unknown>): { name: string; url: string }[] {
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

type HybridBackgroundKind = 'photo' | 'abstract';

function inferHybridBackgroundKind(referenceHtml: string | null, templateName?: string | null): HybridBackgroundKind {
  const haystack = `${templateName ?? ''}\n${referenceHtml ?? ''}`.toLowerCase();
  const isQuote = /quote_|author_|opinion|quote|04-/.test(haystack);
  const isDenseUi = /class="[^"]*(card|cards|grid|list|row|recap)[^"]*"/.test(haystack) || /(^|[\\/\\s_-])(top|recap)([\\s_.-]|$)/.test(haystack);
  return isQuote || isDenseUi ? 'abstract' : 'photo';
}

export interface BuildCoverInput {
  coverMode:    'ai' | 'html' | 'ai_html';
  useBrandKit:  boolean;
  visualKit:    unknown;
  vkObj:        Record<string, unknown> | null;
  /** The chosen rubric's template (rubric path). Null → legacy keyword pick. */
  rubricTemplate: { name: string; url: string } | null;
  rubricHybridPrompt?: string;
  title:        string;
  sourceSummary: string;
  finalTitle:   string;
  input:        string;
  imagePrompt?: string;
  coverLanguage?: 'ru' | 'en';
  aspectRatio:  '1:1' | '16:9' | '4:5' | '9:16';
  imageModel:   string;
  slotBrandCtx: { handle?: string | null; name?: string | null; about?: string; voice?: string };
}

/**
 * Builds a cover for a post given a resolved mode + (optional) template. Faithful
 * extraction of draftGenerator's cover branches — behaviour is identical.
 */
export async function buildCover(args: BuildCoverInput): Promise<GeneratedCover | null> {
  const {
    coverMode, useBrandKit, visualKit, vkObj, rubricTemplate, rubricHybridPrompt,
    title, sourceSummary, finalTitle, input, imagePrompt, coverLanguage,
    aspectRatio, imageModel, slotBrandCtx,
  } = args;

  let cover: GeneratedCover | null = null;

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
      // Rubric path: use the rubric's own template. Legacy path: keyword-pick.
      const chosen = rubricTemplate
        ?? (htmlTemplates.length > 0 ? await selectHtmlTemplate(htmlTemplates, title, sourceSummary) : null);
      let referenceHtml: string | null = null;
      if (chosen) {
        try {
          const res = await fetch(chosen.url);
          if (res.ok) referenceHtml = await res.text();
        } catch (err) {
          console.warn('[coverBuilder] Hybrid: reference template fetch failed:', (err as Error).message);
        }
      }
      console.log(`[coverBuilder] Hybrid: template=${chosen?.name ?? 'none'} (${htmlTemplates.length} in DB), refHtml=${referenceHtml?.length ?? 0} chars`);

      // When the channel has a slot template we render IT over the photo (4a).
      // Fill it now (before the photo) and MEASURE where its text sits, so the
      // photo can keep exactly that zone calmer for legibility — instead of a
      // hardcoded "dark lower half". The rest of the frame stays full of detail.
      const willRenderTemplateOverPhoto = !!referenceHtml && /\{\{\w+\}\}/.test(referenceHtml);
      let filledTemplate: string | null = null;
      let templateCalmZone: 'top' | 'bottom' | 'left' | 'right' | 'center' | 'full' | undefined;
      if (willRenderTemplateOverPhoto) {
        filledTemplate = await fillTemplateSlots(referenceHtml!, {
          title:        classification.headline || finalTitle,
          content:      input || finalTitle,
          artDirection: imagePrompt?.trim() || undefined,
          coverLanguage,
        }, slotBrandCtx);
        if (filledTemplate) {
          templateCalmZone =
            (await measureContentZone(injectBrandTokens(filledTemplate, brand), aspectRatio)) ?? 'full';
          console.log(`[coverBuilder] Hybrid: template text zone = ${templateCalmZone}`);
        }
      }

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
          fullBleed: willRenderTemplateOverPhoto,
          backgroundKind: referenceHtml ? inferHybridBackgroundKind(referenceHtml, chosen?.name) : 'photo',
          hybridPrompt: rubricHybridPrompt,
        });
      } catch (err) {
        console.warn('[coverBuilder] Hybrid: bg prompt generation failed:', (err as Error).message);
      }
      if (!bgPrompt) bgPrompt = [imagePrompt?.trim(), rubricHybridPrompt].filter(Boolean).join('. ') || null;

      // 3. Clean, text-free Flux background. One retry — a transient Replicate
      //    failure here would otherwise degrade the cover to a no-photo Satori card.
      if (bgPrompt) {
        for (let attempt = 1; attempt <= 2 && !bgUrl; attempt++) {
          try {
            const bg = await generateImageForPost({ prompt: bgPrompt, visualKit, aspectRatio, backgroundOnly: true, calmZone: templateCalmZone, backgroundKind: referenceHtml ? inferHybridBackgroundKind(referenceHtml, chosen?.name) : 'photo', model: imageModel });
            bgUrl = bg?.bannerUrl ?? null;
            if (!bgUrl) console.warn(`[coverBuilder] Hybrid: Flux bg attempt ${attempt} returned no image`);
          } catch (err) {
            console.warn(`[coverBuilder] Hybrid: Flux bg attempt ${attempt} failed:`, (err as Error).message);
          }
        }
      }
      console.log(`[coverBuilder] Hybrid: bgPrompt=${bgPrompt ? 'ok' : 'MISSING'}, bg=${bgUrl ?? 'FAILED'}`);

      // 4a. Deterministic path — the channel HAS a slot template: render THAT
      //     template (filled above) over the photo (its real design, brand
      //     colors/logo, scrim for readability) instead of letting the model
      //     compose a generic card. Guarantees originality per channel.
      if (bgUrl && filledTemplate) {
        const composed = composeTemplateOverPhoto(filledTemplate, bgUrl, brand, {
          contentZone: templateCalmZone,
          backgroundKind: referenceHtml ? inferHybridBackgroundKind(referenceHtml, chosen?.name) : 'photo',
        });
        cover = await renderHtmlString(composed, aspectRatio);
        if (!cover) console.warn('[coverBuilder] Hybrid: template-over-photo render failed');
        else console.log('[coverBuilder] Hybrid: rendered channel template over photo (deterministic)');
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
            console.warn(`[coverBuilder] Hybrid: overlay generation attempt ${attempt} produced nothing`);
            continue;
          }
          cover = await renderHtmlString(overlayHtml, aspectRatio);
          if (!cover) console.warn(`[coverBuilder] Hybrid: overlay render attempt ${attempt} failed`);
        }
      }
    } catch (err) {
      console.warn('[coverBuilder] AI+HTML hybrid failed (non-fatal):', (err as Error).message);
    }

    // The photo exists but Sonnet/render failed twice — render our own minimal
    // branded overlay. Keeps the photo and crisp HTML text; never sharp.
    if (!cover && bgUrl) {
      console.warn('[coverBuilder] Hybrid: using deterministic overlay fallback');
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
        console.warn('[coverBuilder] Hybrid: fallback overlay render failed:', (err as Error).message);
      }
    }

    // Last resort — no background photo at all (Flux down twice): branded Satori
    // template. Never Flux+sharp, whose burned-in text this mode exists to avoid.
    if (!cover) {
      try {
        if (!classification) classification = await classifyPostForTemplate(title, sourceSummary, coverLanguage);
        console.warn('[coverBuilder] Hybrid: no photo and no overlay — falling back to Satori');
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
        console.warn('[coverBuilder] Hybrid: Satori fallback failed (non-fatal):', (err as Error).message);
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

      // Rubric path: use the rubric's own template. Legacy path: keyword-pick.
      const chosen = rubricTemplate
        ?? (htmlTemplates.length > 0 ? await selectHtmlTemplate(htmlTemplates, title, sourceSummary) : null);

      console.log(`[coverBuilder] HTML mode: ${htmlTemplates.length} template(s) in DB, chosen=${chosen?.url ?? 'none'}`);

      if (chosen) {
        // Fetch the reference HTML from Blob
        let refHtml: string | null = null;
        try {
          const res = await fetch(chosen.url);
          if (res.ok) refHtml = await res.text();
        } catch (err) {
          console.warn('[coverBuilder] Failed to fetch reference HTML:', (err as Error).message);
        }

        if (refHtml) {
          const hasSlots = /\{\{\w+\}\}/.test(refHtml);

          if (hasSlots) {
            // Slot template: fill {{SLOTS}} with channel content, then apply the
            // channel's brand tokens (--primary/--bg/--logo) so the template is
            // rendered IN THE CHANNEL'S STYLE — not its placeholder defaults.
            // Layout stays 1:1; only colors/logo become the channel's.
            const filled = await fillTemplateSlots(refHtml, {
              title:        classification.headline || finalTitle,
              content:      input || finalTitle,
              artDirection: imagePrompt?.trim() || undefined,
              coverLanguage,
            }, slotBrandCtx);
            if (filled) {
              cover = await renderHtmlString(injectBrandTokens(filled, brand), aspectRatio);
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
          ? '[coverBuilder] HTML mode but no templates uploaded — using Satori'
          : '[coverBuilder] HTML cover attempts failed — falling back to Satori');
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
      console.warn('[coverBuilder] HTML cover render failed (non-fatal):', (err as Error).message);
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
        console.warn('[coverBuilder] Auto image prompt generation failed:', (err as Error).message);
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
          console.warn('[coverBuilder] Cover-language headline failed, using title:', (err as Error).message);
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
        console.warn('[coverBuilder] Image generation failed (non-fatal):', (err as Error).message);
      }
    }
  }

  return cover;
}
