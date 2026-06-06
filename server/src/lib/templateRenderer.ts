/**
 * templateRenderer.ts
 *
 * Renders branded post covers via Satori (HTML/CSS → SVG) + resvg-js (SVG → PNG).
 * No browser, no Puppeteer — pure Node.js, ~100 ms per render, $0 cost.
 *
 * Templates:
 *   atmospheric — dark bg, logo top-right, large headline bottom-left.
 *   milestone   — centered layout: logo → big metric → headline → stats grid.
 *   news        — top accent bar, category pill, large headline, logo bottom.
 */

import fs   from 'fs';
import path from 'path';
import satori        from 'satori';
import { Resvg }     from '@resvg/resvg-js';
import { put }       from '@vercel/blob';
import { env }       from '../env';
import type { GeneratedCover } from './imageGenerator';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CoverTemplate = 'atmospheric' | 'milestone' | 'news';

export interface TemplateBrand {
  primaryColor: string;
  bgColor:      string;
  logoUrl?:     string | null;
}

export interface StatCard {
  label: string;
  value: string;
  desc?: string;
}

export interface TemplateCoverInput {
  template:     CoverTemplate;
  headline:     string;
  subheadline?: string;
  brand:        TemplateBrand;
  stat?:        string;
  statCards?:   StatCard[];
  category?:    string;   // for news template, e.g. "UPDATE"
  aspectRatio?: '1:1' | '16:9' | '4:5' | '9:16';
}

// ─── Font loading ─────────────────────────────────────────────────────────────

interface FontSet { regular: ArrayBuffer; bold: ArrayBuffer }
let fontCache: FontSet | null = null;

async function getFonts(): Promise<FontSet> {
  if (fontCache) return fontCache;

  // Step 1: try bundled DejaVuSans-Bold (always available — committed to repo)
  const candidates = [
    path.resolve(__dirname, '../../assets/DejaVuSans-Bold.ttf'),
    path.resolve(process.cwd(), 'assets/DejaVuSans-Bold.ttf'),
    path.resolve(process.cwd(), 'server/assets/DejaVuSans-Bold.ttf'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p).buffer as ArrayBuffer;
        fontCache = { regular: buf, bold: buf };
        console.log('[templateRenderer] DejaVuSans loaded from', p);
        return fontCache;
      }
    } catch { /* try next */ }
  }

  // Step 2: CDN fallback — Inter from jsDelivr (pinned version)
  console.log('[templateRenderer] Local font not found, trying CDN...');
  try {
    const [regular, bold] = await Promise.all([
      fetch('https://cdn.jsdelivr.net/npm/@fontsource/inter@4.5.15/files/inter-latin-400-normal.woff2')
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }),
      fetch('https://cdn.jsdelivr.net/npm/@fontsource/inter@4.5.15/files/inter-latin-700-normal.woff2')
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }),
    ]);
    fontCache = { regular, bold };
    console.log('[templateRenderer] Inter font loaded from CDN');
    return fontCache;
  } catch (err) {
    console.warn('[templateRenderer] CDN font failed:', (err as Error).message);
  }

  throw new Error('No usable font found for template renderer');
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

// ─── Color helpers ────────────────────────────────────────────────────────────

/** Returns true when a hex color is perceptually light (luminance > 0.4). */
function isLight(hex: string): boolean {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  // Relative luminance (WCAG formula)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4;
}

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── Node builder helpers ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

function d(style: Record<string, unknown>, children: N | N[] | string): N {
  return { type: 'div', props: { style, children } };
}
function img(src: string, style: Record<string, unknown>): N {
  return { type: 'img', props: { src, style } };
}

// ─── Template: atmospheric ────────────────────────────────────────────────────

