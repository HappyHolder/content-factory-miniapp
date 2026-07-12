CREATE TABLE "ModerationMessageSample" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "tgUserId" TEXT NOT NULL,
  "telegramMessageId" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "hasLink" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModerationMessageSample_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ModerationMessageSample_communityId_tgUserId_createdAt_idx" ON "ModerationMessageSample"("communityId", "tgUserId", "createdAt");
CREATE INDEX "ModerationMessageSample_createdAt_idx" ON "ModerationMessageSample"("createdAt");
CREATE UNIQUE INDEX "ModerationMessageSample_communityId_telegramMessageId_key" ON "ModerationMessageSample"("communityId", "telegramMessageId");
ALTER TABLE "ModerationMessageSample" ADD CONSTRAINT "ModerationMessageSample_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
