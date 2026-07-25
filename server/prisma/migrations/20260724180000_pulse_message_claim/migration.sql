-- Dedup for Pulse collection. The moderator webhook, the CM webhook and the
-- GramJS personas can each observe the same chat message; without a claim the
-- same message would be counted up to three times. First writer wins.
CREATE TABLE "PulseMessageClaim" (
  "id"                TEXT NOT NULL,
  "communityId"       TEXT NOT NULL,
  "telegramMessageId" INTEGER NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PulseMessageClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PulseMessageClaim_communityId_telegramMessageId_key"
  ON "PulseMessageClaim"("communityId", "telegramMessageId");
CREATE INDEX "PulseMessageClaim_createdAt_idx" ON "PulseMessageClaim"("createdAt");
