import assert from 'node:assert/strict';
import test from 'node:test';

process.env['OPENAI_API_KEY'] = 'sk-test';
process.env['OPENAI_IMAGE_MODEL'] = 'gpt-image-2';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { openAiImage } = require('./openaiImage') as typeof import('./openaiImage');

test('direct OpenAI image call carries an exact panorama size', async () => {
  let body: Record<string, unknown> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (_url: string, init: { body?: string }) => {
    body = JSON.parse(init.body ?? '{}');
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: Buffer.from('image').toString('base64') }] }),
    };
  };

  const result = await openAiImage({
    prompt: 'one seamless text-free scene',
    size: '1024x3072',
    quality: 'medium',
  });
  assert.ok(result);
  assert.equal(body?.['model'], 'gpt-image-2');
  assert.equal(body?.['size'], '1024x3072');
});
