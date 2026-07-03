import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

const OUT = path.resolve(process.cwd(), 'scripts/publium-templates');
const STEP = 22, R = 10.2, N = Math.ceil(1080 / STEP);
const cx = (i: number) => STEP / 2 + i * STEP, cy = (j: number) => STEP / 2 + j * STEP;
function mul(a: number) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// Exclusion zones (text/card bounding boxes) — bright dots never land here, so
// text stays clean and dots live only in negative space. Set per template.
let AV: number[][] = [];
const MARGIN = 18;
const FLOOR = 0.12;                 // density floor — kills lone "stray" dots (edge artifacts)
// Header safe band: brand (top-left) + rubric chip (top-right) never sit on dots.
const HEAD: number[][] = [[40, 40, 400, 172], [758, 40, 1018, 172]];
const circ = (i: number, j: number) => {
  const x = cx(i), y = cy(j);
  if (x < R || x > 1080 - R || y < R || y > 1080 - R) return '';   // no edge-clipped dots
  for (const [x0, y0, x1, y1] of AV) if (x >= x0 - MARGIN && x <= x1 + MARGIN && y >= y0 - MARGIN && y <= y1 + MARGIN) return '';
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${R}"/>`;
};

// ── bright-dot patterns, all on the shared lattice ──
function molecule(seed: number, ax: number, ay: number, sx: number, sy: number, fall: number) { const r = mul(seed); let s = ''; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const dx = (cx(i) - ax) / sx, dy = (cy(j) - ay) / sy; const d = Math.sqrt(dx * dx + dy * dy); const dn = Math.pow(Math.max(0, 1 - d), fall); if (dn > FLOOR && r() < dn) s += circ(i, j); } return s; }
function wall(seed: number, side: 'r' | 'l' | 'b' | 't', spread: number, fall: number) { const r = mul(seed); let s = ''; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let t; if (side === 'r') t = (1080 - cx(i)) / spread; else if (side === 'l') t = cx(i) / spread; else if (side === 'b') t = (1080 - cy(j)) / spread; else t = cy(j) / spread; const dn = Math.pow(Math.max(0, 1 - t), fall); if (dn > FLOOR && r() < dn) s += circ(i, j); } return s; }
function diag(seed: number, c: number, width: number, fall: number) { const r = mul(seed); let s = ''; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const t = Math.abs((cx(i) + cy(j)) - c) / width; const dn = Math.pow(Math.max(0, 1 - t), fall) * (0.7 + 0.5 * r()); if (dn > FLOOR && r() < dn) s += circ(i, j); } return s; }
function wave(seed: number, base: number, amp: number, freq: number, band: number) { const r = mul(seed); let s = ''; for (let i = 0; i < N; i++) { const yc = base + amp * Math.sin(i * freq); for (let j = 0; j < N; j++) { const t = Math.abs(cy(j) - yc) / band; const dn = Math.pow(Math.max(0, 1 - t), 1.6) * (0.7 + 0.6 * r()); if (dn > FLOOR && r() < dn) s += circ(i, j); } } return s; }
function burst(seed: number, ci: number, cj: number, ringStep: number, maxr: number) { const r = mul(seed); let s = ''; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const d = Math.hypot(i - ci, j - cj); const near = (d % ringStep) < 0.9 || (ringStep - (d % ringStep)) < 0.9; const fade = Math.max(0, 1 - d / maxr); if (near && fade > FLOOR && r() < fade * 1.15) s += circ(i, j); } return s; }
function scatter(seed: number, prob: number, ax: number, ay: number, sx: number, sy: number) { const r = mul(seed); let s = ''; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const dx = (cx(i) - ax) / sx, dy = (cy(j) - ay) / sy; const bias = Math.max(0.15, 1 - Math.sqrt(dx * dx + dy * dy)); if (r() < prob * bias) s += circ(i, j); } return s; }

