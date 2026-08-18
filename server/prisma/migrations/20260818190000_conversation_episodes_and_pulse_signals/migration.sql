ALTER TABLE "ModeratorConversationMessage"
ADD COLUMN "replyToMessageId" INTEGER,
ADD COLUMN "threadKey" TEXT NOT NULL DEFAULT 'main',
ADD COLUMN "moderated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "moderationSignal" JSONB;

CREATE TABLE "ModeratorConversationEpisode" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "episodeKey" TEXT NOT NULL,
  "threadKey" TEXT NOT NULL DEFAULT 'main',
  "category" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'OBSERVING',
  "severity" TEXT NOT NULL DEFAULT 'low',
  "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "summary" TEXT NOT NULL DEFAULT '',
  "participantIds" JSONB NOT NULL DEFAULT '[]',
  "targetIds" JSONB NOT NULL DEFAULT '[]',
  "lastMessageId" INTEGER,
  "lastAnalyzedAt" TIMESTAMP(3),
  "lastIntervenedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModeratorConversationEpisode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ModeratorConversationEpisode_communityId_episodeKey_key" ON "ModeratorConversationEpisode"("communityId", "episodeKey");
CREATE INDEX "ModeratorConversationEpisode_communityId_state_updatedAt_idx" ON "ModeratorConversationEpisode"("communityId", "state", "updatedAt");
CREATE INDEX "ModeratorConversationEpisode_expiresAt_idx" ON "ModeratorConversationEpisode"("expiresAt");
ALTER TABLE "ModeratorConversationEpisode" ADD CONSTRAINT "ModeratorConversationEpisode_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ModeratorParticipantRisk" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "tgUserId" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "level" TEXT NOT NULL DEFAULT 'low',
  "evidenceCount" INTEGER NOT NULL DEFAULT 0,
  "lastEventAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModeratorParticipantRisk_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ModeratorParticipantRisk_communityId_tgUserId_key" ON "ModeratorParticipantRisk"("communityId", "tgUserId");
CREATE INDEX "ModeratorParticipantRisk_communityId_score_idx" ON "ModeratorParticipantRisk"("communityId", "score");
CREATE INDEX "ModeratorParticipantRisk_expiresAt_idx" ON "ModeratorParticipantRisk"("expiresAt");
ALTER TABLE "ModeratorParticipantRisk" ADD CONSTRAINT "ModeratorParticipantRisk_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ModeratorParticipantRiskEvent" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "riskId" TEXT NOT NULL,
  "episodeId" TEXT,
  "category" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "delta" DOUBLE PRECISION NOT NULL,
  "evidence" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModeratorParticipantRiskEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ModeratorParticipantRiskEvent_communityId_createdAt_idx" ON "ModeratorParticipantRiskEvent"("communityId", "createdAt");
CREATE INDEX "ModeratorParticipantRiskEvent_riskId_createdAt_idx" ON "ModeratorParticipantRiskEvent"("riskId", "createdAt");
ALTER TABLE "ModeratorParticipantRiskEvent" ADD CONSTRAINT "ModeratorParticipantRiskEvent_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModeratorParticipantRiskEvent" ADD CONSTRAINT "ModeratorParticipantRiskEvent_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "ModeratorParticipantRisk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityDailyStat"
ADD COLUMN "harassmentEvents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "culturalRewrites" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "affectedUsers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "resolvedEpisodes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "escalatedEpisodes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "toxicityWeight" DOUBLE PRECISION NOT NULL DEFAULT 0;
