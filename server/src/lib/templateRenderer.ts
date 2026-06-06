/**
 * templateRenderer.ts
 *
 * Renders branded post covers using Satori (HTML/CSS → SVG) + resvg-js (SVG → PNG).
 * No browser, no Puppeteer — pure Node.js, ~100ms per render.
 *
 * Two templates:
 *   atmospheric — dark background, logo top-right, large headline bottom-left.
 *                 Good for announcements, news, roadmap posts.
 *   milestone   — centered layout, big metric number, subtitle, optional stats grid.
 *                 Good for growth milestones, product launches, achievements.
 */

import fs from 'fs';
import path from 'path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { put } from '@vercel/blob';
import { env } from '../env';
import type { GeneratedCover } from './imageGenerator';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CoverTemplate = 'atmospheric' | 'milestone';

export interface TemplateBrand {
  primaryColor: string;   // hex accent, e.g. "#0098EA"
  bgColor:      string;   // hex background, e.g. "#000000"
  logoUrl?:     string | null;
}

export interface StatCard {
  label: string;  // e.g. "USERS"
  value: string;  // e.g. "1,500+"
  desc?:  string; // e.g. "active this month"
}

export interface TemplateCoverInput {
  template:     CoverTemplate;
  headline:     string;
  subheadline?: string;
  brand:        TemplateBrand;
  stat?:        string;       // big central metric for milestone, e.g. "1,500+"
  statCards?:   StatCard[];   // optional 2×2 stats grid
  aspectRatio?: '1:1' | '16:9' | '4:5' | '9:16';
}

// ─── Font loading ─────────────────────────────────────────────────────────────

function resolveFontFile(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../assets/DejaVuSans-Bold.ttf'),
    path.resolve(process.cwd(), 'assets/DejaVuSans-Bold.ttf'),
    path.resolve(process.cwd(), 'server/assets/DejaVuSans-Bold.ttf'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

let fontDataCache: ArrayBuffer | null = null;

async function getFontData(): Promise<ArrayBuffer> {
  if (fontDataCache) return fontDataCache;
  const fontPath = resolveFontFile();
  if (fontPath) {
    fontDataCache = fs.readFileSync(fontPath).buffer as ArrayBuffer;
    return fontDataCache;
  }
  // Fallback: fetch Inter Bold from jsDelivr (cached after first call)
  const res = await fetch(
    'https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-700-normal.woff2'
  );
  fontDataCache = await res.arrayBuffer();
  return fontDataCache;
}

// ─── Canvas dimensions ────────────────────────────────────────────────────────

function getDimensions(ratio?: string): { W: number; H: number } {
  switch (ratio) {
    case '16:9':  return { W: 1080, H: 607 };
    case '4:5':   return { W: 1080, H: 1350 };
    case '9:16':  return { W: 607,  H: 1080 };
    default:      return { W: 1080, H: 1080 };
  }
}

// ─── Colour helpers ───────────────────────────────────────────────────────────

/** Convert hex to rgba with alpha. */
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── Node builders (Satori plain-object JSX) ──────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any; // Satori element — plain React-like object

function div(style: Record<string, unknown>, children: N | N[] | string): N {
  return { type: 'div', props: { style, children } };
}

function img(src: string, style: Record<string, unknown>): N {
  return { type: 'img', props: { src, style } };
}

// ─── Template: atmospheric ────────────────────────────────────────────────────
//
// Dark background, subtle glow, logo top-right, accent bar + headline bottom-left.

function buildAtmospheric(input: TemplateCoverInput, W: number, H: number): N {
  const { brand, headline } = input;
  const { primaryColor, bgColor, logoUrl } = brand;
  const pad = Math.round(W * 0.07);
  const logoSize = Math.round(W * 0.085);

  return div(
    {
      display: 'flex',
      width: `${W}px`,
      height: `${H}px`,
      background: bgColor,
      position: 'relative',
      overflow: 'hidden',
    },
    [
      // Subtle radial glow top-center
      div({
        position: 'absolute',
        top: '-10%',
        left: '20%',
        width: '60%',
        height: '70%',
        background: `radial-gradient(ellipse at center, ${withAlpha(primaryColor, 0.18)} 0%, transparent 65%)`,
      }, ''),

      // Bottom gradient scrim
      div({
        position: 'absolute',
        bottom: '0',
        left: '0',
        right: '0',
        height: '55%',
        background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.5) 50%, transparent 100%)',
      }, ''),

      // Logo top-right
      ...(logoUrl ? [img(logoUrl, {
        position: 'absolute',
        top: `${pad}px`,
        right: `${pad}px`,
        width: `${logoSize}px`,
        height: `${logoSize}px`,
        objectFit: 'contain',
      })] : []),

      // Bottom content
      div({
        position: 'absolute',
        bottom: `${Math.round(H * 0.08)}px`,
        left: `${pad}px`,
        right: `${pad}px`,
        display: 'flex',
        flexDirection: 'column',
      }, [
        // Accent bar
        div({
          width: '44px',
          height: '4px',
          background: primaryColor,
          borderRadius: '2px',
          marginBottom: '18px',
        }, ''),

        // Headline
        div({
          fontSize: `${Math.round(W * 0.052)}px`,
          fontWeight: 700,
          color: '#FFFFFF',
          lineHeight: '1.2',
          letterSpacing: '-0.5px',
        }, headline),
      ]),
    ]
  );
}

