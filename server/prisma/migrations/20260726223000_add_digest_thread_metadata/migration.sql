ALTER TABLE "CommunityManagerDigestMessage"
  ADD COLUMN "replyToMessageId" INTEGER,
  ADD COLUMN "messageThreadId" INTEGER,
  ADD COLUMN "messageType" TEXT NOT NULL DEFAULT 'TEXT';

CREATE INDEX "CommunityManagerDigestMessage_communityManagerId_messageThreadId_idx"
  ON "CommunityManagerDigestMessage"("communityManagerId", "messageThreadId");
