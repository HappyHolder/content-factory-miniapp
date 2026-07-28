CREATE TABLE "CommunityManagerAgentSession" (
    "id" TEXT NOT NULL,
    "communityManagerId" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "threadId" TEXT,
    "segmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "runtimeVersion" TEXT NOT NULL DEFAULT 'community-agent-v1',
    "summary" TEXT NOT NULL DEFAULT '',
    "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommunityManagerAgentSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityManagerAgentSessionItem" (
    "id" BIGSERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "item" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommunityManagerAgentSessionItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityManagerAgentEvent" (
    "id" TEXT NOT NULL,
    "communityManagerId" TEXT NOT NULL,
    "sessionId" TEXT,
    "dedupeKey" TEXT,
    "kind" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "activityId" TEXT,
    "threadId" TEXT,
    "segmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "runtimeVersion" TEXT NOT NULL DEFAULT 'community-agent-v1',
    "payload" JSONB NOT NULL,
    "decision" JSONB,
    "references" JSONB,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "researchCalls" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommunityManagerAgentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityManagerAgentSession_communityManagerId_sessionKey_key" ON "CommunityManagerAgentSession"("communityManagerId", "sessionKey");
CREATE INDEX "CommunityManagerAgentSession_communityManagerId_status_lastEventAt_idx" ON "CommunityManagerAgentSession"("communityManagerId", "status", "lastEventAt");
CREATE INDEX "CommunityManagerAgentSession_threadId_segmentId_idx" ON "CommunityManagerAgentSession"("threadId", "segmentId");
CREATE INDEX "CommunityManagerAgentSessionItem_sessionId_id_idx" ON "CommunityManagerAgentSessionItem"("sessionId", "id");
CREATE UNIQUE INDEX "CommunityManagerAgentEvent_dedupeKey_key" ON "CommunityManagerAgentEvent"("dedupeKey");
CREATE INDEX "CommunityManagerAgentEvent_communityManagerId_createdAt_idx" ON "CommunityManagerAgentEvent"("communityManagerId", "createdAt");
CREATE INDEX "CommunityManagerAgentEvent_sessionId_createdAt_idx" ON "CommunityManagerAgentEvent"("sessionId", "createdAt");
CREATE INDEX "CommunityManagerAgentEvent_status_createdAt_idx" ON "CommunityManagerAgentEvent"("status", "createdAt");

ALTER TABLE "CommunityManagerAgentSession" ADD CONSTRAINT "CommunityManagerAgentSession_communityManagerId_fkey" FOREIGN KEY ("communityManagerId") REFERENCES "CommunityManager"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityManagerAgentSessionItem" ADD CONSTRAINT "CommunityManagerAgentSessionItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CommunityManagerAgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityManagerAgentEvent" ADD CONSTRAINT "CommunityManagerAgentEvent_communityManagerId_fkey" FOREIGN KEY ("communityManagerId") REFERENCES "CommunityManager"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityManagerAgentEvent" ADD CONSTRAINT "CommunityManagerAgentEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CommunityManagerAgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
