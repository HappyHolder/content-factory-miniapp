import dotenv from 'dotenv';
import path from 'path';

// Load .env relative to the server/ working directory
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `[env] Missing required environment variable: ${key}\n` +
        `      Copy server/.env.example to server/.env and fill in the values.`
    );
  }
  return value;
}

const AI_PROVIDER = (process.env['AI_PROVIDER'] ?? 'placeholder') as 'placeholder' | 'deepseek';

// DEEPSEEK_API_KEY is only required when the provider is explicitly set to deepseek.
// This lets the server start without an AI key in placeholder / dev mode.
if (AI_PROVIDER === 'deepseek' && !process.env['DEEPSEEK_API_KEY']) {
  throw new Error(
    '[env] DEEPSEEK_API_KEY is required when AI_PROVIDER=deepseek.\n' +
    '      Set it in server/.env or in your Render environment variables.'
  );
}

const IMAGE_PROVIDER = (process.env['IMAGE_PROVIDER'] ?? 'none') as 'none' | 'replicate';

// Comma-separated Telegram numeric IDs allowed to access the admin panel.
// Example: ADMIN_TELEGRAM_IDS=123456789,987654321
const ADMIN_TELEGRAM_IDS = (process.env['ADMIN_TELEGRAM_IDS'] ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export const env = {
  DATABASE_URL:              requireEnv('DATABASE_URL'),
  DIRECT_URL:                requireEnv('DIRECT_URL'),
  TELEGRAM_BOT_TOKEN:        requireEnv('TELEGRAM_BOT_TOKEN'),
  TELEGRAM_WEBHOOK_SECRET:   requireEnv('TELEGRAM_WEBHOOK_SECRET'),
  PORT: parseInt(process.env['PORT'] ?? '8787', 10),
  NODE_ENV: (process.env['NODE_ENV'] ?? 'development') as
    | 'development'
    | 'production'
    | 'test',
  AI_PROVIDER,
  DEEPSEEK_API_KEY:  process.env['DEEPSEEK_API_KEY']  ?? '',
  DEEPSEEK_BASE_URL: process.env['DEEPSEEK_BASE_URL'] ?? 'https://api.deepseek.com',
  DEEPSEEK_MODEL:    process.env['DEEPSEEK_MODEL']    ?? 'deepseek-chat',
  // Image generation — all optional; server starts fine if absent
  IMAGE_PROVIDER,
  IMAGE_MODEL:                       process.env['IMAGE_MODEL']                       ?? 'black-forest-labs/flux-schnell',
  // Vision model (on Replicate) used to read incoming photos in the bot.
  // Reuses REPLICATE_API_TOKEN — no separate provider/key needed.
  VISION_MODEL:                      process.env['VISION_MODEL']                      ?? 'openai/gpt-4o-mini',
  REPLICATE_API_TOKEN:               process.env['REPLICATE_API_TOKEN']               ?? '',
  // How long to wait for a Replicate prediction to finish (ms).
  // Imagen 4 typically takes 30–90 s on Replicate.
  // Set higher than your HTTP gateway timeout if you want to see the result;
  // keep lower if you prefer a fast explicit failure over a gateway 502.
  // Default: 120 000 ms (2 min). Override via IMAGE_GENERATION_POLL_TIMEOUT_MS.
  // Vercel Blob — optional; upload endpoint returns 503 if absent
  BLOB_READ_WRITE_TOKEN: process.env['BLOB_READ_WRITE_TOKEN'] ?? '',
  IMAGE_GENERATION_POLL_TIMEOUT_MS:
    parseInt(process.env['IMAGE_GENERATION_POLL_TIMEOUT_MS'] ?? '300000', 10),
  ADMIN_TELEGRAM_IDS,
  // Optional: Mini App URL for the /start "Open app" button. If unset, the
  // welcome is sent without a button (users tap the bot's menu button instead).
  MINI_APP_URL: process.env['MINI_APP_URL'] ?? '',
  // TON payments
  TON_RECEIVING_WALLET: process.env['TON_RECEIVING_WALLET'] ?? '',
  TONCENTER_API_KEY:    process.env['TONCENTER_API_KEY']    ?? '',
  // Web search for the AI assistant (Tavily). Optional — search is disabled if absent.
  TAVILY_API_KEY:       process.env['TAVILY_API_KEY']       ?? '',
  // Replicate text model for AI-generated HTML covers in user's brand style.
  // Must support system_prompt + prompt input schema (e.g. Llama 3.1 instruct).
  COVER_HTML_MODEL: process.env['COVER_HTML_MODEL'] ?? 'meta/meta-llama-3.1-70b-instruct',
  // Cover generation engine:
  //   'template' — always use HTML/Satori templates (free, instant, brand-perfect)
  //   'flux'     — always use Flux via Replicate (AI-generated artistic images)
  //   'auto'     — use template when brand kit is complete, fall back to flux
  COVER_ENGINE: (process.env['COVER_ENGINE'] ?? 'auto') as 'template' | 'flux' | 'auto',
} as const;
