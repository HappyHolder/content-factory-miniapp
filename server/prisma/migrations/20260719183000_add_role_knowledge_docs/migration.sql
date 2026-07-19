CREATE TABLE "RoleKnowledgeDoc" (
  "id" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoleKnowledgeDoc_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RoleKnowledgeDoc_targetType_targetId_idx" ON "RoleKnowledgeDoc"("targetType", "targetId");
CREATE INDEX "RoleKnowledgeDoc_ownerUserId_idx" ON "RoleKnowledgeDoc"("ownerUserId");
