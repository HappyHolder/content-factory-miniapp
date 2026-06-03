-- Now that FREE is committed, switch Subscription defaults to the free tier
ALTER TABLE "Subscription" ALTER COLUMN "tier" SET DEFAULT 'FREE',
ALTER COLUMN "aiPostsLimit" SET DEFAULT 5,
ALTER COLUMN "aiCreatesLimit" SET DEFAULT 5;
