-- Add Create-mode generation quota fields to Subscription
-- aiCreatesLimit: nullable = unlimited (Studio Pro), 20 = Starter, 60 = Creator
-- aiCreatesUsed:  counter reset monthly (managed by app logic)

ALTER TABLE "Subscription" ADD COLUMN "aiCreatesLimit" INTEGER;
ALTER TABLE "Subscription" ADD COLUMN "aiCreatesUsed" INTEGER NOT NULL DEFAULT 0;

-- Backfill limits for existing subscriptions based on tier
UPDATE "Subscription" SET
  "aiPostsLimit"   = CASE tier WHEN 'STARTER' THEN 30  WHEN 'CREATOR' THEN 150 ELSE 700 END,
  "aiCreatesLimit" = CASE tier WHEN 'STARTER' THEN 20  WHEN 'CREATOR' THEN 60  ELSE NULL END
WHERE true;
