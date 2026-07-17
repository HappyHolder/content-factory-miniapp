-- Persona human layers: per-person memory, relationship state, inner mood.

ALTER TABLE "Persona" ADD COLUMN "personalState" JSONB;
ALTER TABLE "Persona" ADD COLUMN "conversationMemory" JSONB;

CREATE TABLE "PersonaParticipant" (
  "id" TEXT NOT NULL,
  "personaId" TEXT NOT NULL,
  "tgUserId" TEXT NOT NULL,
  "username" TEXT,
  "firstName" TEXT,
  "lastName" TEXT,
  "displayName" TEXT NOT NULL,
  "relationship" TEXT NOT NULL DEFAULT 'NEW',
  "relationshipState" JSONB,
  "notes" JSONB,
  "messageCount" INTEGER NOT NULL DEFAULT 0,
  "exchangeCount" INTEGER NOT NULL DEFAULT 0,
  "activeDayKeys" JSONB,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastExchangeAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonaParticipant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersonaParticipant_personaId_tgUserId_key" ON "PersonaParticipant"("personaId", "tgUserId");
CREATE INDEX "PersonaParticipant_personaId_relationship_lastSeenAt_idx" ON "PersonaParticipant"("personaId", "relationship", "lastSeenAt");
ALTER TABLE "PersonaParticipant" ADD CONSTRAINT "PersonaParticipant_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;
