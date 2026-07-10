/**
 * seedPubliumStyle.ts
 *
 * Seeds the FREE "Publium" signature cover-style pack into the Styles market:
 * dark premium in the app's own identity (#070708 + orange glow + glass),
 * rubrics of a product/brand channel. 9 templates.
 *
 * Idempotent — re-running updates the same style (matched by slug).
 * Run inside the api container:  npx tsx scripts/seedPubliumStyle.ts
 */

import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../src/db';
import { putObject } from '../src/lib/storage';
import { closeBrowser, renderHtmlPreview } from '../src/lib/playwrightRenderer';

const SLUG = 'publium';
const TEMPLATES_DIR = path.resolve(process.cwd(), 'scripts/publium-templates');

// rubric label (AI matches by this) → file + demo slot values for the preview.
const TEMPLATES: { name: string; file: string; demoSlots: Record<string, string> }[] = [
  { name: 'Апдейт', file: '01-update.html', demoSlots: {
    BRAND: 'Publium', RUBRIC: 'Апдейт', VERSION: 'v1.4',
    TITLE_WHITE: 'Большое обновление', TITLE_ACCENT: 'редактора',
    CH1: 'Галереи: карусель и сетка в один клик',
    CH2: 'AI-картинки прямо в блоках поста',
    CH3: 'Кнопки-ссылки под постом',
    TAG1: 'update', TAG2: 'changelog', TAG3: 'editor', HANDLE: '@publium' } },
  { name: 'Дроп', file: '02-drop.html', demoSlots: {
    BRAND: 'Publium', RUBRIC: 'Дроп', LABEL: 'Новый пак',
    TITLE_WHITE: 'Стиль', TITLE_ACCENT: '«Кибер»',
    SUBTITLE: 'Кибер-брутализм для tech-каналов — 9 шаблонов под все рубрики',
    CTA: 'Уже в магазине',
    TAG1: 'drop', TAG2: 'styles', TAG3: 'market', HANDLE: '@publium' } },
  { name: 'Фича', file: '03-feature.html', demoSlots: {
    BRAND: 'Publium', RUBRIC: 'Фича',
    TITLE_WHITE: 'Ассистент ищет', TITLE_ACCENT: 'реальные новости',
    LEAD: 'Больше никаких выдуманных фактов — только живая выдача Google',
    POINT1: 'Поиск по вашим словам, без фантазий',
    POINT2: 'Источник указывается прямо в посте',
    TAG1: 'feature', TAG2: 'assistant', TAG3: 'ai', HANDLE: '@publium' } },
  { name: 'Розыгрыш', file: '04-giveaway.html', demoSlots: {
    BRAND: 'Publium', RUBRIC: 'Розыгрыш',
    PRIZE: '3 месяца PRO бесплатно',
    SUBTITLE: 'Разыгрываем подписки среди подписчиков канала',
    DEADLINE: 'до 15 июля', COND: 'подписка + коммент',
    TAG1: 'giveaway', TAG2: 'pro', TAG3: 'prize', HANDLE: '@publium' } },
  { name: 'Промокод', file: '05-promo.html', demoSlots: {
    BRAND: 'Publium', RUBRIC: 'Промокод',
    DISCOUNT_WHITE: 'Скидка 30% на', DISCOUNT_ACCENT: 'первый месяц',
    CODE: 'PUBLIUM30', VALID: 'действует до 31 июля',
    TAG1: 'promo', TAG2: 'sale', TAG3: 'pro', HANDLE: '@publium' } },
  { name: 'Цифра', file: '06-number.html', demoSlots: {
    BRAND: 'Publium', RUBRIC: 'Цифра',
    VALUE: '50 000', LABEL: 'обложек сгенерировано в Publium',
    COMMENT: 'спасибо, что создаёте вместе с нами',
    TAG1: 'milestone', TAG2: 'stats', TAG3: 'community', HANDLE: '@publium' } },
  { name: 'Совет', file: '07-tip.html', demoSlots: {
    BRAND: 'Publium', RUBRIC: 'Совет', TIPNUM: '07',
    TITLE_WHITE: 'Кидай в Create', TITLE_ACCENT: 'просто ссылку',
    LEAD: 'Статья, новость или скриншот — пост и обложка соберутся сами',
    TAG1: 'tips', TAG2: 'create', TAG3: 'howto', HANDLE: '@publium' } },
  { name: 'Анонс', file: '08-teaser.html', demoSlots: {
    BRAND: 'Publium', RUBRIC: 'Анонс', LABEL: 'Coming soon',
    TITLE_WHITE: 'Готовим то, о чём', TITLE_ACCENT: 'вы просили',
    HINT: 'Подсказка: это про рубрики и автопостинг',
    DATE: 'на следующей неделе',
    TAG1: 'soon', TAG2: 'teaser', TAG3: 'roadmap', HANDLE: '@publium' } },
  { name: 'Вопрос', file: '09-question.html', demoSlots: {
    BRAND: 'Publium', RUBRIC: 'Вопрос',
    QUESTION_WHITE: 'Какой стиль сделать', QUESTION_ACCENT: 'следующим?',
    OPT1: 'Минимализм для бизнеса', OPT2: 'Пастель для лайфстайла', OPT3: 'Неон для гейминга',
    TAG1: 'poll', TAG2: 'community', TAG3: 'styles', HANDLE: '@publium' } },
  // NB: 10-about ("О проекте") is intentionally NOT seeded into the app pack —
  // it's only used to hand-render the launch-post cover PNG. Keep the pack at 9.
];

