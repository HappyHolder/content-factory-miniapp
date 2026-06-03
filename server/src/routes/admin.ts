import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import type { PlanTier } from '@prisma/client';

const router = Router();

const VALID_TIERS: PlanTier[] = ['STARTER', 'CREATOR', 'STUDIO_PRO'];

// Unambiguous alphabet (no 0/O/1/I) for human-friendly codes.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCodeSegment(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    // crypto.randomInt — cryptographically secure, unbiased over the alphabet
    out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/** Builds a readable code like "CF-AB3K-9XQ2". */
function buildCode(): string {
  return `CF-${generateCodeSegment(4)}-${generateCodeSegment(4)}`;
}

/**
 * Resolves the authenticated Telegram user and verifies admin membership.
 * Returns the telegramId on success, or writes an error response and returns null.
 */
function requireAdmin(initData: unknown, res: Response): string | null {
  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' });
    return null;
  }
  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' });
    return null;
  }
  const telegramId = String(parsed.user.id);
  if (!env.ADMIN_TELEGRAM_IDS.includes(telegramId)) {
    res.status(403).json({ error: 'Admin access required.' });
    return null;
  }
  return telegramId;
}

// ─── POST /api/admin/promo/create ─────────────────────────────────────────────
// Generates a single-use promo code granting `tier` for `durationDays` days.
// Admin-only. Request body: { initData, tier, durationDays }
// Response 200: { code: { code, tier, durationDays, createdAt } }

router.post('/promo/create', async (req: Request, res: Response): Promise<void> => {
  const { initData, tier, durationDays } = req.body as {
    initData?: unknown; tier?: unknown; durationDays?: unknown;
  };

  const adminId = requireAdmin(initData, res);
  if (!adminId) return;

  if (typeof tier !== 'string' || !VALID_TIERS.includes(tier as PlanTier)) {
    res.status(400).json({ error: `tier must be one of: ${VALID_TIERS.join(', ')}` });
    return;
  }
  const days = Number(durationDays);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    res.status(400).json({ error: 'durationDays must be an integer between 1 and 3650' });
    return;
  }

  // Generate a unique code (retry on the rare collision).
  let code = buildCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const exists = await prisma.promoCode.findUnique({ where: { code }, select: { id: true } }).catch(() => null);
    if (!exists) break;
    code = buildCode();
  }

  try {
    const created = await prisma.promoCode.create({
      data: { code, tier: tier as PlanTier, durationDays: days, createdById: adminId },
      select: { code: true, tier: true, durationDays: true, createdAt: true },
    });
    res.json({ code: { ...created, createdAt: created.createdAt.toISOString() } });
  } catch (err) {
    console.error('[admin/promo/create] DB error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/admin/promo/list ───────────────────────────────────────────────
// Lists issued promo codes (newest first, capped). Admin-only.
// Request body: { initData }
// Response 200: { codes: PromoCodeRow[] }

router.post('/promo/list', async (req: Request, res: Response): Promise<void> => {
  const { initData } = req.body as { initData?: unknown };
  const adminId = requireAdmin(initData, res);
  if (!adminId) return;

  try {
    const rows = await prisma.promoCode.findMany({
      orderBy: { createdAt: 'desc' },
      take:    100,
      select:  { code: true, tier: true, durationDays: true, redeemedAt: true, createdAt: true },
    });
    res.json({
      codes: rows.map(r => ({
        code:         r.code,
        tier:         r.tier,
        durationDays: r.durationDays,
        redeemed:     r.redeemedAt !== null,
        redeemedAt:   r.redeemedAt?.toISOString() ?? null,
        createdAt:    r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[admin/promo/list] DB error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
