/**
 * playwrightRenderer.ts
 *
 * Renders user-uploaded HTML cover templates to PNG via Playwright + Chromium.
 * The user designs their own HTML/CSS, uploads it, and this module:
 *   1. Fetches the stored HTML from Vercel Blob
 *   2. Replaces {{slot}} placeholders with actual post content
 *   3. Injects brand CSS variables (--primary, --bg, --accent, --logo)
 *   4. Takes a full-page screenshot at the template's declared dimensions
 *   5. Uploads the PNG to Vercel Blob and returns a GeneratedCover
 *
 * Available slots in user templates:
 *   {{headline}}     — post cover headline (max ~60 chars)
 *   {{subheadline}}  — secondary line / summary (optional)
 *   {{stat}}         — key metric, e.g. "1,500+" (optional, milestone posts)
 *   {{category}}     — short category label, e.g. "UPDATE" (optional, news posts)
 *   {{logo}}         — brand logo URL (or empty string if no logo)
 *
 * Available CSS variables (injected into :root):
 *   --primary        — brand primary/accent color, e.g. #0098EA
 *   --bg             — background color, e.g. #000000
 *   --accent         — same as --primary (alias for convenience)
 *   --logo           — logo URL as CSS string (for background-image: var(--logo))
 *
 * Browser lifecycle:
 *   A single Chromium instance is kept alive as a module-level singleton.
 *   It is lazily launched on the first render call and reused for all subsequent
 *   requests. If the browser crashes and disconnects, the next call re-launches it.
 */

// playwright is imported lazily (dynamic import) so the server starts fine
// even when Chromium binaries are not installed.
import { put }               from '@vercel/blob';
import { env }               from '../env';
import type { GeneratedCover } from './imageGenerator';
import type { TemplateBrand }  from './templateRenderer';
import type { TemplateClassification } from './aiGenerator';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Browser = any;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HtmlRenderInput {
  /** Vercel Blob URL of the user's HTML template file */
  htmlTemplateUrl:  string;
  brand:            TemplateBrand;
  classification:   TemplateClassification;
  headline:         string;
  aspectRatio?:     string;
}

// ─── Browser singleton ────────────────────────────────────────────────────────

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;
  // Dynamic import — keeps the module loadable when playwright/Chromium absent
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chromium } = await import('playwright');
  console.log('[playwrightRenderer] Launching Chromium...');
  _browser = await chromium.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  }).catch((err: Error) => {
    console.error(
      '[playwrightRenderer] FATAL: Chromium launch failed.\n' +
      '  Make sure your Render Build Command includes: npx playwright install chromium\n' +
      '  Error:', err.message,
    );
    throw err;
  });
  _browser.on('disconnected', () => {
    console.warn('[playwrightRenderer] Browser disconnected, will re-launch on next render');
    _browser = null;
  });
  return _browser;
}

// ─── Dimensions ───────────────────────────────────────────────────────────────

function getDimensions(ratio?: string): { W: number; H: number } {
  switch (ratio) {
    case '16:9': return { W: 1080, H: 607  };
    case '4:5':  return { W: 1080, H: 1350 };
    case '9:16': return { W: 607,  H: 1080 };
    default:     return { W: 1080, H: 1080 };
  }
}

// ─── Slot replacement ─────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function replaceSlots(html: string, slots: Record<string, string>): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = slots[key];
    return val !== undefined ? escapeHtml(val) : '';
  });
}

// ─── CSS variable injection ───────────────────────────────────────────────────