const PALETTE = [
  { name: 'Акцент', hex: '#FF6A00', usage: 'Фирменный оранжевый Publium (тянется к цвету канала)' },
  { name: 'Фон',    hex: '#070708', usage: 'Почти чёрный фон обложки' },
];

const VISUAL_COVER_STYLE =
  'Publium signature style: near-black (#070708) premium with warm orange glow (#FF6A00, adapts to the ' +
  'channel color), glass cards with soft borders, rounded pills, Onest typography + JetBrains Mono details, ' +
  'subtle per-rubric textures (grid, dots, waves, rings). Clean, warm, product-grade.';

async function main() {
  console.log('[seed:publium] uploading templates from', TEMPLATES_DIR);

  // 0. Upload the Publium logo so previews render with the real brand mark
  //    (transparent PNG). Applied channels use their own logo at render time.
  const logoBuf = await fs.readFile(path.resolve(process.cwd(), 'scripts/assets/publium-logo.png'));
  const logoObj = await putObject('styles/publium/logo.png', logoBuf, { contentType: 'image/png' });
  console.log('[seed:publium] logo →', logoObj.url);

  // 1. Upload each HTML template → public URL.
  const templates: { name: string; url: string; demoSlots: Record<string, string> }[] = [];
  for (const tpl of TEMPLATES) {
    const buf = await fs.readFile(path.join(TEMPLATES_DIR, tpl.file));
    const obj = await putObject(`styles/publium/${tpl.file}`, buf, { contentType: 'text/html; charset=utf-8' });
    console.log(`[seed:publium]   ${tpl.file} → ${obj.url}`);
    templates.push({ name: tpl.name, url: obj.url, demoSlots: tpl.demoSlots });
  }

  // 1b. Carousel = a SET of slide templates: cover (intro) → item (repeated) →
  //     outro (ending). Hand-painted dot ornament, built by buildPubliumCarousel.ts.
  const uploadCar = async (file: string): Promise<string> => {
    const buf = await fs.readFile(path.join(TEMPLATES_DIR, file));
    const obj = await putObject(`styles/publium/${file}`, buf, { contentType: 'text/html; charset=utf-8' });
    console.log(`[seed:publium]   ${file} → ${obj.url}`);
    return obj.url;
  };
  const carouselTemplate: { cover: string; item: string; outro: string; previews?: string[] } = {
    cover: await uploadCar('car-cover.html'),
    item:  await uploadCar('car-item.html'),
    outro: await uploadCar('car-outro.html'),
  };

  // 2. Upsert the style (matched by slug).
  const baseData = {
    nameRu: 'Publium', nameEn: 'Publium',
    descRu: 'Фирменный стиль Publium для каналов проектов и брендов: 9 рубрик продуктового канала (апдейт, дроп, фича, розыгрыш, промокод, цифра, совет, анонс, вопрос). Тёмный премиум со стеклом и тёплым свечением — акцент тянется к цвету канала.',
    descEn: 'The Publium signature style for product and brand channels: 9 product-channel rubrics (update, drop, feature, giveaway, promo code, milestone, tip, teaser, question). Dark premium with glass and warm glow — the accent adapts to your channel color.',
    tags: ['продукт', 'бренд', 'signature', 'тёмный', 'glow'],
    priceKind: 'FREE',
    brandAdaptive: true,
    recommendedMode: 'html',
    palette: PALETTE,
    visualCoverStyle: VISUAL_COVER_STYLE,
    bgStyle: null, bgDetail: null, fontPreset: null, logoUsage: 'when_relevant',
    templates,
    carouselTemplate,
    // Витрина: фирменный пак Publium виден в маркете ВСЕМ, но применить его
    // может только админ (showcaseOnly). published:false — это не обычный
    // опубликованный стиль.
    published: false,
    showcaseOnly: true,
    sortOrder: 99,
  };

  const style = await prisma.style.upsert({
    where:  { slug: SLUG },
    update: baseData as never,
    create: { slug: SLUG, ...baseData } as never,
  });
  console.log('[seed:publium] style upserted:', style.id);

  // 3. Render a 1:1 demo preview per template (canvas is 1080×1080).
  const previews: string[] = [];
  for (const tpl of templates) {
    const url = await renderHtmlPreview({
      htmlTemplateUrl: tpl.url,
      brand:           { primaryColor: '#FF6A00', bgColor: '#070708', logoUrl: logoObj.url },
      slots:           tpl.demoSlots,
      aspectRatio:     '1:1',
    });
    if (url) { previews.push(url); console.log(`[seed:publium]   preview ${tpl.name} → ${url}`); }
    else console.warn(`[seed:publium]   preview FAILED for ${tpl.name}`);
  }

  if (previews.length > 0) {
    await prisma.style.update({ where: { id: style.id }, data: { previews, heroPreview: previews[0] } });
    console.log(`[seed:publium] saved ${previews.length} previews`);
  }

  // 4. Render a full carousel SEQUENCE (cover → items → outro) for the style card.
  const carBrand = { primaryColor: '#FF6A00', bgColor: '#0A0A0C', logoUrl: logoObj.url };
  const carSeq = [
    { url: carouselTemplate.cover, slots: { RUBRIC: 'О проекте', TITLE_WHITE: 'Контент. Комьюнити.', TITLE_ACCENT: 'Publium.', SUBTITLE: 'Контент, который работает на бренд. Комьюнити, которое остаётся. Publium связывает это в одну систему.' } },
    { url: carouselTemplate.item,  slots: { RUBRIC: 'О проекте', TITLE_WHITE: 'Идея', TITLE_ACCENT: '→ готовый пост', DESC: 'Отправьте идею, ссылку или текст — Publium соберёт публикацию: текст, структуру, обложку, CTA и оформление в стиле бренда.' } },
    { url: carouselTemplate.item,  slots: { RUBRIC: 'О проекте', TITLE_WHITE: 'В основе', TITLE_ACCENT: '— BrandKit', DESC: 'Запоминает tone of voice, стиль, цвета и правила — посты выглядят как часть настоящего бренда, а не случайная генерация.' } },
    { url: carouselTemplate.outro, slots: { RUBRIC: 'О проекте', TITLE_WHITE: 'Telegram сегодня.', TITLE_ACCENT: 'Дальше — везде', CTA: 'Подпишись', AUTHOR: '@publium' } },
  ];
  const carPreviews: string[] = [];
  for (const sl of carSeq) {
    const u = await renderHtmlPreview({ htmlTemplateUrl: sl.url, brand: carBrand, slots: sl.slots, aspectRatio: '1:1' });
    if (u) carPreviews.push(u);
  }
  if (carPreviews.length) {
    await prisma.style.update({ where: { id: style.id }, data: { carouselTemplate: { ...carouselTemplate, previews: carPreviews } as never } });
    console.log(`[seed:publium]   carousel previews → ${carPreviews.length}`);
  }

  console.log('[seed:publium] done ✓');
}

/** Releases everything that keeps the event loop alive, so the script exits.
 *  Without closing Chromium the seed finishes its work and then hangs forever —
 *  the command never returns and the browser sits on the box eating RAM. */
async function shutdown(): Promise<void> {
  await closeBrowser();
  await prisma.$disconnect().catch(() => {});
}

main()
  .then(async () => { await shutdown(); process.exit(0); })
  .catch(async (err) => {
    console.error('[seed:publium] FAILED:', err);
    await shutdown();
    process.exit(1);
  });
