/**
 * visionExtractor.ts
 *
 * Reads a photo sent to the bot: downloads it from Telegram, sends it to a
 * vision model on Replicate (VISION_MODEL, default openai/gpt-4o-mini) and
 * returns a faithful text description / transcription. That text then feeds the
 * normal generation pipeline (which applies the channel style via DeepSeek),
 * exactly like the link-content extractor.
 *
 * Reuses REPLICATE_API_TOKEN — no separate provider/key. Never throws; returns
 * null on any failure so the caller can fall back to the message caption.
 */

import { env } from '../env';
import { getFilePath } from './telegramBot';

const REPLICATE_API = 'https://api.replicate.com/v1';
const POLL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;
const MAX_OUT_CHARS = 3_000;

const EXTRACT_PROMPT =
  'Извлеки содержимое этого изображения для создания поста в Telegram-канал. ' +
  'Если на картинке есть текст — приведи его дословно. Опиши ключевые объекты, ' +
  'числа, бренды, что происходит. Не придумывай того, чего нет на изображении. ' +
  'Ответь связным текстом на языке текста с картинки (по умолчанию русский). ' +
  'Без вступлений вроде «на изображении» — сразу содержание.';

interface ReplicatePrediction {
  id:     string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output: unknown;
  error:  string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Joins a language-model output (string | string[] of token chunks) into text. */
function outputToText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.filter(x => typeof x === 'string').join('');
  return '';
}

/** Downloads the Telegram file bytes for a file_id. */
async function downloadTelegramFile(fileId: string): Promise<{ buf: Buffer; mime: string }> {
  const filePath = await getFilePath(fileId, env.TELEGRAM_BOT_TOKEN);
  const url = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Telegram file download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = (filePath.split('.').pop() ?? 'jpg').toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return { buf, mime };
}

/**
 * Reads an image (by Telegram file_id) and returns extracted text, or null on
 * failure / when image reading isn't configured.
 */
export async function extractImageContent(fileId: string): Promise<string | null> {
  if (!env.REPLICATE_API_TOKEN || !env.VISION_MODEL) return null;

  try {
    const { buf, mime } = await downloadTelegramFile(fileId);
    const dataUri = `data:${mime};base64,${buf.toString('base64')}`;

    // Create prediction
    const createRes = await fetch(`${REPLICATE_API}/models/${env.VISION_MODEL}/predictions`, {
      method:  'POST',
      headers: {
        'Authorization': `Token ${env.REPLICATE_API_TOKEN}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        input: {
          prompt:                EXTRACT_PROMPT,
          image_input:           [dataUri],
          max_completion_tokens: 800,
        },
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text().catch(() => '');
      console.warn(`[visionExtractor] create failed HTTP ${createRes.status}: ${errText.slice(0, 300)}`);
      return null;
    }

    let prediction = await createRes.json() as ReplicatePrediction;

    // Poll until done
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (
      (prediction.status === 'starting' || prediction.status === 'processing') &&
      Date.now() < deadline
    ) {
      await sleep(POLL_INTERVAL_MS);
      const pollRes = await fetch(`${REPLICATE_API}/predictions/${prediction.id}`, {
        headers: { 'Authorization': `Token ${env.REPLICATE_API_TOKEN}` },
      });
      if (!pollRes.ok) { console.warn(`[visionExtractor] poll HTTP ${pollRes.status}`); return null; }
      prediction = await pollRes.json() as ReplicatePrediction;
    }

    if (prediction.status !== 'succeeded') {
      console.warn(`[visionExtractor] prediction status=${prediction.status} error=${prediction.error ?? ''}`);
      return null;
    }

    const text = outputToText(prediction.output).trim().slice(0, MAX_OUT_CHARS);
    return text || null;
  } catch (err) {
    console.warn('[visionExtractor] failed:', (err as Error).message);
    return null;
  }
}