function buildAtmospheric(input: TemplateCoverInput, W: number, H: number): N {
  const { brand, headline } = input;
  const { primaryColor, bgColor, logoUrl } = brand;
  const light    = isLight(bgColor);
  const textColor = light ? '#111111' : '#FFFFFF';
  const pad      = Math.round(W * 0.07);
  const logoSize = Math.round(W * 0.085);

  return d({ display: 'flex', width: `${W}px`, height: `${H}px`,
    background: bgColor, position: 'relative', overflow: 'hidden' }, [

    // Radial glow
    d({ position: 'absolute', top: '-10%', left: '20%', width: '60%', height: '70%',
      background: `radial-gradient(ellipse at center, ${withAlpha(primaryColor, 0.18)} 0%, transparent 65%)` }, ''),

    // Bottom scrim (only for dark backgrounds)
    ...(!light ? [d({ position: 'absolute', bottom: '0', left: '0', right: '0', height: '55%',
      background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.5) 50%, transparent 100%)' }, '')] : []),

    // Logo top-right
    ...(logoUrl ? [img(logoUrl, {
      position: 'absolute', top: `${pad}px`, right: `${pad}px`,
      width: `${logoSize}px`, height: `${logoSize}px`, objectFit: 'contain',
    })] : []),

    // Bottom: accent bar + headline
    d({ position: 'absolute', bottom: `${Math.round(H * 0.08)}px`,
      left: `${pad}px`, right: `${pad}px`,
      display: 'flex', flexDirection: 'column' }, [
      d({ width: '44px', height: '4px', background: primaryColor,
        borderRadius: '2px', marginBottom: '18px' }, ''),
      d({ fontSize: `${Math.round(W * 0.052)}px`, fontWeight: 700,
        color: textColor, lineHeight: '1.2', letterSpacing: '-0.5px' }, headline),
    ]),
  ]);
}

// ─── Template: milestone ──────────────────────────────────────────────────────

function buildMilestone(input: TemplateCoverInput, W: number, H: number): N {
  const { brand, headline, subheadline, stat, statCards } = input;
  const { primaryColor, bgColor, logoUrl } = brand;
  const light     = isLight(bgColor);
  const textColor = light ? '#111111' : '#FFFFFF';
  const mutedColor = light ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.45)';
  const cardBg    = light ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)';
  const cardBorder = light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.07)';
  const hasCards  = Array.isArray(statCards) && statCards.length > 0;
  const pad       = Math.round(W * 0.07);

  return d({
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    width: `${W}px`, height: `${H}px`, background: bgColor,
    position: 'relative', overflow: 'hidden',
    padding: `${Math.round(H * 0.07)}px ${pad}px`,
  }, [
    // Radial glow behind logo
    d({ position: 'absolute', top: '-5%', left: '50%', transform: 'translateX(-50%)',
      width: '70%', height: '60%',
      background: `radial-gradient(ellipse at top, ${withAlpha(primaryColor, 0.2)} 0%, transparent 65%)` }, ''),

    // Logo + separator line
    ...(logoUrl ? [
      d({ display: 'flex', flexDirection: 'column', alignItems: 'center',
        marginBottom: `${Math.round(H * 0.04)}px` }, [
        img(logoUrl, { width: `${Math.round(W * 0.1)}px`, height: `${Math.round(W * 0.1)}px`, objectFit: 'contain' }),
        d({ width: `${Math.round(W * 0.14)}px`, height: '1px',
          background: withAlpha(primaryColor, 0.5), marginTop: `${Math.round(H * 0.025)}px` }, ''),
      ])
    ] : []),

    // Big stat number
    ...(stat ? [d({
      fontSize: `${Math.round(W * 0.16)}px`, fontWeight: 700, color: textColor,
      lineHeight: '1', letterSpacing: '-3px',
      marginBottom: `${Math.round(H * 0.01)}px`, textAlign: 'center',
    }, stat)] : []),

    // Headline
    d({
      fontSize: `${Math.round(W * (stat ? 0.032 : 0.056))}px`, fontWeight: 700,
      color: stat ? primaryColor : textColor,
      textAlign: 'center', lineHeight: '1.25',
      marginBottom: `${Math.round(H * 0.008)}px`, letterSpacing: '-0.3px',
    }, headline),

    // Subheadline
    ...(subheadline ? [d({
      fontSize: `${Math.round(W * 0.022)}px`, fontWeight: 400,
      color: mutedColor, textAlign: 'center',
      marginBottom: `${Math.round(H * 0.04)}px`,
    }, subheadline)] : []),

    // Stats grid 2×2
    ...(hasCards ? [d({
      display: 'flex', flexWrap: 'wrap',
      gap: `${Math.round(W * 0.015)}px`, width: '100%',
      marginTop: `${Math.round(H * 0.015)}px`,
    }, (statCards ?? []).slice(0, 4).map(card =>
      d({
        display: 'flex', flexDirection: 'column', flex: '1 1 45%',
        background: cardBg, border: `1px solid ${cardBorder}`,
        borderRadius: `${Math.round(W * 0.02)}px`,
        padding: `${Math.round(H * 0.022)}px ${Math.round(W * 0.025)}px`,
        gap: '4px',
      }, [
        d({ fontSize: `${Math.round(W * 0.016)}px`, fontWeight: 700,
          color: primaryColor, letterSpacing: '1px' }, card.label.toUpperCase()),
        d({ fontSize: `${Math.round(W * 0.038)}px`, fontWeight: 700,
          color: textColor, lineHeight: '1' }, card.value),
        ...(card.desc ? [d({
          fontSize: `${Math.round(W * 0.016)}px`, color: mutedColor, marginTop: '2px',
        }, card.desc)] : []),
      ])
    ))] : []),
  ]);
}

// ─── Template: news ───────────────────────────────────────────────────────────

