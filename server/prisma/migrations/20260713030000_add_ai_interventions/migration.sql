CREATE TABLE "AiModeratorEntitlement" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'TRIAL',
  "monthlyChecksLimit" INTEGER NOT NULL DEFAULT 5000,
  "checksUsed" INTEGER NOT NULL DEFAULT 0,
  "inputTokensUsed" INTEGER NOT NULL DEFAULT 0,
  "outputTokensUsed" INTEGER NOT NULL DEFAULT 0,
  "estimatedCostMicros" INTEGER NOT NULL DEFAULT 0,
  "quotaResetAt" TIMESTAMP(3),
  "trialEndsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiModeratorEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModeratorConversationMessage" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "tgUserId" TEXT NOT NULL,
  "telegramMessageId" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModeratorConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModeratorConversationState" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "stage" TEXT NOT NULL DEFAULT 'NORMAL',
  "messagesSinceAnalysis" INTEGER NOT NULL DEFAULT 0,
  "lastAnalyzedMessageId" INTEGER,
  "lastInterventionAt" TIMESTAMP(3),
  "hourWindowStartedAt" TIMESTAMP(3),
  "interventionsInWindow" INTEGER NOT NULL DEFAULT 0,
  "lastCategory" TEXT,
  "lastParticipants" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModeratorConversationState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiModeratorEntitlement_userId_key" ON "AiModeratorEntitlement"("userId");
CREATE INDEX "ModeratorConversationMessage_communityId_createdAt_idx" ON "ModeratorConversationMessage"("communityId", "createdAt");
CREATE INDEX "ModeratorConversationMessage_expiresAt_idx" ON "ModeratorConversationMessage"("expiresAt");
CREATE UNIQUE INDEX "ModeratorConversationMessage_communityId_telegramMessageId_key" ON "ModeratorConversationMessage"("communityId", "telegramMessageId");
CREATE UNIQUE INDEX "ModeratorConversationState_communityId_key" ON "ModeratorConversationState"("communityId");

ALTER TABLE "AiModeratorEntitlement" ADD CONSTRAINT "AiModeratorEntitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModeratorConversationMessage" ADD CONSTRAINT "ModeratorConversationMessage_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModeratorConversationState" ADD CONSTRAINT "ModeratorConversationState_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
