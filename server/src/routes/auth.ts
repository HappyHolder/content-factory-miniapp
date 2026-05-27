import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';

const router = Router();

// ─── POST /api/auth/telegram ──────────────────────────────────────────────────
// Validates Telegram Mini App initData, upserts User by telegramId.
//
// Request body:  { initData: string }
// Response 200:  { user: { id, name, telegramId, username }, channels: [], subscription: null }
// Response 400:  { error: string }  — missing / malformed body
// Response 401:  { error: string }  — invalid or expired initData
// Response 500:  { error: string }  — DB failure

router.post('/telegram', async (req: Request, res: Response): Promise<void> => {
  const { initData } = req.body as { initData?: unknown };

  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required and must be a string' });
    return;
  }

  // ── Validate Telegram signature ───────────────────────────────────────────
  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Invalid initData',
    });
    return;
  }

  const { user: tgUser } = parsed;

  // ── Build fields to persist ───────────────────────────────────────────────
  // telegramId is stored as a string (Telegram IDs can exceed JS safe int)
  const telegramId = String(tgUser.id);

  // Combine first + last name; both fields may be absent in future Telegram versions
  const nameParts = [tgUser.first_name, tgUser.last_name].filter(Boolean);
  const name = nameParts.length > 0 ? nameParts.join(' ') : null;

  // NOTE: username is NOT in the current Prisma User schema.
  // It is returned in the response from parsed initData but not persisted.
  // Add a migration with `username String? @unique` before storing it.

  // ── Upsert User ───────────────────────────────────────────────────────────
  let dbUser;
  try {
    dbUser = await prisma.user.upsert({
      where:  { telegramId },
      update: { name },         // refresh name on every auth (Telegram name may change)
      create: { telegramId, name },
    });
  } catch (err) {
    console.error('[auth/telegram] DB upsert failed:', err);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  // ── Response ──────────────────────────────────────────────────────────────
  res.json({
    user: {
      id:         dbUser.id,
      name:       dbUser.name,
      telegramId: dbUser.telegramId,
      username:   tgUser.username ?? null,   // from initData; not yet persisted in DB
    },
    channels:     [],      // populated once GET /api/channels is implemented
    subscription: null,    // populated once Subscription model is wired up
  });
});

export default router;
