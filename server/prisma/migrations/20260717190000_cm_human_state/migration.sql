ALTER TABLE "CommunityManagerConversationState"
ADD COLUMN "episodes" JSONB,
ADD COLUMN "internalState" JSONB,
ADD COLUMN "attentionQueue" JSONB;
