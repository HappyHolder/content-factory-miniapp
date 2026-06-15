import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import { createStarsInvoiceLink } from '../lib/telegramBot';
import { verifyTonDeposit } from '../lib/tonVerification';
import {
  PLAN_PRICING, isPaidTier, grantSubscription, serializeSub, type PaidTier,
} from '../lib/payments';
import { applyTierExpiry, applyMonthlyQuotaReset } from '../lib/subscriptionLimits';

const router = Router();

const PLAN_TITLE: Record<PaidTier, string> = {
  STARTER:    'Publium · Starter',
  CREATOR:    'Publium · Creator',
  STUDIO_PRO: 'Publium · Studio Pro',
};

/** Resolves the authenticated user from initData. Writes an error response and returns null on failure. */
async function resolveUser(initData: unknown, res: Response): Promise<{ id: string; telegramId: string } | null> {
  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' }); return null;
  }
  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return null;
  }
  const telegramId = String(parsed.user.id);
  const dbUser = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } }).catch(() => null);
  if (!dbUser) { res.status(401).json({ error: 'User not found. Please re-open the app.' }); return null; }
  return { id: dbUser.id, telegramId };
}

// ─── POST /api/payments/subscription ──────────────────────────────────────────
// Returns the caller's current subscription (with lazy tier-expiry + monthly
// reset applied). Used to refresh the UI after a payment completes.

router.post('/subscription', async (req: Request, res: Response): Promise<void> => {
  const { initData } = req.body as { initData?: unknown };
  const dbUser = await resolveUser(initData, res);
  if (!dbUser) return;

  const sub = await prisma.subscription.findUnique({
    where:  { userId: dbUser.id },
    select: { tier: true, aiPostsLimit: true, aiPostsUsed: true, aiCreatesLimit: true, aiCreatesUsed: true, quotaResetAt: true, expiresAt: true },
  }).catch(() => null);
  if (!sub) { res.json({ subscription: null }); return; }

  const tierState = await applyTierExpiry({ userId: dbUser.id, tier: sub.tier, aiPostsLimit: sub.aiPostsLimit, aiCreatesLimit: sub.aiCreatesLimit, expiresAt: sub.expiresAt });
  const downgraded = tierState.tier !== sub.tier;
  const fresh = await applyMonthlyQuotaReset({
    userId: dbUser.id,
    aiPostsLimit: tierState.aiPostsLimit, aiPostsUsed: downgraded ? 0 : sub.aiPostsUsed,
    aiCreatesLimit: tierState.aiCreatesLimit, aiCreatesUsed: downgraded ? 0 : sub.aiCreatesUsed,
    quotaResetAt: sub.quotaResetAt,
  });
  res.json({ subscription: serializeSub({ tier: tierState.tier, expiresAt: tierState.expiresAt, ...fresh }) });
});

// ─── POST /api/payments/stars/create-invoice ─────────────────────────────────
// Creates a Telegram Stars invoice for the chosen plan. The actual grant happens
// in the bot's successful_payment handler (authoritative).
// Body: { initData, tier }  Response: { invoiceUrl }

router.post('/stars/create-invoice', async (req: Request, res: Response): Promise<void> => {
  const { initData, tier } = req.body as { initData?: unknown; tier?: unknown };
  const dbUser = await resolveUser(initData, res);
  if (!dbUser) return;
  if (!isPaidTier(tier)) { res.status(400).json({ error: 'Invalid plan tier' }); return; }

  const price = PLAN_PRICING[tier];
  // Payload echoed back in successful_payment — identifies user + tier.
  const payload = JSON.stringify({ t: 'sub', tier, uid: dbUser.id });
  if (Buffer.byteLength(payload, 'utf8') > 128) { res.status(400).json({ error: 'payload too large' }); return; }

  try {
    const invoiceUrl = await createStarsInvoiceLink({
      title:       PLAN_TITLE[tier],
      description: `Подписка ${tier} на 30 дней`,
      payload,
      amountStars: price.stars,
      token:       env.TELEGRAM_BOT_TOKEN,
    });
    res.json({ invoiceUrl });
  } catch (err) {
    console.error('[payments/stars] invoice failed:', (err as Error).message);
    res.status(502).json({ error: 'Не удалось создать счёт. Попробуйте снова.' });
  }
});

// ─── POST /api/payments/ton/verify ────────────────────────────────────────────
// Verifies a TON payment sent via TonConnect and grants the plan on success.
// Body: { initData, tier, senderWallet }  Response: { subscription } | error

router.post('/ton/verify', async (req: Request, res: Response): Promise<void> => {
  const { initData, tier, senderWallet } = req.body as { initData?: unknown; tier?: unknown; senderWallet?: unknown };
  const dbUser = await resolveUser(initData, res);
  if (!dbUser) return;
  if (!isPaidTier(tier)) { res.status(400).json({ error: 'Invalid plan tier' }); return; }
  if (typeof senderWallet !== 'string' || !senderWallet.trim()) { res.status(400).json({ error: 'senderWallet is required' }); return; }
  if (!env.TON_RECEIVING_WALLET || !env.TONCENTER_API_KEY) {
    res.status(503).json({ error: 'TON payments are not configured.' }); return;
  }

  const expectedTon = PLAN_PRICING[tier as PaidTier].ton;

  const result = await verifyTonDeposit({
    expectedTon,
    senderWallet: senderWallet.trim(),
    receivingWallet: env.TON_RECEIVING_WALLET,
    apiKey: env.TONCENTER_API_KEY,
    // Binds the deposit to this user — the transfer must carry their Telegram id
    // as a comment, so a stranger's wallet/tx cannot be claimed here.
    expectedComment: dbUser.telegramId,
    isHashUsed: async (hash) => !!(await prisma.tonPayment.findUnique({ where: { txHash: hash }, select: { id: true } }).catch(() => null)),
  });

  if (!result.ok || !result.txHash) {
    res.status(402).json({ error: result.hint ?? 'Платёж не найден. Попробуйте ещё раз через минуту.', code: result.error });
    return;
  }

  // Record the tx hash (unique) then grant. The unique constraint is the final
  // double-credit guard against a race between two verify calls.
  try {
    await prisma.tonPayment.create({
      data: { txHash: result.txHash, userId: dbUser.id, tier: tier as PaidTier, amountTon: result.actualTon ?? expectedTon },
    });
  } catch {
    res.status(409).json({ error: 'Этот платёж уже зачтён.' }); return;
  }

  const granted = await grantSubscription(dbUser.id, tier as PaidTier);
  res.json({ subscription: serializeSub(granted) });
});

export default router;
