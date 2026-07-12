import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const token = process.env.MODERATOR_BOT_TOKEN;
const secret = process.env.MODERATOR_WEBHOOK_SECRET;
const url = process.env.MODERATOR_WEBHOOK_URL || 'https://publium.ru/api/moderator/webhook';
const allowed_updates = ['message', 'my_chat_member', 'callback_query'];
if (!token || !secret) throw new Error('MODERATOR_BOT_TOKEN and MODERATOR_WEBHOOK_SECRET are required');

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url, secret_token: secret, allowed_updates }),
});
const body = await response.json();
if (!body.ok) throw new Error(body.description ?? 'setWebhook failed');
console.log('Moderator webhook configured:', url, JSON.stringify(allowed_updates));
