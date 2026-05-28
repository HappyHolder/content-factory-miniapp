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
} as const;
