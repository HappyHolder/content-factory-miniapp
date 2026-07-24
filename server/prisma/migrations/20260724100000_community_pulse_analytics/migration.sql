-- Pulse analytics. Layer 1: per-participant-per-day facts (the only correct basis
-- for non-additive period metrics — unique actives, DAU/MAU, cohorts, Orbit tiers
-- — and what lets metrics be recomputed retroactively). Layer 2: pre-aggregated
-- day rows for fast charts. Days are MSK 'YYYY-MM-DD' strings so month/quarter/
-- year boundaries never drift with server timezone.

CREATE TABLE "CommunityDailyParticipant" (
  "id"          TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "tgUserId"    TEXT NOT NULL,
  "day"         TEXT NOT NULL,
  "messages"    INTEGER NOT NULL DEFAULT 0,
  "replies"     INTEGER NOT NULL DEFAULT 0,
  "firstDay"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityDailyParticipant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityDailyParticipant_communityId_tgUserId_day_key"
  ON "CommunityDailyParticipant"("communityId", "tgUserId", "day");
CREATE INDEX "CommunityDailyParticipant_communityId_day_idx"
  ON "CommunityDailyParticipant"("communityId", "day");
CREATE INDEX "CommunityDailyParticipant_communityId_tgUserId_idx"
  ON "CommunityDailyParticipant"("communityId", "tgUserId");

ALTER TABLE "CommunityDailyParticipant" ADD CONSTRAINT "CommunityDailyParticipant_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CommunityDailyStat" (
  "id"             TEXT NOT NULL,
  "communityId"    TEXT NOT NULL,
  "day"            TEXT NOT NULL,
  "messages"       INTEGER NOT NULL DEFAULT 0,
  "activeUsers"    INTEGER NOT NULL DEFAULT 0,
  "replies"        INTEGER NOT NULL DEFAULT 0,
  "joins"          INTEGER NOT NULL DEFAULT 0,
  "leaves"         INTEGER NOT NULL DEFAULT 0,
  "newSpeakers"    INTEGER NOT NULL DEFAULT 0,
  "memberCount"    INTEGER,
  "blockedMsgs"    INTEGER NOT NULL DEFAULT 0,
  "interventions"  INTEGER NOT NULL DEFAULT 0,
  "conflictEvents" INTEGER NOT NULL DEFAULT 0,
  "hourHistogram"  JSONB,
  "climateScore"   DOUBLE PRECISION,
  "computedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityDailyStat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityDailyStat_communityId_day_key"
  ON "CommunityDailyStat"("communityId", "day");
CREATE INDEX "CommunityDailyStat_communityId_day_idx"
  ON "CommunityDailyStat"("communityId", "day");

ALTER TABLE "CommunityDailyStat" ADD CONSTRAINT "CommunityDailyStat_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
