ALTER TABLE "ManagedModeratorBot" ADD COLUMN "expectedUsername" TEXT;
ALTER TABLE "ManagedModeratorBot" ADD COLUMN "tokenKeyVersion" INTEGER NOT NULL DEFAULT 1;
