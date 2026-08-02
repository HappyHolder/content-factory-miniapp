-- Preserve evidence excerpts after short-lived raw chat messages expire.
ALTER TABLE "CommunityManagerParticipantClaimEvidence" DROP CONSTRAINT "CommunityManagerParticipantClaimEvidence_messageId_fkey";
ALTER TABLE "CommunityManagerParticipantClaimEvidence" ALTER COLUMN "messageId" DROP NOT NULL;
ALTER TABLE "CommunityManagerParticipantClaimEvidence" ADD CONSTRAINT "CommunityManagerParticipantClaimEvidence_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunityManagerMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Keep existing SDK session records for audit, but seed their summaries from the authoritative graph.
UPDATE "CommunityManagerAgentSession" AS session SET "summary" = segment."summary" FROM "CommunityManagerSegment" AS segment WHERE session."segmentId" = segment."id" AND session."summary" = '';

-- Adopt any retained pre-graph root messages without overwriting already-linked conversations.
INSERT INTO "CommunityManagerThread" ("id","communityManagerId","tgChatId","telegramRootMessageId","messageThreadId","origin","status","version","createdAt","updatedAt")
SELECT 'backfill_thread_'||substr(md5(m."communityManagerId"||':'||m."tgChatId"||':'||COALESCE(m."messageThreadId",m."telegramMessageId")::text),1,24),m."communityManagerId",m."tgChatId",COALESCE(m."messageThreadId",m."telegramMessageId"),COALESCE(m."messageThreadId",m."telegramMessageId"),'HUMAN','IDLE',1,min(m."createdAt"),max(m."updatedAt") FROM "CommunityManagerMessage" m WHERE m."threadId" IS NULL AND m."replyToMessageId" IS NULL GROUP BY m."communityManagerId",m."tgChatId",COALESCE(m."messageThreadId",m."telegramMessageId")
ON CONFLICT ("communityManagerId","tgChatId","telegramRootMessageId") DO NOTHING;
INSERT INTO "CommunityManagerSegment" ("id","communityManagerId","threadId","topicKey","summary","status","version","lastMeaningfulTurnAt","createdAt","updatedAt")
SELECT 'backfill_segment_'||substr(md5(t."id"),1,24),t."communityManagerId",t."id",'conversation','Retained conversation before unified runtime','RESOLVED',1,t."updatedAt",t."createdAt",t."updatedAt" FROM "CommunityManagerThread" t WHERE NOT EXISTS (SELECT 1 FROM "CommunityManagerSegment" s WHERE s."threadId"=t."id");
UPDATE "CommunityManagerMessage" m SET "threadId"=t."id","segmentId"=s."id","messageThreadId"=t."telegramRootMessageId" FROM "CommunityManagerThread" t JOIN "CommunityManagerSegment" s ON s."threadId"=t."id" WHERE m."threadId" IS NULL AND m."communityManagerId"=t."communityManagerId" AND m."tgChatId"=t."tgChatId" AND COALESCE(m."messageThreadId",m."telegramMessageId")=t."telegramRootMessageId";


-- Follow reply chains so retained non-root messages join the same recovered branch.
WITH RECURSIVE linked AS (
  SELECT m."id",m."communityManagerId",m."tgChatId",m."telegramMessageId",m."threadId",m."segmentId" FROM "CommunityManagerMessage" m WHERE m."threadId" IS NOT NULL
  UNION ALL
  SELECT child."id",child."communityManagerId",child."tgChatId",child."telegramMessageId",parent."threadId",parent."segmentId" FROM "CommunityManagerMessage" child JOIN linked parent ON child."communityManagerId"=parent."communityManagerId" AND child."tgChatId"=parent."tgChatId" AND child."replyToMessageId"=parent."telegramMessageId" WHERE child."threadId" IS NULL
)
UPDATE "CommunityManagerMessage" m SET "threadId"=linked."threadId","segmentId"=linked."segmentId" FROM linked WHERE m."id"=linked."id" AND m."threadId" IS NULL;

-- Recover action graph pointers from their source messages without changing audit history.
UPDATE "CommunityManagerAction" action SET "threadId"=message."threadId","segmentId"=message."segmentId" FROM "CommunityManagerMessage" message WHERE action."messageId"=message."id" AND action."threadId" IS NULL AND message."threadId" IS NOT NULL;
