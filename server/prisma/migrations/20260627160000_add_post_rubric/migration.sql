-- Persist the rubric a post was classified into (id + denormalized name for the
-- post chip). Existing posts remain null (legacy / no rubric).
ALTER TABLE "GeneratedPost"
ADD COLUMN "rubricId" TEXT,
ADD COLUMN "rubricName" TEXT;
