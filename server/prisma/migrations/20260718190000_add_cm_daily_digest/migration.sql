-- Separate digest retention from short-lived conversational context.
CREATE TABLE "CommunityManagerDigestMessage" (
    "id" TEXT NOT NULL,
    "communityManagerId" TEXT NOT NULL,
    "telegramMessageId" INTEGER NOT NULL,
    "tgUserId" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommunityManagerDigestMessage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CommunityManagerActivity" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "CommunityManagerDigestMessage_communityManagerId_telegramMessageId_key" ON "CommunityManagerDigestMessage"("communityManagerId", "telegramMessageId");
CREATE INDEX "CommunityManagerDigestMessage_communityManagerId_createdAt_idx" ON "CommunityManagerDigestMessage"("communityManagerId", "createdAt");
CREATE INDEX "CommunityManagerDigestMessage_expiresAt_idx" ON "CommunityManagerDigestMessage"("expiresAt");
CREATE UNIQUE INDEX "CommunityManagerActivity_dedupeKey_key" ON "CommunityManagerActivity"("dedupeKey");

ALTER TABLE "CommunityManagerDigestMessage" ADD CONSTRAINT "CommunityManagerDigestMessage_communityManagerId_fkey" FOREIGN KEY ("communityManagerId") REFERENCES "CommunityManager"("id") ON DELETE CASCADE ON UPDATE CASCADE;