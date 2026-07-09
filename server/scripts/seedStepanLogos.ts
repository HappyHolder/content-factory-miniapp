/**
 * seedStepanLogos.ts
 *
 * Seeds the private "Stepan Logos" cover-style pack (dark blueprint, #4DB8FF,
 * Barlow/Inter/Fira). Rubrics of a builder/founder channel. 3 templates so far:
 * Новости, Мои проекты, Украсть как билдер.
 *
 * published:false → visible ONLY in the admin panel; only the admin can apply it.
 * Fonts are inlined as base64 so Cyrillic renders on the server (Barlow from
 * Google has no Cyrillic; these are the channel's own woff2 files).
 *
 * Idempotent (matched by slug). Run inside the api container:
 *   npx tsx scripts/seedStepanLogos.ts
 */

import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../src/db';
import { putObject } from '../src/lib/storage';
import { renderHtmlPreview } from '../src/lib/playwrightRenderer';

const SLUG = 'stepanlogos';
const DIR = path.resolve(process.cwd(), 'scripts/stepanlogos-templates');

const FONT_FILES = ['barlow-700.woff2', 'barlow-800.woff2', 'inter.woff2'];

/** Replaces relative woff2 refs with base64 data URIs so the template is self-contained. */
async function inlineFonts(htmlRaw: string): Promise<string> {
  let html = htmlRaw;
  for (const f of FONT_FILES) {
    const buf = await fs.readFile(path.join(DIR, f));
    const dataUri = `data:font/woff2;base64,${buf.toString('base64')}`;
    html = html.split(`url('${f}')`).join(`url(${dataUri})`);
  }
  return html;
}

const TEMPLATES: { name: string; file: string; demoSlots: Record<string, string> }[] = [
  { name: 'Новости', file: 'news.html', demoSlots: {
    RUBRIC: 'новости', SOURCE: 'Cointelegraph', BADGE: 'срочно',
    TITLE_WHITE: 'Иск на $200 млн', TITLE_ACCENT: 'против Binance и CZ',
    LEAD: 'Британские инвесторы подали коллективный иск на $200 млн против Binance и Чанпэна Чжао.',
    TAG1: 'крипто', TAG2: 'суд', TAG3: 'binance', AUTHOR: '@stepanlogos' } },
  { name: 'Мои проекты', file: 'projects.html', demoSlots: {
    RUBRIC: 'мои проекты', TOP_TAG: 'update', STATUS: 'live',
    TITLE_WHITE: 'TON', TITLE_ACCENT: 'VIBE',
    DESC: 'Социальная сеть на TON. Эксперимент превратился в живой продукт.',
    M1_VALUE: '1300+', M1_LABEL: 'пользователей',
    M2_VALUE: '~$100', M2_LABEL: 'бюджет',
    M3_VALUE: 'App Center', M3_LABEL: 'в Telegram',
    TAG1: 'ton', TAG2: 'socialfi', TAG3: 'mini app', AUTHOR: '@stepanlogos' } },
  { name: 'Идея на миллион', file: 'idea.html', demoSlots: {
    RUBRIC: 'идея на миллион', TOP_TAG: 'концепт',
    IDEA_WHITE: 'Дуэли ставок', IDEA_ACCENT: 'в Telegram',
    DESC: '1 на 1: закинул прогноз, соперник принял — победитель забирает банк.',
    CHIP1: 'SocialFi', CHIP2: 'GameFi', CHIP3: 'Mini App',
    NOTE: 'потенциал: вирусно и просто', AUTHOR: '@stepanlogos' } },
  { name: 'Украсть как билдер', file: 'ukrast.html', demoSlots: {
    RUBRIC: 'украсть как билдер', TOP_TAG: 'перенос паттерна',
    TITLE_WHITE: 'Ворую стрик', TITLE_ACCENT: 'у Duolingo',
    FROM_LABEL: 'что подсмотрел', FROM1: 'ежедневный стрик', FROM2: 'пуш-напоминания', FROM3: 'страх потерять серию', FROM4: '', FROM_FOOT: 'механика обучалок',
    TO_LABEL: 'как применяю', TO1: 'daily-заход в Mini App', TO2: 'пуши на возврат', TO3: '', TO4: '', TO_FOOT: '= стрик держит людей',
    TAGLINE: 'Не изобретаю — адаптирую то, что работает.', AUTHOR: '@stepanlogos' } },
];

