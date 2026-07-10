-- AlterTable: showcase-only styles are visible to everyone but applicable by admins only.
ALTER TABLE "Style" ADD COLUMN "showcaseOnly" BOOLEAN NOT NULL DEFAULT false;
