-- TON payment ledger: one row per credited transaction (txHash unique → no double-credit)
CREATE TABLE "TonPayment" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "PlanTier" NOT NULL,
    "amountTon" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TonPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TonPayment_txHash_key" ON "TonPayment"("txHash");
CREATE INDEX "TonPayment_userId_idx" ON "TonPayment"("userId");
