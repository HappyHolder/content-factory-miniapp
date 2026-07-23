import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPreparedRichMessage, savePreparedPostMessage } from './telegramBot';

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
test('uploads a 4x4 gallery as multipart attachments', async () => {
  const originalFetch = globalThis.fetch;
  let telegramRequest: RequestInit | undefined;
  const urls = Array.from({ length: 16 }, (_, index) => `https://media.test/tile-${index}.png`);
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.startsWith('https://media.test/')) {
      return new Response(new Uint8Array(tinyPng), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }
    if (url.includes('/botTEST_TOKEN/savePreparedInlineMessage')) {
      telegramRequest = init;
      return new Response(JSON.stringify({
        ok: true,
        result: { id: 'prepared-id', expiration_date: 1234567890 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const html = `<tg-slideshow>${urls.map(url => `<img src="${url}">`).join('')}</tg-slideshow>`;
    const prepared = await savePreparedPostMessage({
      userId: 1,
      title: '4x4 gallery',
      html,
      token: 'TEST_TOKEN',
    });

    assert.equal(prepared.id, 'prepared-id');
    assert.ok(telegramRequest?.body instanceof FormData);
    const form = telegramRequest.body;
    const result = JSON.parse(String(form.get('result'))) as {
      input_message_content: { rich_message: { html: string; media: Array<{ media: { media: string } }> } };
    };
    const rich = result.input_message_content.rich_message;
    assert.equal(rich.media.length, 16);
    assert.equal(rich.media[0]?.media.media, 'attach://rich_media_1');
    assert.equal(rich.media[15]?.media.media, 'attach://rich_media_16');
    assert.match(rich.html, /tg:\/\/photo\?id=photo_16/);
    assert.ok(form.get('rich_media_1') instanceof Blob);
    assert.equal((form.get('rich_media_1') as Blob).type, 'image/jpeg');
    assert.ok(form.get('rich_media_16') instanceof Blob);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
