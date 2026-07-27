-- AlterTable
ALTER TABLE "CommunityManagerParticipant" ADD COLUMN     "autoRelationship" TEXT NOT NULL DEFAULT 'NEW',
ADD COLUMN     "relationshipOverride" TEXT;

-- AlterTable
ALTER TABLE "CommunityManagerMessage" ADD COLUMN     "messageThreadId" INTEGER,
ADD COLUMN     "segmentId" TEXT,
ADD COLUMN     "threadId" TEXT;

-- AlterTable
ALTER TABLE "CommunityManagerAction" ADD COLUMN     "segmentId" TEXT,
ADD COLUMN     "threadId" TEXT;

-- AlterTable
ALTER TABLE "CommunityManagerActivity" ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "segmentId" TEXT,
ADD COLUMN     "sourcePostId" TEXT,
ADD COLUMN     "threadId" TEXT;

-- CreateTable
CREATE TABLE "CommunityManagerThread" (
    "id" TEXT NOT NULL,
    "communityManagerId" TEXT NOT NULL,
    "tgChatId" TEXT NOT NULL,
    "telegramRootMessageId" INTEGER NOT NULL,
    "messageThreadId" INTEGER,
    "sourcePostId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'HUMAN',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastHumanAt" TIMESTAMP(3),
    "lastCmAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityManagerThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityManagerSegment" (
    "id" TEXT NOT NULL,
    "communityManagerId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "topicKey" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "thesisLedger" JSONB,
    "openQuestions" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastMeaningfulTurnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityManagerSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityManagerParticipantClaim" (
    "id" TEXT NOT NULL,
    "communityManagerId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "displayValue" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TENTATIVE',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityManagerParticipantClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityManagerParticipantClaimEvidence" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityManagerParticipantClaimEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityManagerEpisode" (
    "id" TEXT NOT NULL,
    "communityManagerId" TEXT NOT NULL,
    "participantId" TEXT,
    "threadId" TEXT,
    "segmentId" TEXT,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'neutral',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityManagerEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommunityManagerThread_communityManagerId_status_updatedAt_idx" ON "CommunityManagerThread"("communityManagerId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityManagerThread_communityManagerId_tgChatId_telegram_key" ON "CommunityManagerThread"("communityManagerId", "tgChatId", "telegramRootMessageId");

-- CreateIndex
CREATE INDEX "CommunityManagerSegment_threadId_status_updatedAt_idx" ON "CommunityManagerSegment"("threadId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "CommunityManagerSegment_communityManagerId_topicKey_updated_idx" ON "CommunityManagerSegment"("communityManagerId", "topicKey", "updatedAt");

-- CreateIndex
CREATE INDEX "CommunityManagerParticipantClaim_communityManagerId_status__idx" ON "CommunityManagerParticipantClaim"("communityManagerId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityManagerParticipantClaim_participantId_kind_normali_key" ON "CommunityManagerParticipantClaim"("participantId", "kind", "normalizedValue");

-- CreateIndex
CREATE INDEX "CommunityManagerParticipantClaimEvidence_messageId_idx" ON "CommunityManagerParticipantClaimEvidence"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityManagerParticipantClaimEvidence_claimId_messageId_key" ON "CommunityManagerParticipantClaimEvidence"("claimId", "messageId");

-- CreateIndex
CREATE INDEX "CommunityManagerEpisode_participantId_createdAt_idx" ON "CommunityManagerEpisode"("participantId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityManagerEpisode_threadId_segmentId_createdAt_idx" ON "CommunityManagerEpisode"("threadId", "segmentId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityManagerMessage_communityManagerId_messageThreadId__idx" ON "CommunityManagerMessage"("communityManagerId", "messageThreadId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityManagerMessage_threadId_segmentId_createdAt_idx" ON "CommunityManagerMessage"("threadId", "segmentId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityManagerAction_threadId_segmentId_createdAt_idx" ON "CommunityManagerAction"("threadId", "segmentId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityManagerActivity_threadId_segmentId_createdAt_idx" ON "CommunityManagerActivity"("threadId", "segmentId", "createdAt");

-- AddForeignKey
ALTER TABLE "CommunityManagerMessage" ADD CONSTRAINT "CommunityManagerMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommunityManagerThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityManagerMessage" ADD CONSTRAINT "CommunityManagerMessage_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "CommunityManagerSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityManagerAction" ADD CONSTRAINT "CommunityManagerAction_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommunityManagerThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityManagerAction" ADD CONSTRAINT "CommunityManagerAction_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "CommunityManagerSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityManagerActivity" ADD CONSTRAINT "CommunityManagerActivity_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommunityManagerThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityManagerActivity" ADD CONSTRAINT "CommunityManagerActivity_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "CommunityManagerSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityManagerThread" ADD CONSTRAINT "CommunityManagerThread_communityManagerId_fkey" FOREIGN KEY ("communityManagerId") REFERENCES "CommunityManager"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityManagerSegment" ADD CONSTRAINT "CommunityManagerSegment_communityManagerId_fkey" FOREIGN KEY ("communityManagerId") REFERENCES "CommunityManager"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityManagerSegment" ADD CONSTRAINT "CommunityManagerSegment_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommunityManagerThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityManagerParticipantClaim" ADD CONSTRAINT "CommunityManagerParticipantClaim_communityManagerId_fkey" FOREIGN KEY ("communityManagerId") REFERENCES "CommunityManager"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityManagerParticipantClaim" ADD CONSTRAINT "CommunityManagerParticipantClaim_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "CommunityManagerParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityManagerParticipantClaimEvidence" ADD CONSTRAINT "CommunityManagerParticipantClaimEvidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "CommunityManagerParticipantClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityManagerParticipantClaimEvidence" ADD CONSTRAINT "CommunityManagerParticipantClaimEvidence_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunityManagerMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityManagerEpisode" ADD CONSTRAINT "CommunityManagerEpisode_communityManagerId_fkey" FOREIGN KEY ("communityManagerId") REFERENCES "CommunityManager"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityManagerEpisode" ADD CONSTRAINT "CommunityManagerEpisode_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "CommunityManagerParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityManagerEpisode" ADD CONSTRAINT "CommunityManagerEpisode_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommunityManagerThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityManagerEpisode" ADD CONSTRAINT "CommunityManagerEpisode_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "CommunityManagerSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Adopt queued legacy content-release triggers into the unified activity lifecycle.
UPDATE "CommunityManagerActivity"
SET "type" = 'CONTENT_RELEASE', "origin" = 'CONTENT'
WHERE "type" = 'CONTENT_RELEASE_TRIGGER';
-- Preserve stable relationship state while separating automatic progression from owner overrides.
UPDATE "CommunityManagerParticipant"
SET "autoRelationship" = CASE
  WHEN "messageCount" >= 8 AND jsonb_typeof("activeDayKeys") = 'array' AND jsonb_array_length("activeDayKeys") >= 3 THEN 'REGULAR'
  WHEN "messageCount" >= 3 THEN 'ACTIVE'
  ELSE 'NEW'
END,
"relationshipOverride" = CASE WHEN "relationship" = 'FRIEND' THEN 'FRIEND' ELSE NULL END;

UPDATE "CommunityManagerParticipant"
SET "relationship" = CASE
  WHEN "expertConfirmed" THEN 'EXPERT'
  WHEN "relationshipOverride" IS NOT NULL THEN "relationshipOverride"
  ELSE "autoRelationship"
END;

-- Discard unconfirmed model-inferred roles/expertise; owner-confirmed expert data is retained.
UPDATE "CommunityManagerParticipant"
SET "roles" = '[]'::jsonb, "expertise" = '[]'::jsonb
WHERE NOT "expertConfirmed";

-- Restore Telegram discussion-thread identity for already ingested messages.
UPDATE "CommunityManagerMessage" AS message
SET "messageThreadId" = digest."messageThreadId"
FROM "CommunityManagerDigestMessage" AS digest
WHERE digest."communityManagerId" = message."communityManagerId"
  AND digest."telegramMessageId" = message."telegramMessageId"
  AND digest."messageThreadId" IS NOT NULL;

-- Preserve legacy group episodes as normalized audit history before removing JSON storage.
INSERT INTO "CommunityManagerEpisode" ("id", "communityManagerId", "participantId", "kind", "summary", "outcome", "createdAt")
SELECT 'legacy_' || md5(state."id" || ':' || episode.value::text || ':' || episode.ordinality::text),
       state."communityManagerId",
       participant."id",
       COALESCE(NULLIF(episode.value->>'kind', ''), 'legacy'),
       LEFT(COALESCE(NULLIF(episode.value->>'summary', ''), episode.value::text), 500),
       COALESCE(NULLIF(episode.value->>'outcome', ''), 'neutral'),
       COALESCE((episode.value->>'at')::timestamptz, CURRENT_TIMESTAMP)
FROM "CommunityManagerConversationState" AS state
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(state."episodes") = 'array' THEN state."episodes" ELSE '[]'::jsonb END
) WITH ORDINALITY AS episode(value, ordinality)
LEFT JOIN "CommunityManagerParticipant" AS participant
  ON participant."communityManagerId" = state."communityManagerId"
 AND lower(participant."displayName") = lower(COALESCE(episode.value->>'participant', ''))
WHERE COALESCE(NULLIF(episode.value->>'summary', ''), episode.value::text) <> '';

ALTER TABLE "CommunityManagerConversationState"
DROP COLUMN "episodes",
DROP COLUMN "participantMemory";
