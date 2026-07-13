ALTER TABLE "Moderator" ADD COLUMN "executorType" TEXT NOT NULL DEFAULT 'SHARED';

CREATE TABLE "ManagedModeratorBot" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "tgBotId" TEXT,
    "username" TEXT,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "tokenCipher" TEXT,
    "tokenIv" TEXT,
    "tokenTag" TEXT,
    "webhookSecret" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "lastError" TEXT,
    "requestExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedModeratorBot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManagedModeratorBot_communityId_key" ON "ManagedModeratorBot"("communityId");
CREATE UNIQUE INDEX "ManagedModeratorBot_tgBotId_key" ON "ManagedModeratorBot"("tgBotId");
CREATE INDEX "ManagedModeratorBot_ownerUserId_status_idx" ON "ManagedModeratorBot"("ownerUserId", "status");

ALTER TABLE "ManagedModeratorBot" ADD CONSTRAINT "ManagedModeratorBot_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagedModeratorBot" ADD CONSTRAINT "ManagedModeratorBot_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;