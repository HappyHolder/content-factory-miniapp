ALTER TABLE "Channel"
ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CHANNEL';

CREATE INDEX "Channel_userId_kind_idx" ON "Channel"("userId", "kind");
