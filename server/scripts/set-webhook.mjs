// Sets (or inspects) the Telegram webhook with the correct secret and
// allowed_updates. Run after any change to the deployed URL or the secret so the
// config never drifts from what the backend verifies.
//
//   npm run set-webhook          → set the webhook (reads .env)
//   npm run set-webhook -- info  → only print current getWebhookInfo (no change)
//
// Required env (server/.env, must match the Render environment):
//   TELEGRAM_BOT_TOKEN
//   TELEGRAM_WEBHOOK_SECRET   ← must equal the value set on Render
// Optional:
//   WEBHOOK_URL               ← defaults to the production Render URL below
//
// IMPORTANT: allowed_updates MUST include "pre_checkout_query", otherwise
// Telegram never delivers the pre-checkout and Stars payments hang forever.

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const TG_API = 'https://api.telegram.org';
const DEFAULT_URL = 'https://content-factory-api.onrender.com/api/bot/webhook';
const ALLOWED_UPDATES = ['message', 'pre_checkout_query'];

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('✗ TELEGRAM_BOT_TOKEN is missing in server/.env');
  process.exit(1);
}

function maskUrl(url) {
  return url.replace(/\/bot[^/]+\//, '/bot***/');
}

async function call(method, body) {
  let res;
  try {
    res = await fetch(`${TG_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch (err) {
    throw new Error(`Network error reaching Telegram (${method}): ${err.cause?.message ?? err.message}`);
  }
  const json = await res.json();
  if (!json.ok) throw new Error(`${method} failed: ${json.description ?? 'unknown error'}`);
  return json.result;
}

async function printInfo() {
  const info = await call('getWebhookInfo');
  console.log('Current webhook:');
  console.log('  url:                  ', info.url || '(none)');
  console.log('  allowed_updates:      ', JSON.stringify(info.allowed_updates ?? '(all)'));
  console.log('  pending_update_count: ', info.pending_update_count);
  console.log('  ip_address:           ', info.ip_address ?? '(none)');
  if (info.last_error_date) {
    console.log('  last_error:           ', new Date(info.last_error_date * 1000).toISOString(), '-', info.last_error_message);
  } else {
    console.log('  last_error:            none');
  }
  const hasPreCheckout = Array.isArray(info.allowed_updates) && info.allowed_updates.includes('pre_checkout_query');
  console.log(hasPreCheckout ? '  ✓ pre_checkout_query is enabled (Stars will work)' : '  ✗ pre_checkout_query is MISSING — Stars payments will hang');
}

async function main() {
  const infoOnly = process.argv.slice(2).includes('info');

  if (infoOnly) {
    await printInfo();
    return;
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.error('✗ TELEGRAM_WEBHOOK_SECRET is missing in server/.env.');
    console.error('  It MUST match the value set in the Render environment, or the');
    console.error('  backend will reject every webhook delivery with 401.');
    process.exit(1);
  }

  const url = process.env.WEBHOOK_URL || DEFAULT_URL;

  console.log('Setting webhook…');
  console.log('  url:            ', maskUrl(url));
  console.log('  allowed_updates:', JSON.stringify(ALLOWED_UPDATES));

  await call('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ALLOWED_UPDATES,
  });

  console.log('✓ setWebhook ok\n');
  await printInfo();
}

main().catch(err => {
  console.error('✗', err.message);
  process.exit(1);
});
