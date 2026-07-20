import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import { createStarsInvoiceLink } from '../lib/telegramBot';
import { verifyTonDeposit } from '../lib/tonVerification';
import {
  pricingFor, isPaidTier, grantSubscription, serializeSub, type PaidTier,
} from '../lib/payments';
import { getEffectiveSubscription } from '../lib/subscriptionLimits';
import { grantStylePurchase } from '../lib/styles';

const router = Router();

// Display names for the paid tiers (DB enum stays STARTER/CREATOR/STUDIO_PRO).
const TIER_DISPLAY: Record<PaidTier, string> = {
  STARTER:    'Starter',
  CREATOR:    'Creator',
  STUDIO_PRO: 'Studio Pro',
};
const PLAN_TITLE: Record<PaidTier, string> = {
  STARTER:    `Publium · ${TIER_DISPLAY.STARTER}`,
  CREATOR:    `Publium · ${TIER_DISPLAY.CREATOR}`,
  STUDIO_PRO: `Publium · ${TIER_DISPLAY.STUDIO_PRO}`,
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
  const sub = await getEffectiveSubscription(dbUser.id);
  res.json({ subscription: serializeSub(sub) });
});

// Body: { initData, tier }  Response: { invoiceUrl }

router.post('/stars/create-invoice', async (req: Request, res: Response): Promise<void> => {
  const { initData, tier } = req.body as { initData?: unknown; tier?: unknown };
  const dbUser = await resolveUser(initData, res);
  if (!dbUser) return;
  if (!isPaidTier(tier)) { res.status(400).json({ error: 'Invalid plan tier' }); return; }
  const price = pricingFor(tier);
  const payload = JSON.stringify({ t: 'sub', tier, uid: dbUser.id });
  if (Buffer.byteLength(payload, 'utf8') > 128) { res.status(400).json({ error: 'payload too large' }); return; }

  try {
    const invoiceUrl = await createStarsInvoiceLink({
      title:       PLAN_TITLE[tier],
      description: 'Subscription ' + TIER_DISPLAY[tier] + ' for 30 days',
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
  const expectedTon = pricingFor(tier as PaidTier).ton;

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

  try {
    const granted = await prisma.$transaction(async (tx) => {
      await tx.tonPayment.create({
        data: { txHash: result.txHash!, userId: dbUser.id, tier: tier as PaidTier, amountTon: result.actualTon ?? expectedTon },
      });
      return grantSubscription(dbUser.id, tier as PaidTier, undefined, tx);
    });
    res.json({ subscription: serializeSub(granted) });
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2002') {
      res.status(409).json({ error: 'Этот платёж уже зачтён.' });
      return;
    }
    console.error('[payments/ton] grant failed:', (error as Error).message);
    res.status(500).json({ error: 'Не удалось активировать тариф. Платёж можно проверить повторно.' });
  }
});

// ─── POST /api/payments/stars/create-style-invoice ────────────────────────────
// Creates a Telegram Stars invoice for a one-time style purchase. The grant
// happens in the bot's successful_payment handler (authoritative).
// Body: { initData, styleId }  Response: { invoiceUrl }

router.post('/stars/create-style-invoice', async (req: Request, res: Response): Promise<void> => {
  const { initData, styleId } = req.body as { initData?: unknown; styleId?: unknown };
  const dbUser = await resolveUser(initData, res);
  if (!dbUser) return;
  if (typeof styleId !== 'string' || !styleId.trim()) { res.status(400).json({ error: 'styleId is required' }); return; }

  const style = await prisma.style.findUnique({
    where:  { id: styleId },
    select: { id: true, nameEn: true, priceKind: true, priceStars: true, published: true },
  }).catch(() => null);
  if (!style || !style.published) { res.status(404).json({ error: 'Style not found' }); return; }
  if (style.priceKind !== 'PAID' || !style.priceStars || style.priceStars < 1) {
    res.status(400).json({ error: 'This style is not purchasable with Stars' }); return;
  }

  // Payload echoed back in successful_payment — identifies user + style.
  const payload = JSON.stringify({ t: 'style', sid: style.id, uid: dbUser.id });
  if (Buffer.byteLength(payload, 'utf8') > 128) { res.status(400).json({ error: 'payload too large' }); return; }

  try {
    const invoiceUrl = await createStarsInvoiceLink({
      title:       `Publium · ${style.nameEn}`,
      description: `Стиль обложек «${style.nameEn}» — разовая покупка`,
      payload,
      amountStars: style.priceStars,
      token:       env.TELEGRAM_BOT_TOKEN,
    });
    res.json({ invoiceUrl });
  } catch (err) {
    console.error('[payments/stars/style] invoice failed:', (err as Error).message);
    res.status(502).json({ error: 'Не удалось создать счёт. Попробуйте снова.' });
  }
});

// ─── POST /api/payments/ton/verify-style ──────────────────────────────────────
// Verifies a TON (Gram) payment for a one-time style purchase and records
// ownership on success.
// Body: { initData, styleId, senderWallet }  Response: { owned: true, styleId } | error

router.post('/ton/verify-style', async (req: Request, res: Response): Promise<void> => {
  const { initData, styleId, senderWallet } = req.body as { initData?: unknown; styleId?: unknown; senderWallet?: unknown };
  const dbUser = await resolveUser(initData, res);
  if (!dbUser) return;
  if (typeof styleId !== 'string' || !styleId.trim()) { res.status(400).json({ error: 'styleId is required' }); return; }
  if (typeof senderWallet !== 'string' || !senderWallet.trim()) { res.status(400).json({ error: 'senderWallet is required' }); return; }
  if (!env.TON_RECEIVING_WALLET || !env.TONCENTER_API_KEY) {
    res.status(503).json({ error: 'TON payments are not configured.' }); return;
  }

  const style = await prisma.style.findUnique({
    where:  { id: styleId },
    select: { id: true, priceKind: true, priceGram: true, published: true },
  }).catch(() => null);
  if (!style || !style.published) { res.status(404).json({ error: 'Style not found' }); return; }
  if (style.priceKind !== 'PAID' || !style.priceGram || style.priceGram <= 0) {
    res.status(400).json({ error: 'This style is not purchasable with Gram' }); return;
  }

  const result = await verifyTonDeposit({
    expectedTon:     style.priceGram,
    senderWallet:    senderWallet.trim(),
    receivingWallet: env.TON_RECEIVING_WALLET,
    apiKey:          env.TONCENTER_API_KEY,
    expectedComment: dbUser.telegramId,
    isHashUsed: async (hash) => !!(await prisma.stylePurchase.findUnique({ where: { txHash: hash }, select: { id: true } }).catch(() => null)),
  });

  if (!result.ok || !result.txHash) {
    res.status(402).json({ error: result.hint ?? 'Платёж не найден. Попробуйте ещё раз через минуту.', code: result.error });
    return;
  }

  // The unique txHash + (userId, styleId) constraints are the final guard against
  // a double-claim race between two verify calls.
  const { alreadyOwned } = await grantStylePurchase(dbUser.id, style.id, 'GRAM', result.txHash);
  if (alreadyOwned) { res.status(409).json({ error: 'Этот платёж уже зачтён.' }); return; }
  res.json({ owned: true, styleId: style.id });
});

export default router;
