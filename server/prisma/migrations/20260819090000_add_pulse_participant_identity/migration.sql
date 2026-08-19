-- Additive identity directory for Pulse. Historical daily facts and counters
-- remain untouched; this table only supplies human-readable participant labels.
CREATE TABLE "CommunityPulseParticipant" (
  "id"          TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "tgUserId"    TEXT NOT NULL,
  "username"    TEXT,
  "displayName" TEXT,
  "lastSeenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityPulseParticipant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityPulseParticipant_communityId_tgUserId_key"
  ON "CommunityPulseParticipant"("communityId", "tgUserId");
CREATE INDEX "CommunityPulseParticipant_communityId_username_idx"
  ON "CommunityPulseParticipant"("communityId", "username");

ALTER TABLE "CommunityPulseParticipant" ADD CONSTRAINT "CommunityPulseParticipant_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Recover identities already known by Community Manager.
INSERT INTO "CommunityPulseParticipant" ("id", "communityId", "tgUserId", "username", "displayName", "lastSeenAt", "createdAt", "updatedAt")
SELECT 'pulse_cm_' || md5(cm."communityId" || ':' || p."tgUserId"), cm."communityId", p."tgUserId",
       NULLIF(regexp_replace(COALESCE(p."username", ''), '^@', ''), ''), NULLIF(p."displayName", ''),
       p."lastSeenAt", CURRENT_TIMESTAMP, p."updatedAt"
FROM "CommunityManagerParticipant" p
JOIN "CommunityManager" cm ON cm."id" = p."communityManagerId"
ON CONFLICT ("communityId", "tgUserId") DO UPDATE SET
  "username" = COALESCE(EXCLUDED."username", "CommunityPulseParticipant"."username"),
  "displayName" = COALESCE(EXCLUDED."displayName", "CommunityPulseParticipant"."displayName"),
  "lastSeenAt" = GREATEST(EXCLUDED."lastSeenAt", "CommunityPulseParticipant"."lastSeenAt"),
  "updatedAt" = GREATEST(EXCLUDED."updatedAt", "CommunityPulseParticipant"."updatedAt");

-- Recover the newest identity still present in Moderator conversation memory.
INSERT INTO "CommunityPulseParticipant" ("id", "communityId", "tgUserId", "username", "displayName", "lastSeenAt", "createdAt", "updatedAt")
SELECT 'pulse_mod_' || md5(m."communityId" || ':' || m."tgUserId"), m."communityId", m."tgUserId",
       NULLIF(regexp_replace(COALESCE(m."username", ''), '^@', ''), ''), NULLIF(m."displayName", ''),
       m."createdAt", CURRENT_TIMESTAMP, m."createdAt"
FROM (
  SELECT DISTINCT ON ("communityId", "tgUserId") "communityId", "tgUserId", "username", "displayName", "createdAt"
  FROM "ModeratorConversationMessage"
  ORDER BY "communityId", "tgUserId", "createdAt" DESC
) m
ON CONFLICT ("communityId", "tgUserId") DO UPDATE SET
  "username" = CASE WHEN EXCLUDED."updatedAt" >= "CommunityPulseParticipant"."updatedAt" THEN COALESCE(EXCLUDED."username", "CommunityPulseParticipant"."username") ELSE "CommunityPulseParticipant"."username" END,
  "displayName" = CASE WHEN EXCLUDED."updatedAt" >= "CommunityPulseParticipant"."updatedAt" THEN COALESCE(EXCLUDED."displayName", "CommunityPulseParticipant"."displayName") ELSE "CommunityPulseParticipant"."displayName" END,
  "lastSeenAt" = GREATEST(EXCLUDED."lastSeenAt", "CommunityPulseParticipant"."lastSeenAt"),
  "updatedAt" = GREATEST(EXCLUDED."updatedAt", "CommunityPulseParticipant"."updatedAt");

-- Recover identities observed by autonomous Community Core personas.
INSERT INTO "CommunityPulseParticipant" ("id", "communityId", "tgUserId", "username", "displayName", "lastSeenAt", "createdAt", "updatedAt")
SELECT 'pulse_core_' || md5(core."communityId" || ':' || core."tgUserId"), core."communityId", core."tgUserId",
       NULLIF(regexp_replace(COALESCE(core."username", ''), '^@', ''), ''), NULLIF(core."displayName", ''),
       core."lastSeenAt", CURRENT_TIMESTAMP, core."updatedAt"
FROM (
  SELECT DISTINCT ON (persona."communityId", p."tgUserId") persona."communityId", p."tgUserId",
         p."username", p."displayName", p."lastSeenAt", p."updatedAt"
  FROM "PersonaParticipant" p
  JOIN "Persona" persona ON persona."id" = p."personaId"
  ORDER BY persona."communityId", p."tgUserId", p."updatedAt" DESC
) core
ON CONFLICT ("communityId", "tgUserId") DO UPDATE SET
  "username" = CASE WHEN EXCLUDED."updatedAt" >= "CommunityPulseParticipant"."updatedAt" THEN COALESCE(EXCLUDED."username", "CommunityPulseParticipant"."username") ELSE "CommunityPulseParticipant"."username" END,
  "displayName" = CASE WHEN EXCLUDED."updatedAt" >= "CommunityPulseParticipant"."updatedAt" THEN COALESCE(EXCLUDED."displayName", "CommunityPulseParticipant"."displayName") ELSE "CommunityPulseParticipant"."displayName" END,
  "lastSeenAt" = GREATEST(EXCLUDED."lastSeenAt", "CommunityPulseParticipant"."lastSeenAt"),
  "updatedAt" = GREATEST(EXCLUDED."updatedAt", "CommunityPulseParticipant"."updatedAt");
