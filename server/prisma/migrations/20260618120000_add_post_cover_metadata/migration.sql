-- Persist the actual cover engine and aspect ratio used for each post.
-- Existing posts remain nullable and use the channel-style fallback in code.
ALTER TABLE "GeneratedPost"
ADD COLUMN "coverMode" TEXT,
ADD COLUMN "coverAspectRatio" TEXT;
