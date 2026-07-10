/**
 * Dot editor: paint the orange-dot lattice by hand for each Publium rubric.
 * Run:  npx tsx server/scripts/__editor.ts   → open http://localhost:5600
 * Saved layouts land in <scripts>/__dots/<name>.json and buildPublium.ts uses them.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';

const SDIR = fs.existsSync('server/scripts/buildPublium.ts') ? 'server/scripts' : 'scripts';
const TPL = path.join(SDIR, 'publium-templates');
const DOTS = path.join(SDIR, '__dots');
fs.mkdirSync(DOTS, { recursive: true });
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.join(SDIR, 'assets/publium-logo.png')).toString('base64');

const S: Record<string, Record<string, string>> = {
  '01-update.html': { BRAND: 'Publium', RUBRIC: 'Апдейт', VERSION: 'v1.4', TITLE_WHITE: 'Большое обновление', TITLE_ACCENT: 'редактора', CH1: 'Галереи: карусель и сетка в один клик', CH2: 'AI-картинки прямо в блоках поста', CH3: 'Кнопки-ссылки под постом' },
  '02-drop.html': { BRAND: 'Publium', RUBRIC: 'Дроп', TITLE_WHITE: 'Стиль', TITLE_ACCENT: '«Кибер»', SUBTITLE: 'Кибер-брутализм для tech-каналов — 9 шаблонов под все рубрики', CTA: 'Уже в магазине' },
  '03-feature.html': { BRAND: 'Publium', RUBRIC: 'Фича', TITLE_WHITE: 'Ссылка в Create —', TITLE_ACCENT: 'и пост готов', LEAD: 'Кидай статью, новость или скриншот — остальное соберётся само.', POINT1: 'Текст и обложка — автоматически', POINT2: 'Публикация в канал в один тап' },
  '04-giveaway.html': { BRAND: 'Publium', RUBRIC: 'Розыгрыш', PRIZE: '3 месяца PRO', SUBTITLE: 'Разыгрываем подписки среди подписчиков канала', DEADLINE: 'до 15 июля', COND: 'подписка + коммент' },
  '05-promo.html': { BRAND: 'Publium', RUBRIC: 'Промокод', DISCOUNT_WHITE: 'Скидка 30% на', DISCOUNT_ACCENT: 'первый месяц', CODE: 'PUBLIUM30', VALID: 'действует до 31 июля' },
  '06-number.html': { BRAND: 'Publium', RUBRIC: 'Цифра', VALUE: '50K', LABEL: 'обложек сгенерировано в Publium', COMMENT: 'спасибо, что создаёте вместе с нами' },
  '07-tip.html': { BRAND: 'Publium', RUBRIC: 'Совет', TIPNUM: '07', TITLE_WHITE: 'Кидай в Create', TITLE_ACCENT: 'просто ссылку', LEAD: 'Статья, новость или скриншот — пост и обложка соберутся сами.' },
  '08-teaser.html': { BRAND: 'Publium', RUBRIC: 'Анонс', LABEL: 'Скоро', TITLE_WHITE: 'Готовим то, о чём', TITLE_ACCENT: 'вы просили', HINT: 'Подсказка: это про рубрики и автопостинг', DATE: 'на следующей неделе' },
  '09-question.html': { BRAND: 'Publium', RUBRIC: 'Вопрос', QUESTION_WHITE: 'Какой стиль сделать', QUESTION_ACCENT: 'следующим?', OPT1: 'Минимализм для бизнеса', OPT2: 'Пастель для лайфстайла', OPT3: 'Неон для гейминга' },
  '10-about.html': { BRAND: 'Publium', RUBRIC: 'О проекте', TITLE_WHITE: 'Мы запустили', TITLE_ACCENT: 'Publium', LEAD: 'AI-платформа для брендов и авторов: системно создавать контент, публиковать посты и развивать комьюнити — в стиле вашего бренда.' },
  // ── Carousel pack (cover / item / outro) — paint dots per slide ──
  'car-cover.html': { RUBRIC: 'О проекте', TITLE_WHITE: 'Контент. Комьюнити.', TITLE_ACCENT: 'Publium.', SUBTITLE: 'Контент, который работает на бренд. Комьюнити, которое остаётся. Publium связывает это в одну систему.' },
  'car-item.html':  { RUBRIC: 'О проекте', TITLE_WHITE: 'Идея', TITLE_ACCENT: '→ готовый пост', DESC: 'Отправьте идею, ссылку или текст — Publium соберёт публикацию: текст, структуру, обложку, CTA и оформление в стиле бренда.' },
  'car-outro.html': { RUBRIC: 'О проекте', TITLE_WHITE: 'Telegram сегодня.', TITLE_ACCENT: 'Дальше — везде', CTA: 'Подпишись', AUTHOR: '@publium' },
};

function fillTemplate(name: string): string {
  let html = fs.readFileSync(path.join(TPL, name), 'utf-8');
  const slots = S[name] || {};
  html = html.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, k) => slots[k] ?? '');
  // Transparent bg + no template dots/grid: the iframe shows ONLY the content
  // (header/title/cards) over transparency, so the editor's dot canvas sits
  // BEHIND it — painted dots go under cards/text, matching the real render.
  html = html.replace(/<\/head>/i, `<style>:root{--primary:#FF6A00;--accent:#FF6A00;--bg:transparent;--logo:url("${LOGO}");}html,body{background:transparent!important}.grid,.mol{display:none!important}</style></head>`);
  return html;
}

const EDITOR = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Dot editor</title><style>
  body{margin:0;background:#0d0d0f;color:#eee;font-family:system-ui,sans-serif;display:flex;gap:18px;padding:18px}
  #wrap{position:relative}
  #stage{position:relative;width:1080px;height:1080px;transform-origin:top left;outline:1px solid #333;background:#0A0A0C}
  #cv{position:absolute;inset:0;cursor:crosshair;z-index:1}
  #bg{position:absolute;inset:0;border:0;width:1080px;height:1080px;pointer-events:none;z-index:2}
  #panel{display:flex;flex-direction:column;gap:12px;min-width:230px}
  h3{margin:0 0 4px}
  button,select{padding:9px 13px;font-size:14px;border-radius:9px;border:1px solid #444;background:#1c1c1f;color:#eee;cursor:pointer}
  button.p{background:#FF6A00;border-color:#FF6A00;color:#fff;font-weight:700}
  .hint{font-size:12px;color:#8a8a92;line-height:1.5}
</style></head><body>
<div id="wrap"><div id="stage"><iframe id="bg"></iframe><canvas id="cv" width="1080" height="1080"></canvas></div></div>
<div id="panel">
  <h3>Редактор точек</h3>
  <select id="sel"></select>
  <div>Точек: <b id="cnt">0</b></div>
  <button id="mode">Режим: рисовать</button>
  <button id="clr">Очистить</button>
  <button class="p" id="save">Сохранить</button>
  <div class="hint">ЛКМ — поставить/убрать точку. Зажми и веди — рисовать линию. Переключи «Режим» на «стирать», чтобы убирать. После «Сохранить» скажи мне «готово, &lt;рубрика&gt;» — подхвачу раскладку.</div>
</div>
<script>
const STEP=22,R=10.2,W=1080,N=Math.ceil(W/STEP);
const cv=document.getElementById('cv'),ctx=cv.getContext('2d'),bg=document.getElementById('bg'),sel=document.getElementById('sel'),cnt=document.getElementById('cnt');
const names=['car-cover.html','car-item.html','car-outro.html','01-update.html','02-drop.html','03-feature.html','04-giveaway.html','05-promo.html','06-number.html','07-tip.html','08-teaser.html','09-question.html','10-about.html'];
names.forEach(n=>{const o=document.createElement('option');o.value=n;o.textContent=n;sel.appendChild(o);});
let cells=new Set(),erase=false,drawing=false;
const key=(i,j)=>i+','+j;
function draw(){ctx.clearRect(0,0,W,W);ctx.fillStyle='rgba(255,255,255,0.06)';
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){ctx.beginPath();ctx.arc(STEP/2+i*STEP,STEP/2+j*STEP,R,0,7);ctx.fill();}
  ctx.fillStyle='#FF6A00';
  cells.forEach(k=>{const p=k.split(',');ctx.beginPath();ctx.arc(STEP/2+p[0]*STEP,STEP/2+p[1]*STEP,R,0,7);ctx.fill();});
  cnt.textContent=cells.size;}
function cell(e){const r=cv.getBoundingClientRect();const x=(e.clientX-r.left)*(W/r.width),y=(e.clientY-r.top)*(W/r.height);return[Math.round((x-STEP/2)/STEP),Math.round((y-STEP/2)/STEP)];}
function apply(e){const c=cell(e);if(c[0]<0||c[1]<0||c[0]>=N||c[1]>=N)return;const k=key(c[0],c[1]);if(erase)cells.delete(k);else cells.add(k);draw();}
cv.addEventListener('mousedown',e=>{drawing=true;apply(e);});
cv.addEventListener('mousemove',e=>{if(drawing)apply(e);});
window.addEventListener('mouseup',()=>drawing=false);
document.getElementById('mode').onclick=e=>{erase=!erase;e.target.textContent='Режим: '+(erase?'стирать':'рисовать');};
document.getElementById('clr').onclick=()=>{cells.clear();draw();};
document.getElementById('save').onclick=async()=>{const arr=[...cells].map(k=>k.split(',').map(Number));await fetch('/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:sel.value,cells:arr})});const b=document.getElementById('save');b.textContent='Сохранено ✓';setTimeout(()=>b.textContent='Сохранить',1200);};
async function load(){bg.src='/tpl/'+encodeURIComponent(sel.value);const r=await fetch('/dots/'+encodeURIComponent(sel.value));const arr=await r.json();cells=new Set(arr.map(p=>key(p[0],p[1])));draw();}
sel.onchange=load;
function fit(){const s=Math.min(1,(window.innerHeight-36)/W);document.getElementById('stage').style.transform='scale('+s+')';document.getElementById('wrap').style.width=(W*s)+'px';document.getElementById('wrap').style.height=(W*s)+'px';}
window.addEventListener('resize',fit);fit();load();
</script></body></html>`;

http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://x');
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html;charset=utf-8'); res.end(EDITOR); return; }
  if (u.pathname.startsWith('/tpl/')) { const n = decodeURIComponent(u.pathname.slice(5)); res.setHeader('content-type', 'text/html;charset=utf-8'); res.end(fillTemplate(n)); return; }
  if (u.pathname.startsWith('/dots/')) { const n = decodeURIComponent(u.pathname.slice(6)).replace('.html', '.json'); const p = path.join(DOTS, n); res.setHeader('content-type', 'application/json'); res.end(fs.existsSync(p) ? fs.readFileSync(p) : '[]'); return; }
  if (u.pathname === '/save' && req.method === 'POST') { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { const { name, cells } = JSON.parse(b); fs.writeFileSync(path.join(DOTS, String(name).replace('.html', '.json')), JSON.stringify(cells)); res.end('ok'); } catch { res.statusCode = 500; res.end('err'); } }); return; }
  res.statusCode = 404; res.end('not found');
}).listen(5600, () => console.log('dot editor → http://localhost:5600'));
