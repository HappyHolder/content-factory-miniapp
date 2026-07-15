CREATE TABLE "CommunityManagerConversationState" (
  "id" TEXT NOT NULL,
  "communityManagerId" TEXT NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '',
  "activeTopics" JSONB,
  "openQuestions" JSONB,
  "participantMemory" JSONB,
  "mood" TEXT,
  "messagesSinceAnalysis" INTEGER NOT NULL DEFAULT 0,
  "lastAnalyzedAt" TIMESTAMP(3),
  "lastHumanAt" TIMESTAMP(3),
  "lastCmAt" TIMESTAMP(3),
  "nextInitiativeAt" TIMESTAMP(3),
  "pendingModeratorMessageId" INTEGER,
  "pendingModeratorText" TEXT,
  "pendingModeratorAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityManagerConversationState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityManagerConversationState_communityManagerId_key" ON "CommunityManagerConversationState"("communityManagerId");
CREATE INDEX "CommunityManagerConversationState_nextInitiativeAt_idx" ON "CommunityManagerConversationState"("nextInitiativeAt");
ALTER TABLE "CommunityManagerConversationState" ADD CONSTRAINT "CommunityManagerConversationState_communityManagerId_fkey" FOREIGN KEY ("communityManagerId") REFERENCES "CommunityManager"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityManagerAction" ADD COLUMN "metadata" JSONB;
