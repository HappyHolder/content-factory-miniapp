/**
 * voiceTranscriber.ts
 *
 * Speech-to-text for the assistant's voice input: sends recorded audio to a
 * Whisper model on Replicate (WHISPER_MODEL) and returns the transcript. Reuses
 * REPLICATE_API_TOKEN — no separate provider. Never throws; returns null on any
 * failure so the caller degrades to "couldn't recognise".
 */

import { env } from '../env';

const REPLICATE_API = 'https://api.replicate.com/v1';
const POLL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_500;
const MAX_OUT_CHARS = 4_000;

interface ReplicatePrediction {
  id:     string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output: unknown;
  error:  string | null;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Whisper output can be a string, {text}, or {transcription}. Normalise it. */
function outputToText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.filter(x => typeof x === 'string').join(' ');
  if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>;
    if (typeof o['text'] === 'string') return o['text'];
    if (typeof o['transcription'] === 'string') return o['transcription'];
  }
  return '';
}

/**
 * Transcribes an audio buffer. `dataUri` must be a `data:audio/...;base64,` URI.
 * Returns the recognised text, or null on failure / when not configured.
 */
export async function transcribeAudio(dataUri: string): Promise<string | null> {
  if (!env.REPLICATE_API_TOKEN || !env.WHISPER_MODEL) return null;
  try {
    const createRes = await fetch(`${REPLICATE_API}/models/${env.WHISPER_MODEL}/predictions`, {
      method:  'POST',
      headers: { 'Authorization': `Token ${env.REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json' },
      // `audio` is the input field both openai/whisper and fast-whisper accept.
      body: JSON.stringify({ input: { audio: dataUri } }),
    });
    if (!createRes.ok) {
      const t = await createRes.text().catch(() => '');
      console.warn(`[voiceTranscriber] create HTTP ${createRes.status}: ${t.slice(0, 200)}`);
      return null;
    }
    let prediction = await createRes.json() as ReplicatePrediction;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while ((prediction.status === 'starting' || prediction.status === 'processing') && Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const pollRes = await fetch(`${REPLICATE_API}/predictions/${prediction.id}`, {
        headers: { 'Authorization': `Token ${env.REPLICATE_API_TOKEN}` },
      });
      if (!pollRes.ok) return null;
      prediction = await pollRes.json() as ReplicatePrediction;
    }
    if (prediction.status !== 'succeeded') {
      console.warn(`[voiceTranscriber] status=${prediction.status} error=${prediction.error ?? ''}`);
      return null;
    }
    const text = outputToText(prediction.output).trim().slice(0, MAX_OUT_CHARS);
    return text || null;
  } catch (err) {
    console.warn('[voiceTranscriber] failed:', (err as Error).message);
    return null;
  }
}
