-- Clean (text-free) cover background, so the headline text can be re-rendered
-- without regenerating the picture. Nullable, additive — no backfill needed.
ALTER TABLE "GeneratedPost" ADD COLUMN "coverBaseUrl" TEXT;
