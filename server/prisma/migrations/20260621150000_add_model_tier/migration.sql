-- LOW/HIGH model variant dimension. Defaults to LOW so existing promo codes
-- and subscriptions keep today's behavior. See docs/low-high-plan.md.
CREATE TYPE "ModelTier" AS ENUM ('LOW', 'HIGH');

ALTER TABLE "Subscription" ADD COLUMN "modelTier" "ModelTier" NOT NULL DEFAULT 'LOW';
ALTER TABLE "PromoCode"    ADD COLUMN "modelTier" "ModelTier" NOT NULL DEFAULT 'LOW';
