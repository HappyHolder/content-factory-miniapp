-- Telegram Stars payment ledger: one row per credited charge.
-- chargeId (telegram_payment_charge_id) is unique → duplicate successful_payment
-- webhook deliveries can't double-credit the same purchase.
CREATE TABLE "StarsPayment" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "PlanTier" NOT NULL,
    "amountStars" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StarsPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StarsPayment_chargeId_key" ON "StarsPayment"("chargeId");
CREATE INDEX "StarsPayment_userId_idx" ON "StarsPayment"("userId");
