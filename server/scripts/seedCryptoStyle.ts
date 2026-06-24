/**
 * seedCryptoStyle.ts
 *
 * Seeds the FREE "Crypto" cover-style pack into the Styles market:
 *   1. uploads the 9 crypto HTML templates to storage,
 *   2. upserts the published Style (slug "crypto") with palette + demo slots,
 *   3. renders a 1:1 demo preview for each template and saves them on the style.
 *
 * Idempotent — re-running updates the same style (matched by slug).
 * Run inside the api container:  npx tsx scripts/seedCryptoStyle.ts
 */

import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../src/db';
import { putObject } from '../src/lib/storage';
import { renderHtmlPreview } from '../src/lib/playwrightRenderer';

const SLUG = 'crypto';
const TEMPLATES_DIR = path.resolve(process.cwd(), 'scripts/crypto-templates');

// rubric label (AI matches by this) → file + demo slot values for the preview.
const TEMPLATES: { name: string; file: string; demoSlots: Record<string, string> }[] = [
  { name: 'Новости', file: '01-news.html', demoSlots: {
    BRAND: 'PUBLIUM', RUBRIC: 'Новости',
    TITLE_WHITE: 'Bitcoin обновил', TITLE_ACCENT: 'исторический максимум',
    LEAD: 'Цена впервые превысила $100K на фоне рекордного притока в спотовые ETF',
    STAT1_VAL: '$100K', STAT1_LABEL: 'цена BTC', STAT2_VAL: '+8.4%', STAT2_LABEL: 'за сутки',
    TAG1: '#bitcoin', TAG2: '#ETF', TAG3: '#ATH', HANDLE: '@publium' } },
  { name: 'Сигнал', file: '02-signal.html', demoSlots: {
    BRAND: 'PUBLIUM', RUBRIC: 'Сигнал', TICKER: 'SOL', SIDE: 'LONG',
    ENTRY: '$182', TARGET: '$210', STOP: '$168',
    TAG1: '#solana', TAG2: '#signal', TAG3: '#spot', HANDLE: '@publium' } },
  { name: 'Листинг', file: '03-listing.html', demoSlots: {
    BRAND: 'PUBLIUM', DATE: '12 июня', RUBRIC: 'Листинг', BADGE: 'NEW',
    PROJECT: 'Monad', SUBTITLE: 'Старт торгов на Binance — пара MON/USDT уже доступна',
    TAG1: '#listing', TAG2: '#binance', TAG3: '#monad', HANDLE: '@publium' } },
  { name: 'Мнение', file: '04-opinion.html', demoSlots: {
    BRAND: 'PUBLIUM', RUBRIC: 'Мнение',
    QUOTE_WHITE: 'Альтсезон начнётся', QUOTE_ACCENT: 'когда BTC.D развернётся',
    AUTHOR_NAME: 'Артём Криптов', AUTHOR_ROLE: 'аналитик Publium',
    TAG1: '#altseason', TAG2: '#opinion', TAG3: '#btcd', HANDLE: '@publium' } },
  { name: 'Аналитика', file: '05-analysis.html', demoSlots: {
    BRAND: 'PUBLIUM', RUBRIC: 'Аналитика', SECTION: 'Ethereum',
    TITLE_WHITE: 'ETH тестирует', TITLE_ACCENT: 'ключевое сопротивление',
    SUPPORT: '$3 400', RESIST: '$3 950', TARGET: '$4 500',
    TAG1: '#ethereum', TAG2: '#TA', TAG3: '#levels', HANDLE: '@publium' } },
  { name: 'Дайджест', file: '06-recap.html', demoSlots: {
    BRAND: 'PUBLIUM', RUBRIC: 'Дайджест', HEAD_WHITE: 'Движения дня', HEAD_ACCENT: 'топ-4',
    TK1: 'BTC', PC1: '+5.2%', TK2: 'SOL', PC2: '+9.1%',
    TK3: 'ETH', PC3: '-1.4%', TK4: 'DOGE', PC4: '-3.7%',
    TAG1: '#recap', TAG2: '#market', TAG3: '#daily', HANDLE: '@publium' } },
  { name: 'Гайд', file: '07-guide.html', demoSlots: {
    BRAND: 'PUBLIUM', RUBRIC: 'Гайд', STEPLABEL: 'Шаг 1 из 3',
    TITLE_WHITE: 'Как завести', TITLE_ACCENT: 'кошелёк за 5 минут',
    LEAD: 'Пошаговая инструкция для новичков: от установки до первой транзакции',
    TAG1: '#guide', TAG2: '#wallet', TAG3: '#newbie', HANDLE: '@publium' } },
  { name: 'Топ', file: '08-top.html', demoSlots: {
    BRAND: 'PUBLIUM', RUBRIC: 'Топ', HEAD_WHITE: 'Лучшие монеты', HEAD_ACCENT: 'недели',
    NAME1: 'Solana', VAL1: '+24%', NAME2: 'Sui', VAL2: '+19%', NAME3: 'Aptos', VAL3: '+15%',
    NAME4: 'Render', VAL4: '+12%', NAME5: 'Injective', VAL5: '+9%',
    TAG1: '#top', TAG2: '#gainers', TAG3: '#weekly', HANDLE: '@publium' } },
  { name: 'Партнёрство', file: '09-partner.html', demoSlots: {
    BRAND: 'PUBLIUM', RUBRIC: 'Партнёрство', PARTNER: 'TON', PROJECT: 'Publium',
    SUBTITLE: 'Запускаем совместную образовательную программу для крипто-авторов',
    TAG1: '#partnership', TAG2: '#TON', TAG3: '#publium', HANDLE: '@publium' } },
];

