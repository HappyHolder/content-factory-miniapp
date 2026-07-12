-- Publium Moderator v1 foundation. No moderation actions are enabled by this migration.

CREATE TABLE "ModeratorChat" (
  "id" TEXT NOT NULL,
  "tgChatId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "username" TEXT,
  "type" TEXT NOT NULL,
  "botStatus" TEXT NOT NULL,
  "grantedRights" JSONB,
  "addedByTgId" TEXT,
  "lastUpdateId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModeratorChat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModeratorChat_tgChatId_key" ON "ModeratorChat"("tgChatId");
CREATE INDEX "ModeratorChat_addedByTgId_idx" ON "ModeratorChat"("addedByTgId");

CREATE TABLE "Community" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "moderatorChatId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Community_channelId_key" ON "Community"("channelId");
CREATE UNIQUE INDEX "Community_moderatorChatId_key" ON "Community"("moderatorChatId");

CREATE TABLE "Moderator" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "draftVersion" INTEGER NOT NULL DEFAULT 1,
  "publishedVersion" INTEGER,
  "requiredRights" JSONB,
  "grantedRights" JSONB,
  "lastRightsCheckAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Moderator_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Moderator_communityId_key" ON "Moderator"("communityId");

CREATE TABLE "ModeratorConfig" (
  "id" TEXT NOT NULL,
  "moderatorId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "blocks" JSONB NOT NULL,
  "rules" JSONB,
  "createdById" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModeratorConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModeratorConfig_moderatorId_version_key" ON "ModeratorConfig"("moderatorId", "version");
CREATE INDEX "ModeratorConfig_moderatorId_status_idx" ON "ModeratorConfig"("moderatorId", "status");

CREATE TABLE "CommunityMember" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "tgUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "trusted" BOOLEAN NOT NULL DEFAULT false,
  "captchaStatus" TEXT,
  "captchaDeadline" TIMESTAMP(3),
  "joinedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityMember_communityId_tgUserId_key" ON "CommunityMember"("communityId", "tgUserId");
CREATE INDEX "CommunityMember_communityId_status_idx" ON "CommunityMember"("communityId", "status");

CREATE TABLE "ModerationWarning" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "tgUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "eventId" TEXT,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModerationWarning_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ModerationWarning_communityId_tgUserId_createdAt_idx" ON "ModerationWarning"("communityId", "tgUserId", "createdAt");

CREATE TABLE "ModerationEvent" (
  "id" TEXT NOT NULL,
  "communityId" TEXT,
  "telegramUpdateId" TEXT NOT NULL,
  "telegramMessageId" INTEGER,
  "tgUserId" TEXT,
  "blockId" TEXT,
  "eventType" TEXT NOT NULL,
  "decision" TEXT,
  "confidence" DOUBLE PRECISION,
  "reason" TEXT,
  "action" TEXT,
  "status" TEXT NOT NULL,
  "model" TEXT,
  "promptVersion" TEXT,
  "metadata" JSONB,
  "reversedAt" TIMESTAMP(3),
  "reversedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModerationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModerationEvent_telegramUpdateId_key" ON "ModerationEvent"("telegramUpdateId");
CREATE INDEX "ModerationEvent_communityId_createdAt_idx" ON "ModerationEvent"("communityId", "createdAt");

ALTER TABLE "Community" ADD CONSTRAINT "Community_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Community" ADD CONSTRAINT "Community_moderatorChatId_fkey" FOREIGN KEY ("moderatorChatId") REFERENCES "ModeratorChat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Moderator" ADD CONSTRAINT "Moderator_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModeratorConfig" ADD CONSTRAINT "ModeratorConfig_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "Moderator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModerationWarning" ADD CONSTRAINT "ModerationWarning_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModerationEvent" ADD CONSTRAINT "ModerationEvent_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;
