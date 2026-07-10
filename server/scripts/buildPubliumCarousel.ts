/**
 * buildPubliumCarousel.ts
 *
 * Builds the 3 Publium CAROUSEL slide templates (cover / item / outro) into
 * scripts/publium-templates/ — the SAME composition as the "О проекте" carousel
 * (__about.ts): brand + glass "✦ rubric" chip top, kicker "// rubric · листай →",
 * a big multi-line title, one frosted glass card, orange dot field along the
 * bottom. Near-black #0A0A0C, Onest. NOT the Stepan Logos layout.
 *
 * The bright dot ornament is HAND-PAINTED in the dot editor:
 *   scripts/__dots/car-cover.json | car-item.json | car-outro.json  (i,j cells)
 * A painted layout wins; without one a light bottom dot-wave is used as a stub.
 *
 * Slots match the carousel engine: RUBRIC, TITLE_WHITE, TITLE_ACCENT,
 * SUBTITLE (cover), DESC (item), CTA + AUTHOR (outro).
 *
 * Run:  npx tsx server/scripts/buildPubliumCarousel.ts
 * Then paint dots in __editor.ts and re-run to bake them in.
 */
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

const SDIR = fsSync.existsSync('server/scripts/buildPublium.ts') ? 'server/scripts' : 'scripts';
const OUT = path.resolve(SDIR, 'publium-templates');
const DOTS = path.resolve(SDIR, '__dots');
const STEP = 22, R = 10.2, N = Math.ceil(1080 / STEP);
const cx = (i: number) => STEP / 2 + i * STEP, cy = (j: number) => STEP / 2 + j * STEP;
function mul(a: number) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Header safe band (brand top-left + rubric chip top-right) — the stub pattern
// never lands here. A hand-painted layout ignores this and is honored as drawn.
const HEAD: number[][] = [[40, 40, 420, 176], [700, 40, 1020, 176]];
let AV: number[][] = [];
const MARGIN = 18, FLOOR = 0.12;
const circ = (i: number, j: number) => {
  const x = cx(i), y = cy(j);
  if (x < R || x > 1080 - R || y < R || y > 1080 - R) return '';
  for (const [x0, y0, x1, y1] of AV) if (x >= x0 - MARGIN && x <= x1 + MARGIN && y >= y0 - MARGIN && y <= y1 + MARGIN) return '';
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${R}"/>`;
};

// Light bottom dot-wave — the stub ornament before the editor layout exists.
function wave(seed: number, base: number, amp: number, freq: number, band: number) {
  const r = mul(seed); let s = '';
  for (let i = 0; i < N; i++) {
    const yc = base + amp * Math.sin(i * freq);
    for (let j = 0; j < N; j++) {
      const t = Math.abs(cy(j) - yc) / band;
      const dn = Math.pow(Math.max(0, 1 - t), 1.6) * (0.7 + 0.6 * r());
      if (dn > FLOOR && r() < dn) s += circ(i, j);
    }
  }
  return s;
}

// Hand-painted layout from the dot editor wins over the stub, honored exactly.
function customDots(file: string): string | null {
  const p = path.join(DOTS, file.replace('.html', '.json'));
  if (!fsSync.existsSync(p)) return null;
  const cells: number[][] = JSON.parse(fsSync.readFileSync(p, 'utf-8'));
  let s = '';
  for (const [i, j] of cells) { const x = cx(i), y = cy(j); if (x >= R && x <= 1080 - R && y >= R && y <= 1080 - R) s += circ(i, j); }
  return s || '';
}

const SPARK = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3 L13.6 9.2 L20 12 L13.6 14.8 L12 21 L10.4 14.8 L4 12 L10.4 9.2 Z" fill="currentColor"/></svg>`;

