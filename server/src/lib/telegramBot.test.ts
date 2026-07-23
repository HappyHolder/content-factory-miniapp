import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPreparedRichMessage } from './telegramBot';

test('moves external photos into InputRichMessage.media', () => {
  const result = buildPreparedRichMessage(
    '<h3>Title</h3>\n<tg-slideshow><img src="https://publium.ru/a.png?x=1&amp;y=2"><img src="https://publium.ru/b.png"></tg-slideshow>',
  );

  assert.equal(
    result.html,
    '<h3>Title</h3>\n<tg-slideshow><img src="tg://photo?id=photo_1"><img src="tg://photo?id=photo_2"></tg-slideshow>',
  );
  assert.deepEqual(result.media, [
    { id: 'photo_1', media: { type: 'photo', media: 'https://publium.ru/a.png?x=1&y=2' } },
    { id: 'photo_2', media: { type: 'photo', media: 'https://publium.ru/b.png' } },
  ]);
});

test('moves external video into media and removes its external poster', () => {
  const result = buildPreparedRichMessage(
    '<video src="https://publium.ru/video.mp4" poster="https://publium.ru/poster.jpg"></video>',
  );

  assert.equal(result.html, '<video src="tg://video?id=video_1"></video>');
  assert.deepEqual(result.media, [
    { id: 'video_1', media: { type: 'video', media: 'https://publium.ru/video.mp4' } },
  ]);
});

test('leaves text-only Rich HTML unchanged', () => {
  assert.deepEqual(buildPreparedRichMessage('<p>Hello</p>'), { html: '<p>Hello</p>' });
});
