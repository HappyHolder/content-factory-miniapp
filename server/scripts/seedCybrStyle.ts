/**
 * seedCybrStyle.ts
 *
 * Seeds the FREE "CYBR" (cyber-brutalism tech/AI) cover-style pack into the Styles market:
 *   1. uploads the 9 CYBR HTML templates to storage,
 *   2. upserts the published Style (slug "cybr") with palette + demo slots,
 *   3. renders a 1:1 demo preview for each template and saves them on the style.
 *
 * Idempotent — re-running updates the same style (matched by slug).
 * Run inside the api container:  npx tsx scripts/seedCybrStyle.ts
 */

import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../src/db';
import { putObject } from '../src/lib/storage';
import { renderHtmlPreview } from '../src/lib/playwrightRenderer';

const SLUG = 'cybr';
const TEMPLATES_DIR = path.resolve(process.cwd(), 'scripts/cybr-templates');

// rubric label (AI matches by this) → file + demo slot values for the preview.
const TEMPLATES: { name: string; file: string; demoSlots: Record<string, string> }[] = [
  { name: 'Новости', file: '01-news.html', demoSlots: {
    BRAND: 'PUBLIUM', RUBRIC: 'Новости',
    TITLE_WHITE: 'GPT-6 вышел', TITLE_ACCENT: 'в открытый доступ',
    LEAD: 'OpenAI выложила веса — модель уже можно запустить локально',
    STAT1_VAL: '1.8T', STAT1_LABEL: 'параметров', STAT2_VAL: '128K', STAT2_LABEL: 'контекст',
    TAG1: 'ai', TAG2: 'openai', TAG3: 'opensource', HANDLE: '@publium' } },
  { name: 'Релиз', file: '02-release.html', demoSlots: {
    BRAND: 'PUBLIUM', RUBRIC: 'Релиз', PRODUCT: 'NEO CORE', VERSION: 'v2.0',
    SUBTITLE: 'Локальная LLM теперь работает на телефоне',
    FEAT1: 'контекст 1M токенов', FEAT2: 'инференс на 40% быстрее', FEAT3: 'вес всего 3.2 ГБ',
    TAG1: 'release', TAG2: 'llm', TAG3: 'mobile', HANDLE: '@publium' } },
  { name: 'Разбор', file: '03-razbor.html', demoSlots: {
    BRAND: 'PUBLIUM', RUBRIC: 'Разбор',
    TITLE_WHITE: 'Тестируем', TITLE_ACCENT: 'RTX 6090',
    METRIC1_LABEL: 'Cyberpunk FPS', METRIC1_VAL: '212', METRIC1_PCT: '92',
    METRIC2_LABEL: 'Blender BMW', METRIC2_VAL: '8.4s', METRIC2_PCT: '78',
    METRIC3_LABEL: 'Температура', METRIC3_VAL: '67°C', METRIC3_PCT: '54',
    TAG1: 'nvidia', TAG2: 'benchmark', TAG3: 'gpu', HANDLE: '@publium' } },
  { name: 'Versus', file: '04-versus.html', demoSlots: {
    BRAND: 'PUBLIUM', RUBRIC: 'Versus',
    LEFT_NAME: 'CLAUDE', LEFT_SUB: 'код, агенты, длинный контекст',
    RIGHT_NAME: 'GPT', RIGHT_SUB: 'мультимодальность и экосистема',
    VERDICT: 'выбор зависит от задачи — полный разбор внутри',
    TAG1: 'ai', TAG2: 'versus', TAG3: 'llm', HANDLE: '@publium' } },
  { name: 'Гайд', file: '05-guide.html', demoSlots: {
    BRAND: 'PUBLIUM', RUBRIC: 'Гайд', STEPLABEL: 'Шаг 1 из 3',
    TITLE_WHITE: 'Ставим Linux', TITLE_ACCENT: 'не сломав Windows',
    LEAD: 'Пошаговый гайд по dual boot: разметка, загрузчик, драйверы',
    TAG1: 'guide', TAG2: 'linux', TAG3: 'dualboot', HANDLE: '@publium' } },
  { name: 'Мнение', file: '06-opinion.html', demoSlots: {
    BRAND: 'PUBLIUM', RUBRIC: 'Мнение',
    QUOTE_WHITE: 'ИИ не заменит тебя.', QUOTE_ACCENT: 'Заменит тот, кто им пользуется',
    AUTHOR_NAME: 'Digital Core', AUTHOR_ROLE: 'tech-канал',
    TAG1: 'ai', TAG2: 'opinion', TAG3: 'future', HANDLE: '@publium' } },
  { name: 'Дайджест', file: '07-digest.html', demoSlots: {
    BRAND: 'PUBLIUM', RUBRIC: 'Дайджест',
    HEAD_WHITE: 'Неделя в', HEAD_ACCENT: 'технологиях',
    ITEM1: 'Apple показала Vision Pro 2', ITEM2: 'xAI подняла $20B',
    ITEM3: 'ЕС принял AI Act 2.0', ITEM4: 'Nvidia обошла Apple по капе',
    TAG1: 'digest', TAG2: 'weekly', TAG3: 'tech', HANDLE: '@publium' } },
  { name: 'Топ', file: '08-top.html', demoSlots: {
    BRAND: 'PUBLIUM', RUBRIC: 'Топ',
    HEAD_WHITE: 'Топ нейросетей', HEAD_ACCENT: 'для кода',
    NAME1: 'Claude Code', VAL1: '9.8', NAME2: 'Cursor', VAL2: '9.4', NAME3: 'Copilot', VAL3: '8.9',
    NAME4: 'Windsurf', VAL4: '8.5', NAME5: 'Codeium', VAL5: '7.9',
    TAG1: 'top', TAG2: 'aitools', TAG3: 'coding', HANDLE: '@publium' } },
  { name: 'Анонс', file: '09-event.html', demoSlots: {
    BRAND: 'PUBLIUM', RUBRIC: 'Анонс', EVENT: 'AI MEETUP',
    SUBTITLE: 'Разбираем агентов вживую — стрим + Q&A с подписчиками',
    DATE: '24 июля', TIME: '19:00 МСК', PLACE: 'Онлайн',
    TAG1: 'event', TAG2: 'stream', TAG3: 'ai', HANDLE: '@publium' } },
];