// ─── Template: milestone ──────────────────────────────────────────────────────
//
// Centered layout: logo + glow → big stat number → headline → optional stats grid.

function buildMilestone(input: TemplateCoverInput, W: number, H: number): N {
  const { brand, headline, subheadline, stat, statCards } = input;
  const { primaryColor, bgColor, logoUrl } = brand;
  const hasCards = Array.isArray(statCards) && statCards.length > 0;

  return div(
    {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: `${W}px`,
      height: `${H}px`,
      background: bgColor,
      position: 'relative',
      overflow: 'hidden',
      padding: `${Math.round(H * 0.07)}px ${Math.round(W * 0.07)}px`,
    },
    [
      // Large radial glow behind logo
      div({
        position: 'absolute',
        top: '-5%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '70%',
        height: '60%',
        background: `radial-gradient(ellipse at top, ${withAlpha(primaryColor, 0.2)} 0%, transparent 65%)`,
      }, ''),

      // Logo
      ...(logoUrl ? [
        div({ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: `${Math.round(H * 0.04)}px` }, [
          img(logoUrl, {
            width: `${Math.round(W * 0.1)}px`,
            height: `${Math.round(W * 0.1)}px`,
            objectFit: 'contain',
          }),
          // Thin line under logo
          div({
            width: `${Math.round(W * 0.14)}px`,
            height: '1px',
            background: withAlpha(primaryColor, 0.5),
            marginTop: `${Math.round(H * 0.025)}px`,
          }, ''),
        ])
      ] : []),

      // Big stat number
      ...(stat ? [div({
        fontSize: `${Math.round(W * 0.16)}px`,
        fontWeight: 700,
        color: '#FFFFFF',
        lineHeight: '1',
        letterSpacing: '-3px',
        marginBottom: `${Math.round(H * 0.012)}px`,
        textAlign: 'center',
      }, stat)] : []),

      // Headline (colored if stat present, white if not)
      div({
        fontSize: `${Math.round(W * (stat ? 0.032 : 0.058))}px`,
        fontWeight: 700,
        color: stat ? primaryColor : '#FFFFFF',
        textAlign: 'center',
        lineHeight: '1.25',
        marginBottom: `${Math.round(H * 0.01)}px`,
        letterSpacing: '-0.3px',
      }, headline),

      // Subheadline
      ...(subheadline ? [div({
        fontSize: `${Math.round(W * 0.022)}px`,
        fontWeight: 400,
        color: 'rgba(255,255,255,0.5)',
        textAlign: 'center',
        marginBottom: `${Math.round(H * 0.04)}px`,
      }, subheadline)] : []),

      // Stats grid
      ...(hasCards ? [
        div({
          display: 'flex',
          flexWrap: 'wrap',
          gap: `${Math.round(W * 0.015)}px`,
          width: '100%',
          marginTop: `${Math.round(H * 0.02)}px`,
        }, (statCards ?? []).slice(0, 4).map(card =>
          div({
            display: 'flex',
            flexDirection: 'column',
            flex: '1 1 45%',
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid rgba(255,255,255,0.07)`,
            borderRadius: `${Math.round(W * 0.02)}px`,
            padding: `${Math.round(H * 0.022)}px ${Math.round(W * 0.025)}px`,
            gap: '4px',
          }, [
            div({
              fontSize: `${Math.round(W * 0.016)}px`,
              fontWeight: 700,
              color: primaryColor,
              letterSpacing: '1px',
              textTransform: 'uppercase',
            }, card.label),
            div({
              fontSize: `${Math.round(W * 0.038)}px`,
              fontWeight: 700,
              color: '#FFFFFF',
              lineHeight: '1',
            }, card.value),
            ...(card.desc ? [div({
              fontSize: `${Math.round(W * 0.016)}px`,
              color: 'rgba(255,255,255,0.4)',
              marginTop: '2px',
            }, card.desc)] : []),
          ])
        )),
      ] : []),
    ]
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Renders a branded cover using Satori + resvg-js and uploads to Vercel Blob.
 * Returns a GeneratedCover (bannerUrl + null coverBaseUrl) or null on failure.
 */
export async function renderTemplateCover(
  input: TemplateCoverInput,
): Promise<GeneratedCover | null> {
  if (!env.BLOB_READ_WRITE_TOKEN) {
    console.warn('[templateRenderer] BLOB_READ_WRITE_TOKEN not set — skipping template render');
    return null;
  }

  try {
    const { W, H } = getDimensions(input.aspectRatio);
    const fontData = await getFontData();

    const element = input.template === 'milestone'
      ? buildMilestone(input, W, H)
      : buildAtmospheric(input, W, H);

    const svg = await satori(element, {
      width:  W,
      height: H,
      fonts: [{
        name:   'Inter',
        data:   fontData,
        weight: 700,
        style:  'normal',
      }],
    });

    const resvg   = new Resvg(svg, { fitTo: { mode: 'width', value: W } });
    const pngData = resvg.render();
    const pngBuf  = Buffer.from(pngData.asPng());

    const blob = await put(`covers/template-${Date.now()}.png`, pngBuf, {
      access:      'public',
      token:       env.BLOB_READ_WRITE_TOKEN,
      contentType: 'image/png',
    });

    console.log(`[templateRenderer] Rendered ${input.template} ${W}×${H} → ${blob.url}`);
    return { bannerUrl: blob.url, coverBaseUrl: null };

  } catch (err) {
    console.warn('[templateRenderer] Render failed:', (err as Error).message);
    return null;
  }
}

/**
 * Extracts brand config from a raw visualKit JSON object.
 * Returns sensible defaults when fields are missing.
 */
export function extractBrand(visualKit: unknown): TemplateBrand {
  if (!visualKit || typeof visualKit !== 'object') {
    return { primaryColor: '#0098EA', bgColor: '#000000', logoUrl: null };
  }
  const vk = visualKit as Record<string, unknown>;

  // Primary color: first brandColor, then primaryColor
  let primaryColor = '#0098EA';
  const colors = vk['brandColors'];
  if (Array.isArray(colors) && colors.length > 0) {
    const c = colors[0] as { hex?: unknown };
    if (typeof c.hex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c.hex)) primaryColor = c.hex;
  } else if (typeof vk['primaryColor'] === 'string') {
    primaryColor = vk['primaryColor'] as string;
  }

  // Background color: second brandColor or secondaryColor or black
  let bgColor = '#000000';
  if (Array.isArray(colors) && colors.length > 1) {
    const c = colors[1] as { hex?: unknown };
    if (typeof c.hex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c.hex)) bgColor = c.hex;
  } else if (typeof vk['secondaryColor'] === 'string') {
    bgColor = vk['secondaryColor'] as string;
  }

  const logoUrl = typeof vk['logoUrl'] === 'string' && (vk['logoUrl'] as string).startsWith('http')
    ? vk['logoUrl'] as string
    : null;

  return { primaryColor, bgColor, logoUrl };
}
