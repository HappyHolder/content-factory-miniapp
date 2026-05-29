-- AlterTable: drop the emojiPack column from BrandKit.
-- The column is nullable (Json?) so existing rows are unaffected except for
-- the 1 non-null row that will lose its emojiPack data (intentional: emoji
-- feature is being fully removed).
ALTER TABLE "BrandKit" DROP COLUMN IF EXISTS "emojiPack";
