import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {
  buildPanoramaBrandStyle,
  buildPanoramaPrompt,
  buildPanoramaRatioGuide,
  buildPanoramaTextQaPrompt,
  getPanoramaGenerationPlan,
  normalizePanoramaSource,
  parsePanoramaTextScan,
  sliceImage,
} from './panoramaGenerator';

test('provider and canvas follow the selected part count', () => {
  for (let count = 2; count <= 8; count++) {
    for (const orientation of ['vertical', 'horizontal'] as const) {
      const plan = getPanoramaGenerationPlan(orientation, count);
      assert.equal(plan.provider, count <= 3 ? 'openai' : 'replicate');
      assert.equal(plan.aspectRatio, orientation === 'vertical' ? `1:${count}` : `${count}:1`);
      assert.equal(plan.targetWidth, orientation === 'vertical' ? 1080 : 1080 * count);
      assert.equal(plan.targetHeight, orientation === 'vertical' ? 1080 * count : 1080);
    }
  }

  assert.equal(getPanoramaGenerationPlan('vertical', 3).openAiSize, '1024x3072');
  assert.equal(getPanoramaGenerationPlan('horizontal', 3).openAiSize, '3072x1024');
  assert.equal(getPanoramaGenerationPlan('vertical', 4).replicateAspectRatio, '1:4');
  assert.equal(getPanoramaGenerationPlan('horizontal', 8).replicateAspectRatio, '8:1');
  assert.equal(getPanoramaGenerationPlan('vertical', 6).replicateAspectRatio, 'match_input_image');
  assert.equal(getPanoramaGenerationPlan('vertical', 6).needsRatioGuide, true);
});

test('regular panorama prompt cannot inherit headline or logo instructions', () => {
  const visualKit = {
    coverBgStyle: 'cinematic',
    coverBgDetail: 'detailed',
    visualCoverStyle: 'Пишем заголовок из текста новости прямо на изображении',
    logoUsage: 'always',
    brandColors: [{ hex: '#FF3C00', name: 'логотип', usage: 'писать название Vision' }],
    references: [{ description: 'large typography and a logo on the building' }],
  };

  const safeStyle = buildPanoramaBrandStyle(visualKit, true);
  assert.match(safeStyle, /cinematic film still/);
  assert.match(safeStyle, /#FF3C00/);
  assert.doesNotMatch(safeStyle, /заголовок|логотип|Vision|typography|logo/i);

  const prompt = buildPanoramaPrompt('Vision — дождь из долларов', 'vertical', 3, '1:3', visualKit);
  assert.match(prompt, /SUBJECT: Vision — дождь из долларов/);
  assert.doesNotMatch(prompt, /Пишем заголовок|писать название|large typography/i);
  assert.ok(prompt.lastIndexOf('FINAL NON-NEGOTIABLE OUTPUT RULES') > prompt.lastIndexOf('SUBJECT:'));
  assert.ok(prompt.lastIndexOf('If the user explicitly requests a visible headline') > prompt.lastIndexOf('SUBJECT:'));
});

test('explicit user text and logo requests remain allowed and exclusive', () => {
  const prompt = buildPanoramaPrompt(
    'Ночной город, на здании крупная вывеска «VISION», рядом логотип проекта',
    'vertical',
    3,
    '1:3',
  );
  assert.match(prompt, /render exactly that requested element/i);
  assert.match(prompt, /no additional designed text or branding/i);
  assert.doesNotMatch(prompt, /Render absolutely no text/i);
});

test('strict normalization rejects a 1:4 image requested as three square parts', async () => {
  const wrong = await sharp({
    create: { width: 128, height: 512, channels: 3, background: '#111111' },
  }).png().toBuffer();
  await assert.rejects(
    normalizePanoramaSource(wrong, 'vertical', 3, 32, true),
    /ratio mismatch/,
  );
});

test('text QA is fail-closed and preserves the detected writing', () => {
  assert.deepEqual(parsePanoramaTextScan('{"has_text":false,"detected_text":""}'), {
    checked: true, hasText: false, detectedText: '',
  });
  assert.deepEqual(parsePanoramaTextScan('```json\n{"has_text":true,"detected_text":"Vision"}\n```'), {
    checked: true, hasText: true, detectedText: 'Vision',
  });
  assert.equal(parsePanoramaTextScan('not json').checked, false);
  assert.equal(parsePanoramaTextScan(null).checked, false);
});

test('text QA evaluates designed text against the original user request', () => {
  const ordinary = buildPanoramaTextQaPrompt('Ночной город и дождь из долларов', {
    visibleTextRequested: false, logoRequested: false, exactTexts: [], requestSummary: 'No visible text requested.',
  });
  assert.match(ordinary, /USER REQUEST JSON: "Ночной город и дождь из долларов"/);
  assert.match(ordinary, /currency denominations and banknote microprint/);
  assert.match(ordinary, /did not explicitly ask to show/);

  const requested = buildPanoramaTextQaPrompt('Добавь заголовок «VISION» и логотип', {
    visibleTextRequested: true, logoRequested: true, exactTexts: ['VISION'], requestSummary: 'Visible title and logo requested.',
  });
  assert.match(requested, /USER REQUEST JSON: "Добавь заголовок «VISION» и логотип"/);
  assert.match(requested, /SERVER-RESOLVED TEXT PERMISSION/);
  assert.match(requested, /"exactTexts":\["VISION"\]/);
  assert.match(requested, /server-resolved permission is authoritative/);
  assert.match(requested, /explicitly asks for visible text/);
  assert.match(requested, /Never label an exact requested word or logo as unrequested/);
  assert.match(requested, /materially misspelled/);
});

test('all linear modes produce exact square tiles', async () => {
  for (let count = 2; count <= 8; count++) {
    for (const orientation of ['vertical', 'horizontal'] as const) {
      const width = orientation === 'vertical' ? 20 : 20 * count;
      const height = orientation === 'vertical' ? 20 * count : 20;
      const source = await sharp({
        create: { width, height, channels: 3, background: '#FF3C00' },
      }).png().toBuffer();
      const normalized = await normalizePanoramaSource(source, orientation, count, 24, true);
      const normalizedMeta = await sharp(normalized).metadata();
      assert.equal(normalizedMeta.width, orientation === 'vertical' ? 24 : 24 * count);
      assert.equal(normalizedMeta.height, orientation === 'vertical' ? 24 * count : 24);

      const parts = await sliceImage(normalized, orientation, count, 24);
      assert.equal(parts.length, count);
      for (const part of parts) {
        const meta = await sharp(part).metadata();
        assert.equal(meta.width, 24);
        assert.equal(meta.height, 24);
      }
    }
  }
});

test('Replicate ratio guide matches counts without native aspect-ratio values', async () => {
  for (const count of [5, 6, 7]) {
    const vertical = await sharp(await buildPanoramaRatioGuide('vertical', count, 32)).metadata();
    assert.equal(vertical.width, 32);
    assert.equal(vertical.height, 32 * count);
    const horizontal = await sharp(await buildPanoramaRatioGuide('horizontal', count, 32)).metadata();
    assert.equal(horizontal.width, 32 * count);
    assert.equal(horizontal.height, 32);
  }
});
