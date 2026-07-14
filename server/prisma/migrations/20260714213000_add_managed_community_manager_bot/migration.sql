ALTER TABLE "CommunityManager" ADD COLUMN "executorType" TEXT NOT NULL DEFAULT 'SHARED';
ALTER TABLE "CommunityManager" ALTER COLUMN "mode" SET DEFAULT 'AUTOPILOT';

CREATE TABLE "ManagedCommunityManagerBot" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "tgBotId" TEXT,
  "username" TEXT,
  "expectedUsername" TEXT,
  "displayName" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "tokenCipher" TEXT,
  "tokenIv" TEXT,
  "tokenTag" TEXT,
  "tokenKeyVersion" INTEGER NOT NULL DEFAULT 1,
  "webhookSecret" TEXT,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "lastError" TEXT,
  "requestExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManagedCommunityManagerBot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ManagedCommunityManagerBot_communityId_key" ON "ManagedCommunityManagerBot"("communityId");
CREATE UNIQUE INDEX "ManagedCommunityManagerBot_tgBotId_key" ON "ManagedCommunityManagerBot"("tgBotId");
CREATE INDEX "ManagedCommunityManagerBot_ownerUserId_status_idx" ON "ManagedCommunityManagerBot"("ownerUserId", "status");
ALTER TABLE "ManagedCommunityManagerBot" ADD CONSTRAINT "ManagedCommunityManagerBot_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagedCommunityManagerBot" ADD CONSTRAINT "ManagedCommunityManagerBot_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "CommunityManager" SET "mode" = 'AUTOPILOT';