const PALETTE = [
  { name: 'Акцент', hex: '#D4FF00', usage: 'Кислотный акцент (тянется к цвету канала)' },
  { name: 'Фон',    hex: '#0A0A0B', usage: 'Почти чёрный фон обложки' },
];

const VISUAL_COVER_STYLE =
  'Cyber-brutalist tech style on near-black (#0A0A0B) with a single acid accent (#D4FF00, adapts to the ' +
  'channel color). Unbounded display type + JetBrains Mono terminal chrome: scanlines, corner brackets, ' +
  'section numbers (/01), hazard stripes, HUD cells, terminal windows. Raw, systematic, high-contrast.';

async function main() {
  console.log('[seed:cybr] uploading templates from', TEMPLATES_DIR);

  // 1. Upload each HTML template → public URL.
  const templates: { name: string; url: string; demoSlots: Record<string, string> }[] = [];
  for (const tpl of TEMPLATES) {
    const buf = await fs.readFile(path.join(TEMPLATES_DIR, tpl.file));
    const obj = await putObject(`styles/cybr/${tpl.file}`, buf, { contentType: 'text/html; charset=utf-8' });
    console.log(`[seed:cybr]   ${tpl.file} → ${obj.url}`);
    templates.push({ name: tpl.name, url: obj.url, demoSlots: tpl.demoSlots });
  }

  // 2. Upsert the style (matched by slug).
  const baseData = {
    nameRu: 'Кибер', nameEn: 'CYBR',
    descRu: 'Кибер-брутализм для tech/AI-каналов: 9 шаблонов по рубрикам (новости, релиз, разбор, versus, гайд, мнение, дайджест, топ, анонс). Терминальный хром, сканлайны, кислотный акцент — тянется к цвету канала.',
    descEn: 'Cyber-brutalism for tech/AI channels: 9 rubric templates (news, release, deep dive, versus, guide, opinion, digest, top, event). Terminal chrome, scanlines, an acid accent that adapts to your channel color.',
    tags: ['tech', 'ai', 'брутализм', 'киберпанк', 'терминал'],
    priceKind: 'FREE',
    brandAdaptive: true,
    recommendedMode: 'html',
    palette: PALETTE,
    visualCoverStyle: VISUAL_COVER_STYLE,
    bgStyle: null, bgDetail: null, fontPreset: null, logoUsage: 'when_relevant',
    templates,
    published: true,
    sortOrder: 1,
  };

  const style = await prisma.style.upsert({
    where:  { slug: SLUG },
    update: baseData as never,
    create: { slug: SLUG, ...baseData } as never,
  });
  console.log('[seed:cybr] style upserted:', style.id);

  // 3. Render a 1:1 demo preview per template (canvas is 1080×1080).
  const previews: string[] = [];
  for (const tpl of templates) {
    const url = await renderHtmlPreview({
      htmlTemplateUrl: tpl.url,
      brand:           { primaryColor: '#D4FF00', bgColor: '#0A0A0B', logoUrl: null },
      slots:           tpl.demoSlots,
      aspectRatio:     '1:1',
    });
    if (url) { previews.push(url); console.log(`[seed:cybr]   preview ${tpl.name} → ${url}`); }
    else console.warn(`[seed:cybr]   preview FAILED for ${tpl.name}`);
  }

  if (previews.length > 0) {
    await prisma.style.update({ where: { id: style.id }, data: { previews, heroPreview: previews[0] } });
    console.log(`[seed:cybr] saved ${previews.length} previews`);
  }

  console.log('[seed:cybr] done ✓');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[seed:cybr] FAILED:', err);
  await prisma.$disconnect();
  process.exit(1);
});