const SPARK = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3 L13.6 9.2 L20 12 L13.6 14.8 L12 21 L10.4 14.8 L4 12 L10.4 9.2 Z" fill="currentColor"/></svg>`;
const CHK = `<svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5 L10 17.5 L19 6.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ARROW = `<svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function shell(pattern: string, hero: string) {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<!-- Сервис вставляет сюда: <style>:root{--primary:...;--bg:...;--logo:url(...)}</style> -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{--primary:#FF6A00;--bg:#0A0A0C;--logo:none;}
  *{margin:0;padding:0;box-sizing:border-box;}
  body{width:1080px;height:1080px;background:var(--bg);color:#F5F3EF;position:relative;overflow:hidden;font-family:'Onest',system-ui,sans-serif;}
  .grid{position:absolute;inset:0;z-index:0;background-image:radial-gradient(circle, rgba(255,255,255,0.05) ${R}px, transparent ${R + 0.6}px);background-size:${STEP}px ${STEP}px;}
  .mol{position:absolute;inset:0;z-index:1;} .mol circle{fill:var(--primary);}
  .layer{position:relative;z-index:3;height:100%;display:flex;flex-direction:column;padding:78px;}
  .top{display:flex;align-items:center;justify-content:space-between;}
  .brand{display:flex;align-items:center;gap:20px;}
  .brand .lg{width:78px;height:78px;background-image:var(--logo);background-size:contain;background-repeat:no-repeat;background-position:center;}
  .brand .nm{font-size:48px;font-weight:700;letter-spacing:-0.01em;}
  .chip{display:inline-flex;align-items:center;gap:10px;background:var(--primary);color:#fff;font-weight:600;font-size:25px;padding:13px 22px;border-radius:14px;box-shadow:0 8px 30px rgba(255,106,0,0.32);}
  .chip svg{width:25px;height:25px;}
  .vchip{display:inline-flex;align-items:center;gap:8px;background:color-mix(in srgb,var(--primary) 15%,transparent);color:var(--primary);border:1px solid color-mix(in srgb,var(--primary) 40%,transparent);border-radius:12px;padding:9px 18px;font-weight:700;font-size:26px;backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);}
  .h{font-weight:800;line-height:0.99;letter-spacing:-0.03em;} .h .o{color:var(--primary);}
  .lead{color:#9A9AA2;line-height:1.4;}
  .cards{display:flex;flex-direction:column;gap:15px;}
  .card{display:flex;align-items:center;gap:18px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);border-radius:18px;padding:22px 26px;backdrop-filter:blur(18px) saturate(1.35);-webkit-backdrop-filter:blur(18px) saturate(1.35);box-shadow:inset 0 1px 0 rgba(255,255,255,0.06);}
  .card .ic{width:52px;height:52px;flex-shrink:0;border-radius:12px;background:color-mix(in srgb,var(--primary) 15%,transparent);color:var(--primary);display:flex;align-items:center;justify-content:center;}
  .card .ic svg{width:28px;height:28px;} .card .tx{font-size:29px;font-weight:600;line-height:1.25;}
  .card:has(.tx:empty){display:none;}
  .btn{display:inline-flex;align-items:center;gap:12px;background:var(--primary);color:#fff;font-weight:700;font-size:31px;padding:20px 38px;border-radius:16px;box-shadow:0 10px 40px rgba(255,106,0,0.34);}
  .btn svg{width:28px;height:28px;}
  .hero{flex:1;display:flex;flex-direction:column;justify-content:center;}
</style></head>
<body class="has-logo">
  <div class="grid"></div>
  <svg class="mol" viewBox="0 0 1080 1080">${pattern}</svg>
  <div class="layer">
    <div class="top">
      <div class="brand"><span class="lg"></span><span class="nm">{{BRAND}}</span></div>
      <div class="chip">${SPARK}{{RUBRIC}}</div>
    </div>
    ${hero}
  </div>
</body></html>`;
}

const T: Record<string, { avoid: number[][]; pattern: () => string; hero: string }> = {
  '01-update.html': { avoid: [...HEAD, [60, 330, 280, 410], [60, 415, 760, 600]], pattern: () => molecule(11, 1150, 560, 560, 640, 1.35), hero: `
    <div class="hero" style="gap:34px;">
      <div><span class="vchip">${SPARK}{{VERSION}}</span></div>
      <div class="h" style="font-size:94px;max-width:820px;">{{TITLE_WHITE}} <span class="o">{{TITLE_ACCENT}}</span></div>
      <div class="cards" style="max-width:860px;">
        <div class="card"><span class="ic">${CHK}</span><span class="tx">{{CH1}}</span></div>
        <div class="card"><span class="ic">${CHK}</span><span class="tx">{{CH2}}</span></div>
        <div class="card"><span class="ic">${CHK}</span><span class="tx">{{CH3}}</span></div>
      </div>
    </div>` },
  '02-drop.html': { avoid: [...HEAD, [110, 450, 1010, 1015]], pattern: () => molecule(22, 1140, -60, 520, 520, 1.7) + molecule(23, -60, 1140, 520, 520, 1.7), hero: `
    <div class="hero" style="align-items:center;text-align:center;gap:30px;">
      <div class="h" style="font-size:118px;max-width:900px;">{{TITLE_WHITE}} <span class="o">{{TITLE_ACCENT}}</span></div>
      <div class="lead" style="font-size:35px;max-width:760px;">{{SUBTITLE}}</div>
      <div class="btn">{{CTA}} ${ARROW}</div>
    </div>` },
  '03-feature.html': { avoid: [...HEAD, [60, 300, 900, 560], [60, 585, 560, 730]], pattern: () => molecule(7, 1180, 1180, 600, 580, 1.4), hero: `
    <div class="hero" style="justify-content:flex-start;margin-top:60px;">
      <div class="h" style="font-size:104px;max-width:820px;">{{TITLE_WHITE}} <span class="o">{{TITLE_ACCENT}}</span></div>
      <div class="lead" style="margin-top:32px;font-size:32px;max-width:520px;">{{LEAD}}</div>
      <div class="cards" style="margin-top:auto;max-width:660px;">
        <div class="card"><span class="ic">${SPARK}</span><span class="tx">{{POINT1}}</span></div>
        <div class="card"><span class="ic">${SPARK}</span><span class="tx">{{POINT2}}</span></div>
      </div>
    </div>` },
  '04-giveaway.html': { avoid: [...HEAD, [60, 610, 780, 720]], pattern: () => burst(41, 52, 6, 4.6, 40), hero: `
    <div class="hero" style="gap:28px;">
      <div class="card" style="background:var(--primary);border:none;padding:48px 52px;flex-direction:column;align-items:flex-start;gap:16px;box-shadow:0 20px 70px rgba(255,106,0,0.4);">
        <span style="font-weight:600;font-size:27px;opacity:.85;color:#fff;">Разыгрываем</span>
        <span class="tx" style="font-size:78px;font-weight:800;line-height:1.02;color:#fff;">{{PRIZE}}</span>
      </div>
      <div class="lead" style="font-size:32px;max-width:640px;">{{SUBTITLE}}</div>
      <div style="display:flex;gap:15px;flex-wrap:wrap;">
        <span class="vchip">{{DEADLINE}}</span><span class="vchip">{{COND}}</span>
      </div>
    </div>` },
  '05-promo.html': { avoid: [...HEAD, [60, 300, 920, 470], [60, 775, 520, 850]], pattern: () => diag(51, 1560, 150, 1.6), hero: `
    <div class="hero" style="gap:30px;">
      <div class="h" style="font-size:80px;max-width:820px;">{{DISCOUNT_WHITE}} <span class="o">{{DISCOUNT_ACCENT}}</span></div>
      <div class="card" style="border:2px dashed color-mix(in srgb,var(--primary) 55%,transparent);background:color-mix(in srgb,var(--primary) 8%,transparent);border-radius:20px;padding:38px 44px;justify-content:center;">
        <span class="tx" style="font-size:76px;font-weight:800;letter-spacing:0.08em;color:var(--primary);">{{CODE}}</span>
      </div>
      <div class="lead" style="font-size:29px;">{{VALID}}</div>
    </div>` },
  '06-number.html': { avoid: [...HEAD, [60, 330, 560, 600], [60, 600, 900, 770], [60, 770, 730, 840]], pattern: () => wall(61, 'b', 460, 1.9), hero: `
    <div class="hero" style="align-items:flex-start;justify-content:center;">
      <div style="font-weight:800;font-size:250px;line-height:0.9;letter-spacing:-0.04em;color:var(--primary);">{{VALUE}}</div>
      <div style="font-weight:700;font-size:54px;line-height:1.1;max-width:820px;margin-top:16px;">{{LABEL}}</div>
      <div class="lead" style="font-size:31px;max-width:640px;margin-top:12px;">{{COMMENT}}</div>
    </div>` },
  '07-tip.html': { avoid: [...HEAD, [60, 470, 920, 700]], pattern: () => wave(71, 900, 70, 0.5, 110), hero: `
    <div class="hero" style="gap:34px;">
      <div><span class="vchip">${SPARK}Совет {{TIPNUM}}</span></div>
      <div class="h" style="font-size:96px;max-width:840px;">{{TITLE_WHITE}} <span class="o">{{TITLE_ACCENT}}</span></div>
      <div class="card" style="max-width:820px;"><span class="ic">${SPARK}</span><span class="tx" style="font-weight:500;color:#C9C9CF;">{{LEAD}}</span></div>
    </div>` },
  '08-teaser.html': { avoid: [...HEAD, [60, 400, 700, 660], [60, 675, 660, 790]], pattern: () => wall(81, 'r', 460, 1.6), hero: `
    <div class="hero" style="justify-content:center;gap:30px;">
      <div><span class="vchip">${SPARK}{{LABEL}}</span></div>
      <div class="h" style="font-size:104px;max-width:600px;">{{TITLE_WHITE}} <span class="o">{{TITLE_ACCENT}}</span></div>
      <div class="lead" style="font-size:33px;max-width:520px;">{{HINT}}</div>
      <div><span class="chip" style="font-size:29px;">{{DATE}}</span></div>
    </div>` },
  '09-question.html': { avoid: [...HEAD], pattern: () => scatter(91, 0.13, 540, 200, 720, 620), hero: `
    <div class="hero" style="gap:26px;">
      <div class="card" style="border-radius:26px 26px 26px 8px;padding:44px 50px;">
        <span class="tx" style="font-size:66px;font-weight:800;line-height:1.08;letter-spacing:-0.02em;">{{QUESTION_WHITE}} <span class="o">{{QUESTION_ACCENT}}</span></span>
      </div>
      <div class="cards" style="max-width:860px;">
        <div class="card"><span class="ic">${SPARK}</span><span class="tx">{{OPT1}}</span></div>
        <div class="card"><span class="ic">${SPARK}</span><span class="tx">{{OPT2}}</span></div>
        <div class="card"><span class="ic">${SPARK}</span><span class="tx">{{OPT3}}</span></div>
      </div>
    </div>` },
  '10-about.html': { avoid: [...HEAD, [60, 330, 800, 880]], pattern: () => molecule(101, 1150, 560, 560, 640, 1.35), hero: `
    <div class="hero" style="justify-content:center;gap:40px;">
      <div class="h" style="font-size:112px;max-width:840px;">{{TITLE_WHITE}} <span class="o">{{TITLE_ACCENT}}</span></div>
      <div class="card" style="max-width:800px;"><span class="tx" style="font-weight:500;color:#D6D6D2;">{{LEAD}}</span></div>
    </div>` },
};

// Hand-painted layout from the dot editor (scripts/__dots/<name>.json) wins over
// the algorithmic pattern when present — honored exactly as drawn.
function customDots(file: string): string | null {
  const p = path.resolve('scripts/__dots', file.replace('.html', '.json'));
  if (!fsSync.existsSync(p)) return null;
  const cells: number[][] = JSON.parse(fsSync.readFileSync(p, 'utf-8'));
  let s = '';
  for (const [i, j] of cells) { const x = cx(i), y = cy(j); if (x >= R && x <= 1080 - R && y >= R && y <= 1080 - R) s += circ(i, j); }
  return s || '';
}

async function main() {
  for (const [file, { avoid, pattern, hero }] of Object.entries(T)) {
    AV = [];                                   // custom layout ignores exclusion zones
    const custom = customDots(file);
    if (custom === null) AV = avoid;           // only the algorithm respects the zones
    await fs.writeFile(path.join(OUT, file), shell(custom ?? pattern(), hero));
    console.log('wrote', file, custom !== null ? '(hand-painted)' : '');
  }
}
main();