const PALETTE = [
  { name: 'Акцент', hex: '#4DB8FF', usage: 'Фирменный голубой Stepan Logos (тянется к цвету канала)' },
  { name: 'Фон',    hex: '#0F1011', usage: 'Тёмный фон обложки' },
];

const VISUAL_COVER_STYLE =
  'Stepan Logos style: dark near-black (#0F1011) with a blueprint grid and cyan #4DB8FF accent (adapts to the ' +
  'channel color), glass cards with soft borders, // terminal labels and /// tag separators, Barlow display ' +
  'headings + Inter body + monospace details. Engineering/builder aesthetic. Works on grid or over an AI photo.';

async function main() {
  console.log('[seed:stepanlogos] uploading templates from', DIR);

  const templates: { name: string; url: string; demoSlots: Record<string, string> }[] = [];
  for (const tpl of TEMPLATES) {
    const raw = await fs.readFile(path.join(DIR, tpl.file), 'utf8');
    const html = await inlineFonts(raw);
    const obj = await putObject(`styles/stepanlogos/${tpl.file}`, Buffer.from(html, 'utf8'), { contentType: 'text/html; charset=utf-8' });
    console.log(`[seed:stepanlogos]   ${tpl.file} → ${obj.url}`);
    templates.push({ name: tpl.name, url: obj.url, demoSlots: tpl.demoSlots });
  }

  // Universal carousel slide — stored separately from the rubric templates.
  const carRaw = await fs.readFile(path.join(DIR, 'carousel.html'), 'utf8');
  const carObj = await putObject('styles/stepanlogos/carousel.html', Buffer.from(await inlineFonts(carRaw), 'utf8'), { contentType: 'text/html; charset=utf-8' });
  console.log(`[seed:stepanlogos]   carousel.html → ${carObj.url}`);
  const carouselTemplate = {
    name: 'Карусель', url: carObj.url,
    demoSlots: { RUBRIC: 'подборка', COUNT: '02 / 05', NUM: '02', TITLE_WHITE: 'Cursor', TITLE_ACCENT: '',
      DESC: 'AI-редактор, где код пишется диалогом с моделью.', TAG1: 'инструменты', TAG2: 'ai', TAG3: 'workflow', TAG4: 'стек' },
  };

  const baseData = {
    nameRu: 'Stepan Logos', nameEn: 'Stepan Logos',
    descRu: 'Приватный стиль канала Stepan Logos: тёмный «чертёжный» вид с голубым акцентом, стеклянные карточки, терминальные подписи. Рубрики билдера — новости, мои проекты, украсть как билдер (и далее).',
    descEn: 'Private Stepan Logos channel style: dark blueprint look with a cyan accent, glass cards, terminal labels. Builder rubrics — news, my projects, steal-as-a-builder (more coming).',
    tags: ['билдер', 'tech', 'тёмный', 'blueprint', 'signature'],
    priceKind: 'FREE',
    brandAdaptive: true,
    recommendedMode: 'ai_html',
    palette: PALETTE,
    visualCoverStyle: VISUAL_COVER_STYLE,
    bgStyle: null, bgDetail: null, fontPreset: null, logoUsage: 'when_relevant',
    templates,
    carouselTemplate,
    published: false, // admin-only: not applicable by other users
    sortOrder: 98,
  };

  const style = await prisma.style.upsert({
    where:  { slug: SLUG },
    update: baseData as never,
    create: { slug: SLUG, ...baseData } as never,
  });
  console.log('[seed:stepanlogos] style upserted:', style.id);

  const previews: string[] = [];
  for (const tpl of templates) {
    const url = await renderHtmlPreview({
      htmlTemplateUrl: tpl.url,
      brand:           { primaryColor: '#4DB8FF', bgColor: '#0F1011' },
      slots:           tpl.demoSlots,
      aspectRatio:     '1:1',
    });
    if (url) { previews.push(url); console.log(`[seed:stepanlogos]   preview ${tpl.name} → ${url}`); }
    else console.warn(`[seed:stepanlogos]   preview FAILED for ${tpl.name}`);
  }
  if (previews.length > 0) {
    await prisma.style.update({ where: { id: style.id }, data: { previews, heroPreview: previews[0] } });
    console.log(`[seed:stepanlogos] saved ${previews.length} previews`);
  }

  console.log('[seed:stepanlogos] done ✓');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[seed:stepanlogos] FAILED:', err);
  await prisma.$disconnect();
  process.exit(1);
});
