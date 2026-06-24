-- Styles market: curated cover-style packs + per-user ownership.

-- CreateTable
CREATE TABLE "Style" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "descRu" TEXT NOT NULL DEFAULT '',
    "descEn" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priceKind" TEXT NOT NULL DEFAULT 'FREE',
    "priceStars" INTEGER,
    "priceGram" DOUBLE PRECISION,
    "brandAdaptive" BOOLEAN NOT NULL DEFAULT true,
    "recommendedMode" TEXT NOT NULL DEFAULT 'html',
    "palette" JSONB NOT NULL DEFAULT '[]',
    "visualCoverStyle" TEXT NOT NULL DEFAULT '',
    "bgStyle" TEXT,
    "bgDetail" TEXT,
    "fontPreset" TEXT,
    "logoUsage" TEXT,
    "templates" JSONB NOT NULL DEFAULT '[]',
    "previews" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "heroPreview" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Style_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StylePurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StylePurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Style_slug_key" ON "Style"("slug");

-- CreateIndex
CREATE INDEX "Style_published_sortOrder_idx" ON "Style"("published", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "StylePurchase_txHash_key" ON "StylePurchase"("txHash");

-- CreateIndex
CREATE INDEX "StylePurchase_userId_idx" ON "StylePurchase"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StylePurchase_userId_styleId_key" ON "StylePurchase"("userId", "styleId");

-- AddForeignKey
ALTER TABLE "StylePurchase" ADD CONSTRAINT "StylePurchase_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;
