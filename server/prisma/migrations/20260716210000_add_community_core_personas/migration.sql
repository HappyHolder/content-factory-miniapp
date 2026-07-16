-- Community Core: autonomous AI personalities on owner Telegram accounts.

CREATE TABLE "Persona" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "sessionCipher" TEXT,
  "sessionIv" TEXT,
  "sessionTag" TEXT,
  "sessionKeyVersion" INTEGER NOT NULL DEFAULT 1,
  "tgUserId" TEXT,
  "username" TEXT,
  "phone" TEXT,
  "loginPhoneCodeHash" TEXT,
  "loginTempSession" TEXT,
  "loginExpiresAt" TIMESTAMP(3),
  "draftConfig" JSONB NOT NULL,
  "publishedConfig" JSONB,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "lastError" TEXT,
  "lastActionAt" TIMESTAMP(3),
  "lastHealthyAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Persona_communityId_idx" ON "Persona"("communityId");
CREATE INDEX "Persona_ownerUserId_idx" ON "Persona"("ownerUserId");
CREATE INDEX "Persona_status_enabled_idx" ON "Persona"("status", "enabled");
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PersonaAction" (
  "id" TEXT NOT NULL,
  "personaId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "intent" TEXT,
  "reason" TEXT,
  "response" TEXT,
  "reaction" TEXT,
  "targetMessageId" INTEGER,
  "sentMessageId" INTEGER,
  "model" TEXT,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "latencyMs" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonaAction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PersonaAction_personaId_createdAt_idx" ON "PersonaAction"("personaId", "createdAt");
ALTER TABLE "PersonaAction" ADD CONSTRAINT "PersonaAction_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PersonaMemory" (
  "id" TEXT NOT NULL,
  "personaId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'observation',
  "text" TEXT NOT NULL,
  "importance" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonaMemory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PersonaMemory_personaId_createdAt_idx" ON "PersonaMemory"("personaId", "createdAt");
ALTER TABLE "PersonaMemory" ADD CONSTRAINT "PersonaMemory_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PersonaMessageClaim" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "telegramMessageId" INTEGER NOT NULL,
  "personaId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonaMessageClaim_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersonaMessageClaim_communityId_telegramMessageId_key" ON "PersonaMessageClaim"("communityId", "telegramMessageId");
CREATE INDEX "PersonaMessageClaim_createdAt_idx" ON "PersonaMessageClaim"("createdAt");