function shell(kicker: string, body: string, dots: string) {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<!-- Publium carousel slide. Сервис вставляет :root{--primary/--bg/--logo}. -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{--primary:#FF6A00;--bg:#0A0A0C;--logo:none;}
  *{margin:0;padding:0;box-sizing:border-box;}
  body{width:1080px;height:1080px;background:var(--bg);color:#F5F3EF;position:relative;overflow:hidden;font-family:'Onest',system-ui,sans-serif;}
  .grid{position:absolute;inset:0;z-index:0;background-image:radial-gradient(circle, rgba(255,255,255,0.05) ${R}px, transparent ${R + 0.6}px);background-size:${STEP}px ${STEP}px;}
  .mol{position:absolute;inset:0;z-index:1;} .mol circle{fill:var(--primary);}
  .brand{position:absolute;left:78px;top:70px;z-index:4;display:flex;align-items:center;gap:16px;}
  .brand .lg{width:52px;height:52px;background-image:var(--logo);background-size:contain;background-repeat:no-repeat;background-position:center;}
  .brand .nm{font-size:32px;font-weight:700;letter-spacing:-0.01em;}
  .gchip{position:absolute;right:78px;top:66px;z-index:4;display:inline-flex;align-items:center;gap:10px;background:color-mix(in srgb,var(--bg) 45%,transparent);backdrop-filter:blur(16px) saturate(1.3);-webkit-backdrop-filter:blur(16px) saturate(1.3);border:1.5px solid var(--primary);color:#fff;font-weight:600;font-size:25px;padding:12px 22px;border-radius:14px;}
  .gchip svg{width:24px;height:24px;color:var(--primary);}
  .kick{position:absolute;left:78px;top:150px;z-index:4;font-size:26px;letter-spacing:0.16em;text-transform:uppercase;color:#8A8A92;} .kick b{color:var(--primary);}
  .ttl{position:absolute;left:78px;top:296px;width:924px;z-index:3;font-weight:800;font-size:80px;line-height:1.02;letter-spacing:-0.02em;overflow-wrap:anywhere;} .ttl .o{color:var(--primary);}
  .card{position:absolute;left:78px;top:640px;width:900px;z-index:3;background:color-mix(in srgb,var(--bg) 40%,transparent);backdrop-filter:blur(18px) saturate(1.35);-webkit-backdrop-filter:blur(18px) saturate(1.35);border:1px solid color-mix(in srgb,var(--primary) 32%,transparent);border-radius:18px;padding:30px 34px;} .card .tx{font-size:31px;font-weight:500;line-height:1.4;color:#D6D6D2;}
  .cta{position:absolute;left:78px;top:648px;z-index:3;display:inline-flex;align-items:center;gap:12px;background:var(--primary);color:#fff;font-weight:700;font-size:33px;padding:20px 40px;border-radius:16px;box-shadow:0 10px 40px rgba(255,106,0,0.34);}
  .author{position:absolute;left:78px;top:800px;z-index:3;font-size:28px;color:#8A8A92;font-weight:600;}
</style></head>
<body>
  <div class="grid"></div>
  <svg class="mol" viewBox="0 0 1080 1080">${dots}</svg>
  <div class="brand"><span class="lg"></span><span class="nm">Publium</span></div>
  <div class="gchip">${SPARK}{{RUBRIC}}</div>
  <div class="kick">${kicker}</div>
  ${body}
</body></html>`;
}

// slot names match the carousel engine (RUBRIC / TITLE_* / SUBTITLE / DESC / CTA / AUTHOR).
const TITLE = `<div class="ttl">{{TITLE_WHITE}} <span class="o">{{TITLE_ACCENT}}</span></div>`;
const SLIDES: Record<string, { seed: number; kicker: string; body: string }> = {
  'car-cover.html': { seed: 7,  kicker: '// {{RUBRIC}} · <b>листай →</b>',
    body: `${TITLE}\n  <div class="card"><div class="tx">{{SUBTITLE}}</div></div>` },
  'car-item.html':  { seed: 17, kicker: '// {{RUBRIC}} · <b>листай →</b>',
    body: `${TITLE}\n  <div class="card"><div class="tx">{{DESC}}</div></div>` },
  'car-outro.html': { seed: 27, kicker: '// {{RUBRIC}}',
    body: `${TITLE}\n  <div class="cta">{{CTA}} →</div>\n  <div class="author">{{AUTHOR}}</div>` },
};

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  for (const [file, { seed, kicker, body }] of Object.entries(SLIDES)) {
    AV = [];                                   // a hand-painted layout ignores zones
    const custom = customDots(file);
    if (custom === null) AV = HEAD;            // only the stub respects the header band
    const dots = custom ?? wave(seed, 1000, 46, 0.5, 120);
    await fs.writeFile(path.join(OUT, file), shell(kicker, body, dots));
    console.log('wrote', file, custom !== null ? '(hand-painted)' : '(stub wave)');
  }
}
main();
