/**
 * voiceTranscriber.ts
 *
 * Speech-to-text for the assistant's voice input. Direct OpenAI
 * /v1/audio/transcriptions with OPENAI_TRANSCRIBE_MODEL — one multipart upload,
 * no prediction to create and poll. Never throws; returns null on any failure so
 * the caller degrades to "couldn't recognise".
 *
 * Replaces openai/whisper on Replicate. Note the model change: whisper-1 (v2)
 * invents words on near-silent audio — verified, it returned "you" for 200 ms of
 * silence — while gpt-4o-mini-transcribe returns an empty string. Set
 * OPENAI_TRANSCRIBE_MODEL=whisper-1 to go back.
 */

import { env } from '../env';

const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MAX_OUT_CHARS = 4_000;
const TIMEOUT_MS = 60_000;

/** Splits `data:audio/ogg;base64,AAAA` into its mime type and bytes. */
function parseDataUri(dataUri: string): { buf: Buffer; mime: string } | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUri);
  if (!match) return null;
  const mime = match[1] || 'audio/ogg';
  const payload = match[3] ?? '';
  const buf = match[2] ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
  return buf.length ? { buf, mime } : null;
}

/** The API picks its decoder by file extension, so the name must match the mime. */
function filenameFor(mime: string): string {
  const subtype = mime.split('/')[1]?.split(';')[0]?.toLowerCase() ?? 'ogg';
  const known: Record<string, string> = {
    ogg: 'ogg', opus: 'ogg', oga: 'ogg', mpeg: 'mp3', mp3: 'mp3', mp4: 'mp4',
    m4a: 'm4a', 'x-m4a': 'm4a', wav: 'wav', 'x-wav': 'wav', webm: 'webm', flac: 'flac',
  };
  return 'audio.' + (known[subtype] ?? 'ogg');
}

/**
 * Transcribes an audio buffer. `dataUri` must be a `data:audio/...;base64,` URI.
 * Returns the recognised text, or null on failure / when not configured.
 */
export async function transcribeAudio(dataUri: string): Promise<string | null> {
  if (!env.OPENAI_API_KEY) return null;
  const parsed = parseDataUri(dataUri);
  if (!parsed) { console.warn('[voiceTranscriber] not a usable data URI'); return null; }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(parsed.buf)], { type: parsed.mime }), filenameFor(parsed.mime));
    form.append('model', env.OPENAI_TRANSCRIBE_MODEL);
    form.append('response_format', 'json');

    const res = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[voiceTranscriber] HTTP ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const data = await res.json() as { text?: unknown };
    const text = typeof data.text === 'string' ? data.text.trim().slice(0, MAX_OUT_CHARS) : '';
    return text || null;
  } catch (err) {
    console.warn('[voiceTranscriber] failed:', (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
