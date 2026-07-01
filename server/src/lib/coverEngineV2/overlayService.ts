import {
  buildFallbackOverlayHtml,
  composeTemplateOverPhoto,
  generateHtmlCover,
  generateHtmlOverlay,
  injectBrandTokens,
} from '../claudeHtmlGenerator';
import { fillTemplateSlots, type TemplateClassification } from '../aiGenerator';
import { renderHtmlString, renderHtmlTemplate } from '../playwrightRenderer';
import { extractBrand, renderTemplateCover } from '../templateRenderer';
import type { GeneratedCover } from '../imageGenerator';
import type { CoverContextV2, CoverPlanV2, HtmlTemplateRef, TemplateContractV2 } from './types';

export async function renderCoverOverlayV2(params: {
  ctx: CoverContextV2;
  plan: CoverPlanV2;
  template: HtmlTemplateRef | null;
  referenceHtml: string | null;
  backgroundUrl: string | null;
  classification: TemplateClassification;
  contract: TemplateContractV2 | null;
}): Promise<GeneratedCover | null> {
  const { ctx, plan, template, referenceHtml, backgroundUrl, classification, contract } = params;
  const brand = extractBrand(ctx.visualKit);

  if (plan.scenario === 'hybrid_template_background' || (plan.scenario === 'rubric_template_pack' && plan.mode === 'ai_html')) {
    if (backgroundUrl && referenceHtml && /\{\{\w+\}\}/.test(referenceHtml)) {
      const filled = await fillTemplateSlots(referenceHtml, {
        title: classification.headline || ctx.finalTitle,
        content: ctx.postText || ctx.finalTitle,
        artDirection: ctx.imagePrompt?.trim() || undefined,
        coverLanguage: ctx.coverLanguage,
      }, { ...ctx.slotBrandCtx, rubricName: template?.name });
      if (filled) {
        return renderHtmlString(composeTemplateOverPhoto(filled, backgroundUrl, brand, {
          contentZone: contract?.textZone,
          backgroundKind: contract?.backgroundKind,
        }), ctx.aspectRatio);
      }
    }
    if (backgroundUrl) {
      const overlayHtml = await generateHtmlOverlay({
        bgImageUrl: backgroundUrl,
        referenceHtml: referenceHtml ?? undefined,
        coverLanguage: ctx.coverLanguage,
        headline: classification.headline || ctx.finalTitle,
        subheadline: classification.subheadline,
        category: classification.category,
        postContent: ctx.postText || undefined,
        artDirection: ctx.imagePrompt?.trim() || undefined,
        logoUrl: brand.logoUrl ?? undefined,
        primaryColor: brand.primaryColor,
        aspectRatio: ctx.aspectRatio,
        brand: ctx.slotBrandCtx,
      });
      if (overlayHtml) return renderHtmlString(overlayHtml, ctx.aspectRatio);
      return renderHtmlString(buildFallbackOverlayHtml({
        bgImageUrl: backgroundUrl,
        headline: classification.headline || ctx.finalTitle,
        subheadline: classification.subheadline,
        category: classification.category,
        logoUrl: brand.logoUrl ?? undefined,
        primaryColor: brand.primaryColor,
        aspectRatio: ctx.aspectRatio,
      }), ctx.aspectRatio);
    }
  }

  if ((plan.scenario === 'html_template' || (plan.scenario === 'rubric_template_pack' && plan.mode === 'html')) && template) {
    if (referenceHtml && /\{\{\w+\}\}/.test(referenceHtml)) {
      const filled = await fillTemplateSlots(referenceHtml, {
        title: classification.headline || ctx.finalTitle,
        content: ctx.postText || ctx.finalTitle,
        artDirection: ctx.imagePrompt?.trim() || undefined,
        coverLanguage: ctx.coverLanguage,
      }, { ...ctx.slotBrandCtx, rubricName: template.name });
      if (filled) return renderHtmlString(injectBrandTokens(filled, brand), ctx.aspectRatio);
    }
    if (referenceHtml) {
      const generatedHtml = await generateHtmlCover({
        referenceHtml,
        coverLanguage: ctx.coverLanguage,
        headline: classification.headline || ctx.finalTitle,
        subheadline: classification.subheadline,
        stat: classification.stat,
        category: classification.category,
        postContent: ctx.postText || undefined,
        artDirection: ctx.imagePrompt?.trim() || undefined,
        logoUrl: brand.logoUrl ?? undefined,
        primaryColor: brand.primaryColor,
        bgColor: brand.bgColor,
        aspectRatio: ctx.aspectRatio,
      });
      if (generatedHtml) return renderHtmlString(generatedHtml, ctx.aspectRatio);
    }
    return renderHtmlTemplate({
      htmlTemplateUrl: template.url,
      brand,
      classification,
      headline: classification.headline || ctx.finalTitle,
      aspectRatio: ctx.aspectRatio,
    });
  }

  if (plan.scenario === 'satori_fallback') {
    return renderTemplateCover({
      template: classification.template,
      headline: classification.headline || ctx.finalTitle,
      subheadline: classification.subheadline,
      stat: classification.stat,
      statCards: classification.statCards,
      category: classification.category,
      brand,
      aspectRatio: ctx.aspectRatio,
    });
  }

  return null;
}
