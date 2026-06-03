-- Add monthly quota reset anchor to Subscription.
-- Backfill: existing subscriptions reset one month from now.

ALTER TABLE "Subscription" ADD COLUMN "quotaResetAt" TIMESTAMP(3);

UPDATE "Subscription" SET "quotaResetAt" = NOW() + INTERVAL '1 month' WHERE "quotaResetAt" IS NULL;
