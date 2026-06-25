-- Structured formatted-post layout (PostBlock[]) per variant. null = legacy plain.
ALTER TABLE "PostVariant" ADD COLUMN "blocks" JSONB;
