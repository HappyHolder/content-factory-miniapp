import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import {
  getChat,
  getChatMember,
  getBotIdFromToken,
  TelegramApiError,
} from '../lib/telegramBot';

const router = Router();

// ─── Username normalisation ───────────────────────────────────────────────────
// Accepts: "@mychannel", "mychannel", "t.me/mychannel", "https://t.me/mychannel"
// Rejects: private invite links (t.me/+…), joinchat URLs, empty/numeric handles

function normalizeUsername(raw: string): string | null {
  let s = raw.trim();

  // Strip URL prefixes
  s = s.replace(/^https?:\/\/t\.me\//i, '');
  s = s.replace(/^t\.me\//i, '');

  // Strip leading @
  s = s.replace(/^@+/, '');

  // Reject private invite links and empty results
  if (!s || s.startsWith('+') || s.toLowerCase().startsWith('joinchat')) {
    return null;
  }

  // Telegram usernames: letters, digits, underscores, min 3 chars
  // (Telegram enforces 5–32; we let Telegram reject anything shorter)
  if (!/^[a-zA-Z0-9_]{3,}$/.test(s)) {
    return null;
  }

  // Lowercase for consistent DB storage (Telegram usernames are case-insensitive)
  return s.toLowerCase();
}

// ─── POST /api/channels/connect ───────────────────────────────────────────────
//
// Request body:  { initData: string, username: string }
// Response 200:  { channel: { id, username, title, subscribersCount, isDefault, isConnected } }
// Response 400:  { error }  — missing/invalid input or not a channel
// Response 401:  { error }  — invalid initData or user not found
// Response 403:  { error }  — bot not admin / missing post permission
// Response 404:  { error }  — channel not found on Telegram
// Response 409:  { error }  — channel already owned by another user
// Response 500:  { error }  — DB or Telegram API failure

router.post('/connect', async (req: Request, res: Response): Promise<void> => {
  const { initData, username: rawUsername } = req.body as {
    initData?: unknown;
    username?: unknown;
  };

  // ── 1. Basic input validation ─────────────────────────────────────────────
  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' });
    return;
  }
  if (typeof rawUsername !== 'string' || !rawUsername.trim()) {
    res.status(400).json({ error: 'username is required' });
    return;
  }

  // ── 2. Validate Telegram initData ────────────────────────────────────────
  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Invalid initData',
    });
    return;
  }

  // ── 3. Find the authenticated user in DB ─────────────────────────────────
  const telegramId = String(parsed.user.id);
  let dbUser: { id: string } | null = null;
  try {
    dbUser = await prisma.user.findUnique({
      where: { telegramId },
      select: { id: true },
    });
  } catch (err) {
    console.error('[channels/connect] User lookup failed:', err);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  if (!dbUser) {
    res.status(401).json({ error: 'User not found. Please re-open the app.' });
    return;
  }

  // ── 4. Normalize username ────────────────────────────────────────────────
  const handle = normalizeUsername(rawUsername);
  if (!handle) {
    res.status(400).json({ error: 'Invalid channel username. Enter @channelname or t.me/channelname.' });
    return;
  }

  // ── 5. Verify channel exists on Telegram (getChat) ───────────────────────
  let tgChat;
  try {
    tgChat = await getChat(`@${handle}`, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    if (err instanceof TelegramApiError) {
      res.status(404).json({ error: `Channel @${handle} not found on Telegram.` });
      return;
    }
    console.error('[channels/connect] getChat failed:', err);
    res.status(500).json({ error: 'Could not reach Telegram. Try again.' });
    return;
  }

  // ── 6. Reject private chats and plain groups ──────────────────────────────
  if (tgChat.type !== 'channel' && tgChat.type !== 'supergroup') {
    res.status(400).json({
      error: 'Only public channels and supergroups can be connected.',
    });
    return;
  }

  // ── 7. Verify bot is admin (getChatMember) ────────────────────────────────
  const botId = getBotIdFromToken(env.TELEGRAM_BOT_TOKEN);
  let member;
  try {
    member = await getChatMember(`@${handle}`, botId, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    if (err instanceof TelegramApiError) {
      res.status(403).json({
        error: `Bot is not an admin in @${handle}. Add @ai_tg_studio_bot as a channel admin first.`,
      });
      return;
    }
    console.error('[channels/connect] getChatMember failed:', err);
    res.status(500).json({ error: 'Could not reach Telegram. Try again.' });
    return;
  }

  if (member.status !== 'administrator' && member.status !== 'creator') {
    res.status(403).json({
      error: `Bot is not an admin in @${handle}. Add @ai_tg_studio_bot as a channel admin first.`,
    });
    return;
  }

  // For channels (not supergroups), can_post_messages must be explicitly true.
  // For supergroups the field is absent — we skip the check.
  if (tgChat.type === 'channel' && member.can_post_messages === false) {
    res.status(403).json({
      error: 'The bot needs "Post messages" permission. Edit admin rights in your channel settings.',
    });
    return;
  }

  // ── 8. Duplicate-ownership check ─────────────────────────────────────────
  let existingChannel: { id: string; userId: string } | null = null;
  try {
    existingChannel = await prisma.channel.findFirst({
      where: { handle },
      select: { id: true, userId: true },
    });
  } catch (err) {
    console.error('[channels/connect] Channel lookup failed:', err);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  if (existingChannel && existingChannel.userId !== dbUser.id) {
    res.status(409).json({
      error: 'This channel is already connected by another account.',
    });
    return;
  }

  // ── 9. Upsert Channel in DB ───────────────────────────────────────────────
  const title = tgChat.title ?? handle;
  const subscribersCount = tgChat.member_count ?? 0;

  let channel: { id: string; name: string; handle: string | null };
  try {
    channel = await prisma.channel.upsert({
      where: { handle },
      update: { name: title },
      create: { name: title, handle, userId: dbUser.id },
      select: { id: true, name: true, handle: true },
    });
  } catch (err) {
    console.error('[channels/connect] Channel upsert failed:', err);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  // ── 10. Create empty BrandKit if not present ──────────────────────────────
  try {
    await prisma.brandKit.upsert({
      where:  { channelId: channel.id },
      update: {},
      create: { channelId: channel.id },
    });
  } catch (err) {
    // Non-fatal: channel was saved; BrandKit creation can be retried on next open
    console.error('[channels/connect] BrandKit upsert failed:', err);
  }

  // ── 11. Determine isDefault (true only if this is the user's sole channel) ─
  let channelCount = 0;
  try {
    channelCount = await prisma.channel.count({ where: { userId: dbUser.id } });
  } catch {
    // non-fatal — default to false if count fails
  }

  res.json({
    channel: {
      id:               channel.id,
      username:         channel.handle ?? handle,
      title:            channel.name,
      subscribersCount,
      isDefault:        channelCount === 1,
      isConnected:      true,
    },
  });
});

export default router;
