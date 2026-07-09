-- One universal carousel-slide template per style pack, stored separately from
-- the per-rubric templates.
ALTER TABLE "Style" ADD COLUMN "carouselTemplate" JSONB;
