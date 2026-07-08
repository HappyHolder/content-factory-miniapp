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
    '      Set it in server/.env (dev) or deploy/.env (the Docker stack).'
  );
}

const IMAGE_PROVIDER = (process.env['IMAGE_PROVIDER'] ?? 'none') as 'none' | 'replicate';

// Deep-research backend for the AI content manager. 'opus' uses the Anthropic
// SDK with native web_search/web_fetch server tools (needs ANTHROPIC_API_KEY);
// 'deepseek' falls back to the existing Serper/Tavily + fetchArticle pipeline.
// Defaults to 'opus' when a key is present, otherwise 'deepseek'.
const CONTENT_RESEARCH_BACKEND = (
  process.env['CONTENT_RESEARCH_BACKEND'] ??
  (process.env['ANTHROPIC_API_KEY'] ? 'opus' : 'deepseek')
) as 'opus' | 'deepseek';

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
  // Local filesystem object storage (replaces Vercel Blob).
  // STORAGE_DIR: where uploaded/generated files are written (a Docker volume in
  // prod). PUBLIC_BASE_URL: the public origin those files are served from, used
  // to build the URLs stored in the DB and sent to Telegram — set it to the real
  // https://<domain> in production.
  STORAGE_DIR:     process.env['STORAGE_DIR']     ?? path.resolve(process.cwd(), 'uploads'),
  PUBLIC_BASE_URL: (process.env['PUBLIC_BASE_URL'] ?? 'http://localhost:8787').replace(/\/+$/, ''),
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
  // Sonnet (not Haiku): strong enough to genuinely re-compose a fresh layout per
  // post from the CSS design system, instead of cloning the reference structure.
  COVER_HTML_MODEL: process.env['COVER_HTML_MODEL'] ?? 'anthropic/claude-4.5-sonnet',
  // ── HIGH (premium) model variant — used when a subscription's modelTier=HIGH.
  // Post text goes to Claude on Replicate; covers to GPT Image on Replicate.
  // LOW keeps DeepSeek (text) + IMAGE_MODEL/Flux (covers). See docs/low-high-plan.md.
  HIGH_TEXT_MODEL:  process.env['HIGH_TEXT_MODEL']  ?? 'anthropic/claude-4.5-sonnet',
  HIGH_IMAGE_MODEL: process.env['HIGH_IMAGE_MODEL'] ?? 'openai/gpt-image-2',
  // Cover generation engine:
  //   'template' — always use HTML/Satori templates (free, instant, brand-perfect)
  //   'flux'     — always use Flux via Replicate (AI-generated artistic images)
  //   'auto'     — use template when brand kit is complete, fall back to flux
  COVER_ENGINE: (process.env['COVER_ENGINE'] ?? 'auto') as 'template' | 'flux' | 'auto',
  // ── AI content manager (deep research + post synthesis on Opus) ──────────────
  // ANTHROPIC_API_KEY unlocks the Anthropic SDK path (Opus 4.8 + native web
  // search/fetch). Optional — the engine falls back to DeepSeek/Serper without it.
  ANTHROPIC_API_KEY:       process.env['ANTHROPIC_API_KEY']       ?? '',
  CONTENT_RESEARCH_MODEL:  process.env['CONTENT_RESEARCH_MODEL']  ?? 'claude-opus-4-8',
  CONTENT_RESEARCH_BACKEND,
} as const;
