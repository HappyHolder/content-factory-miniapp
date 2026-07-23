ALTER TABLE "GeneratedPost"
ADD COLUMN "editorMode" TEXT NOT NULL DEFAULT 'LEGACY';

UPDATE "GeneratedPost" AS post
SET "editorMode" = 'RICH'
WHERE post."sourceType" = 'manual'
   OR EXISTS (
     SELECT 1
     FROM "PostVariant" AS variant
     WHERE variant."generatedPostId" = post."id"
       AND variant."blocks" IS NOT NULL
   );

ALTER TABLE "GeneratedPost"
ALTER COLUMN "editorMode" SET DEFAULT 'RICH';
