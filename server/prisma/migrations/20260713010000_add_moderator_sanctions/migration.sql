ALTER TABLE "CommunityMember"
  ADD COLUMN "muteUntil" TIMESTAMP(3),
  ADD COLUMN "bannedAt" TIMESTAMP(3);

CREATE INDEX "CommunityMember_communityId_muteUntil_idx"
  ON "CommunityMember"("communityId", "muteUntil");