function buildNews(input: TemplateCoverInput, W: number, H: number): N {
  const { brand, headline, subheadline, category } = input;
  const { primaryColor, bgColor, logoUrl } = brand;
  const light     = isLight(bgColor);
  const textColor = light ? '#111111' : '#FFFFFF';
  const mutedColor = light ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.45)';
  const pad       = Math.round(W * 0.08);
  const cat       = category ?? 'UPDATE';

  return d({ display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    width: `${W}px`, height: `${H}px`, background: bgColor,
    position: 'relative', overflow: 'hidden', padding: `${pad}px` }, [

    // Top accent bar (full width)
    d({ position: 'absolute', top: '0', left: '0', right: '0',
      height: '4px', background: primaryColor }, ''),

    // Subtle glow top-right
    d({ position: 'absolute', top: '-20%', right: '-10%', width: '55%', height: '55%',
      background: `radial-gradient(ellipse at top right, ${withAlpha(primaryColor, 0.15)} 0%, transparent 60%)` }, ''),

    // Top row: category pill
    d({ display: 'flex', alignItems: 'center' }, [
      d({
        background: withAlpha(primaryColor, 0.15),
        border: `1px solid ${withAlpha(primaryColor, 0.4)}`,
        borderRadius: '100px',
        padding: `${Math.round(H * 0.012)}px ${Math.round(W * 0.028)}px`,
        fontSize: `${Math.round(W * 0.018)}px`,
        fontWeight: 700, color: primaryColor, letterSpacing: '1.5px',
      }, cat.toUpperCase()),
    ]),

    // Center: headline
    d({ display: 'flex', flexDirection: 'column', flex: '1',
      justifyContent: 'center', paddingTop: `${Math.round(H * 0.04)}px` }, [
      d({ fontSize: `${Math.round(W * 0.062)}px`, fontWeight: 700,
        color: textColor, lineHeight: '1.15', letterSpacing: '-1px',
        marginBottom: subheadline ? `${Math.round(H * 0.02)}px` : '0',
      }, headline),
      ...(subheadline ? [d({
        fontSize: `${Math.round(W * 0.024)}px`, fontWeight: 400,
        color: mutedColor, lineHeight: '1.5',
      }, subheadline)] : []),
    ]),

    // Bottom: logo
    d({ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }, [
      ...(logoUrl ? [img(logoUrl, {
        width: `${Math.round(W * 0.08)}px`, height: `${Math.round(W * 0.08)}px`,
        objectFit: 'contain', opacity: '0.9',
      })] : []),
    ]),
  ]);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function renderTemplateCover(
  input: TemplateCoverInput,
): Promise<GeneratedCover | null> {
  if (!env.BLOB_READ_WRITE_TOKEN) {
    console.warn('[templateRenderer] BLOB_READ_WRITE_TOKEN not set');
    return null;
  }

  try {
    const { W, H } = getDimensions(input.aspectRatio);
    const fonts    = await getFonts();

    const element =
      input.template === 'milestone' ? buildMilestone(input, W, H) :
      input.template === 'news'      ? buildNews(input, W, H) :
      buildAtmospheric(input, W, H);

    const svg = await satori(element, {
      width: W, height: H,
      fonts: [
        { name: 'Inter', data: fonts.regular, weight: 400, style: 'normal' },
        { name: 'Inter', data: fonts.bold,    weight: 700, style: 'normal' },
      ],
    });

    const resvg  = new Resvg(svg, { fitTo: { mode: 'width', value: W } });
    const pngBuf = Buffer.from(resvg.render().asPng());

    const blob = await put(`covers/template-${Date.now()}.png`, pngBuf, {
      access: 'public', token: env.BLOB_READ_WRITE_TOKEN, contentType: 'image/png',
    });

    console.log(`[templateRenderer] ${input.template} ${W}×${H} → ${blob.url}`);
    return { bannerUrl: blob.url, coverBaseUrl: null };

  } catch (err) {
    console.error('[templateRenderer] Render failed:', (err as Error).message, (err as Error).stack?.split('\n')[1]);
    return null;
  }
}

/** Extracts brand config from a raw visualKit JSON object. */
export function extractBrand(visualKit: unknown): TemplateBrand {
  if (!visualKit || typeof visualKit !== 'object') {
    return { primaryColor: '#0098EA', bgColor: '#000000', logoUrl: null };
  }
  const vk = visualKit as Record<string, unknown>;

  let primaryColor = '#0098EA';
  const colors = vk['brandColors'];
  if (Array.isArray(colors) && colors.length > 0) {
    const c = colors[0] as { hex?: unknown };
    if (typeof c.hex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c.hex)) primaryColor = c.hex;
  } else if (typeof vk['primaryColor'] === 'string') {
    primaryColor = vk['primaryColor'] as string;
  }

  let bgColor = '#000000';
  if (Array.isArray(colors) && colors.length > 1) {
    const c = colors[1] as { hex?: unknown };
    if (typeof c.hex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c.hex)) bgColor = c.hex;
  } else if (typeof vk['secondaryColor'] === 'string') {
    bgColor = vk['secondaryColor'] as string;
  }

  const logoUrl = typeof vk['logoUrl'] === 'string' && (vk['logoUrl'] as string).startsWith('http')
    ? vk['logoUrl'] as string : null;

  return { primaryColor, bgColor, logoUrl };
}