function buildCssVars(brand: TemplateBrand): string {
  const logoUrl = brand.logoUrl ?? '';
  return `
<style id="cf-brand-vars">
:root {
  --primary: ${brand.primaryColor};
  --accent:  ${brand.primaryColor};
  --bg:      ${brand.bgColor};
  --logo:    url("${logoUrl.replace(/"/g, '\\"')}");
}
</style>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Renders an arbitrary HTML string to PNG.
 * Used for AI-generated covers where the HTML is already fully prepared.
 * Returns null on any error so the caller can fall back gracefully.
 */
export async function renderHtmlString(
  html:         string,
  aspectRatio?: string,
): Promise<GeneratedCover | null> {
  if (!env.BLOB_READ_WRITE_TOKEN) {
    console.warn('[playwrightRenderer] BLOB_READ_WRITE_TOKEN not set');
    return null;
  }

  const { W, H } = getDimensions(aspectRatio);
  let pngBuffer: Buffer;

  try {
    const browser = await getBrowser();
    const page    = await browser.newPage();
    try {
      await page.setViewportSize({ width: W, height: H });
      // 'load' instead of 'networkidle' — canvas requestAnimationFrame loops never
      // reach networkidle and would time out after 30 s on every user template.
      await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
      // Wait for web fonts (templates often load Google Fonts) so the screenshot
      // uses the intended typeface, not a fallback. Non-fatal if it times out.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.evaluate(() => (globalThis as any).document.fonts.ready).catch(() => {});
      // Extra settle time so CSS transitions and font rendering finish
      await page.waitForTimeout(300);
      // Auto-fit: the model targets ${W}×${H} but often overshoots the height,
      // and overflow:hidden then clips the bottom card. Measure the real content
      // height and, if it overflows, uniformly scale the body down to fit. The
      // html background is filled with the body's bg so the side margins created
      // by uniform scaling blend in instead of showing as gaps.
      await page.evaluate(({ H }: { H: number }) => {
        // Browser globals — typed via cast since the server tsconfig has no DOM lib.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const win = globalThis as any;
        const body = win.document.body;
        const root = win.document.documentElement;
        const bg = win.getComputedStyle(body).backgroundColor;
        root.style.margin = '0';
        root.style.background = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#000';
        // Measure natural content height with overflow released.
        body.style.height = 'auto';
        body.style.overflow = 'visible';
        const real = body.scrollHeight;
        if (real > H + 2) {
          const scale = H / real;
          body.style.height = `${real}px`;
          body.style.overflow = 'hidden';
          body.style.transformOrigin = 'top center';
          body.style.transform = `scale(${scale})`;
        }
      }, { H });
      const screenshot = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } });
      pngBuffer = Buffer.from(screenshot);
    } finally {
      await page.close();
    }
  } catch (err) {
    console.warn('[playwrightRenderer] renderHtmlString screenshot failed:', (err as Error).message);
    return null;
  }

  try {
    const blob = await put(`covers/ai-html-${Date.now()}.png`, pngBuffer, {
      access: 'public', token: env.BLOB_READ_WRITE_TOKEN, contentType: 'image/png',
    });
    console.log(`[playwrightRenderer] AI HTML cover ${W}×${H} → ${blob.url}`);
    return { bannerUrl: blob.url, coverBaseUrl: null };
  } catch (err) {
    console.warn('[playwrightRenderer] Blob upload failed:', (err as Error).message);
    return null;
  }
}

/**
 * Renders a user's HTML cover template to PNG.
 * Returns null on any error so the caller can fall back to Satori templates.
 */
export async function renderHtmlTemplate(
  input: HtmlRenderInput,
): Promise<GeneratedCover | null> {
  if (!env.BLOB_READ_WRITE_TOKEN) {
    console.warn('[playwrightRenderer] BLOB_READ_WRITE_TOKEN not set');
    return null;
  }

  let html: string;
  try {
    const res = await fetch(input.htmlTemplateUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching template`);
    html = await res.text();
  } catch (err) {
    console.warn('[playwrightRenderer] Failed to fetch HTML template:', (err as Error).message);
    return null;
  }

  // Build slot map from classification + brand
  const { classification, headline, brand } = input;
  const slots: Record<string, string> = {
    headline:    headline,
    subheadline: classification.subheadline ?? '',
    stat:        classification.stat        ?? '',
    category:    classification.category    ?? '',
    logo:        brand.logoUrl              ?? '',
  };

  // Inject CSS vars right after <head> (or at the very top if no <head>)
  const cssVars  = buildCssVars(brand);
  let finalHtml  = replaceSlots(html, slots);
  if (/<head[\s>]/i.test(finalHtml)) {
    finalHtml = finalHtml.replace(/(<head[^>]*>)/i, `$1\n${cssVars}`);
  } else {
    finalHtml = cssVars + finalHtml;
  }

  const { W, H } = getDimensions(input.aspectRatio);

  let pngBuffer: Buffer;
  try {
    const browser = await getBrowser();
    const page    = await browser.newPage();
    try {
      await page.setViewportSize({ width: W, height: H });
      await page.setContent(finalHtml, { waitUntil: 'load', timeout: 15_000 });
      await page.waitForTimeout(300);
      const screenshot = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } });
      pngBuffer = Buffer.from(screenshot);
    } finally {
      await page.close();
    }
  } catch (err) {
    console.warn('[playwrightRenderer] Screenshot failed:', (err as Error).message);
    return null;
  }

  try {
    const blob = await put(`covers/html-${Date.now()}.png`, pngBuffer, {
      access: 'public', token: env.BLOB_READ_WRITE_TOKEN, contentType: 'image/png',
    });
    console.log(`[playwrightRenderer] HTML template ${W}×${H} → ${blob.url}`);
    return { bannerUrl: blob.url, coverBaseUrl: null };
  } catch (err) {
    console.warn('[playwrightRenderer] Blob upload failed:', (err as Error).message);
    return null;
  }
}
