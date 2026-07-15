CREATE TABLE "CommunityManagerParticipant" (
  "id" TEXT NOT NULL,
  "communityManagerId" TEXT NOT NULL,
  "tgUserId" TEXT NOT NULL,
  "username" TEXT,
  "firstName" TEXT,
  "lastName" TEXT,
  "displayName" TEXT NOT NULL,
  "relationship" TEXT NOT NULL DEFAULT 'NEW',
  "roles" JSONB,
  "expertise" JSONB,
  "messageCount" INTEGER NOT NULL DEFAULT 0,
  "cmExchangeCount" INTEGER NOT NULL DEFAULT 0,
  "activeDayKeys" JSONB,
  "helpfulSignals" INTEGER NOT NULL DEFAULT 0,
  "expertConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "mentionEnabled" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastCmExchangeAt" TIMESTAMP(3),
  "lastMentionedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityManagerParticipant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommunityManagerParticipant_communityManagerId_tgUserId_key" ON "CommunityManagerParticipant"("communityManagerId", "tgUserId");
CREATE INDEX "CommunityManagerParticipant_communityManagerId_relationship_lastSeenAt_idx" ON "CommunityManagerParticipant"("communityManagerId", "relationship", "lastSeenAt");
CREATE INDEX "CommunityManagerParticipant_communityManagerId_expertConfirmed_mentionEnabled_idx" ON "CommunityManagerParticipant"("communityManagerId", "expertConfirmed", "mentionEnabled");
ALTER TABLE "CommunityManagerParticipant" ADD CONSTRAINT "CommunityManagerParticipant_communityManagerId_fkey" FOREIGN KEY ("communityManagerId") REFERENCES "CommunityManager"("id") ON DELETE CASCADE ON UPDATE CASCADE;
