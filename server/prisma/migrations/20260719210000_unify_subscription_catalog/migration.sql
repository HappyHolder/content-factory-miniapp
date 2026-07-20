-- Replace the legacy Bot/Create and LOW/HIGH subscription dimensions with one
-- product catalogue and explicit usage counters. Existing users receive a fresh
-- allowance after deployment; no paid access is shortened by this migration.
ALTER TABLE "Subscription"
  ADD COLUMN "textGenerationsUsed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "visualGenerationsUsed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bonusVisualGenerations" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "assistantMessagesUsed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "contentManagerPostsUsed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "communityManagerActionsUsed" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Subscription"
  DROP COLUMN "modelTier",
  DROP COLUMN "aiPostsLimit",
  DROP COLUMN "aiPostsUsed",
  DROP COLUMN "aiCreatesLimit",
  DROP COLUMN "aiCreatesUsed";

ALTER TABLE "PromoCode" DROP COLUMN "modelTier";
DROP TYPE "ModelTier";

ALTER TABLE "ContentPlan" ADD COLUMN "generateVisuals" BOOLEAN NOT NULL DEFAULT true;