const PALETTE = [
  { name: 'Акцент', hex: '#FF5422', usage: 'Основной акцентный цвет (тянется к цвету канала)' },
  { name: 'Фон',    hex: '#0B0B0C', usage: 'Тёмный фон обложки' },
];

const VISUAL_COVER_STYLE =
  'Dark crypto editorial style on a near-black background (#0B0B0C) with a single brand accent ' +
  '(#FF5422, adapts to the channel color). Space Grotesk typography, pill-shaped navbar and rubric tags, ' +
  'a soft radial "planet" glow, concentric rings, and clean card blocks. Minimal, premium, high-contrast.';

async function main() {
  console.log('[seed:crypto] uploading templates from', TEMPLATES_DIR);

  // 1. Upload each HTML template → public URL.
  const templates: { name: string; url: string; demoSlots: Record<string, string> }[] = [];
  for (const tpl of TEMPLATES) {
    const buf = await fs.readFile(path.join(TEMPLATES_DIR, tpl.file));
    const obj = await putObject(`styles/crypto/${tpl.file}`, buf, { contentType: 'text/html; charset=utf-8' });
    console.log(`[seed:crypto]   ${tpl.file} → ${obj.url}`);
    templates.push({ name: tpl.name, url: obj.url, demoSlots: tpl.demoSlots });
  }

  // 2. Upsert the style (matched by slug).
  const baseData = {
    nameRu: 'Крипта', nameEn: 'Crypto',
    descRu: 'Тёмный редакционный стиль для крипто-каналов: 9 шаблонов по рубрикам (новости, сигнал, листинг, мнение, аналитика, дайджест, гайд, топ, партнёрство). Тянет акцентный цвет канала.',
    descEn: 'A dark editorial style for crypto channels: 9 rubric templates (news, signal, listing, opinion, analysis, recap, guide, top, partnership). Adapts to your channel accent color.',
    tags: ['крипта', 'crypto', 'тёмный', 'editorial'],
    priceKind: 'FREE',
    brandAdaptive: true,
    recommendedMode: 'html',
    palette: PALETTE,
    visualCoverStyle: VISUAL_COVER_STYLE,
    bgStyle: null, bgDetail: null, fontPreset: null, logoUsage: 'when_relevant',
    templates,
    published: true,
    sortOrder: 0,
  };

  const style = await prisma.style.upsert({
    where:  { slug: SLUG },
    update: baseData as never,
    create: { slug: SLUG, ...baseData } as never,
  });
  console.log('[seed:crypto] style upserted:', style.id);

  // 3. Render a 1:1 demo preview per template (canvas is 1080×1080).
  const previews: string[] = [];
  for (const tpl of templates) {
    const url = await renderHtmlPreview({
      htmlTemplateUrl: tpl.url,
      brand:           { primaryColor: '#FF5422', bgColor: '#0B0B0C', logoUrl: null },
      slots:           tpl.demoSlots,
      aspectRatio:     '1:1',
    });
    if (url) { previews.push(url); console.log(`[seed:crypto]   preview ${tpl.name} → ${url}`); }
    else console.warn(`[seed:crypto]   preview FAILED for ${tpl.name}`);
  }

  if (previews.length > 0) {
    await prisma.style.update({ where: { id: style.id }, data: { previews, heroPreview: previews[0] } });
    console.log(`[seed:crypto] saved ${previews.length} previews`);
  }

  console.log('[seed:crypto] done ✓');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[seed:crypto] FAILED:', err);
  await prisma.$disconnect();
  process.exit(1);
});
