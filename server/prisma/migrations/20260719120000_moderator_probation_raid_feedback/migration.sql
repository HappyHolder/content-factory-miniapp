ALTER TABLE "CommunityMember" ADD COLUMN "messagesCount" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "CommunityMember_tgUserId_status_idx" ON "CommunityMember"("tgUserId", "status");

ALTER TABLE "ModeratorConversationState"
  ADD COLUMN "joinWindowStartedAt" TIMESTAMP(3),
  ADD COLUMN "joinsInWindow" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "raidModeUntil" TIMESTAMP(3);

ALTER TABLE "ModerationEvent" ADD COLUMN "feedback" TEXT;
CREATE INDEX "ModerationEvent_communityId_feedback_createdAt_idx" ON "ModerationEvent"("communityId", "feedback", "createdAt");
