ALTER TABLE "CommunityMember" ADD COLUMN "joinCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ScheduledModerationAction" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "tgChatId" TEXT NOT NULL,
  "telegramMessageId" INTEGER NOT NULL,
  "executeAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduledModerationAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduledModerationAction_status_executeAt_idx" ON "ScheduledModerationAction"("status", "executeAt");
CREATE UNIQUE INDEX "ScheduledModerationAction_tgChatId_telegramMessageId_actionType_key" ON "ScheduledModerationAction"("tgChatId", "telegramMessageId", "actionType");
ALTER TABLE "ScheduledModerationAction" ADD CONSTRAINT "ScheduledModerationAction_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
