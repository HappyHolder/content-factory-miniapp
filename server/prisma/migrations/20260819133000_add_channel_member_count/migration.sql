-- Additive Telegram audience-size cache. Existing channels, communities and
-- analytics are untouched; null means Telegram has not returned a count yet.
ALTER TABLE "Channel"
  ADD COLUMN "telegramMemberCount" INTEGER,
  ADD COLUMN "memberCountUpdatedAt" TIMESTAMP(3);
