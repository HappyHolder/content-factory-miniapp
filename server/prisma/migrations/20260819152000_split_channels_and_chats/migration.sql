-- Introduce first-class Telegram chats without deleting legacy channel-backed
-- communities. The old records remain available for rollback and audit.
CREATE TABLE "Chat" (
  "id" TEXT NOT NULL,
  "tgChatId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "username" TEXT,
  "type" TEXT NOT NULL DEFAULT 'supergroup',
  "telegramMemberCount" INTEGER,
  "memberCountUpdatedAt" TIMESTAMP(3),
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Chat_tgChatId_key" ON "Chat"("tgChatId");
CREATE INDEX "Chat_userId_idx" ON "Chat"("userId");
CREATE INDEX "Chat_userId_createdAt_idx" ON "Chat"("userId", "createdAt");
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChatStyle" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "channelAbout" JSONB,
  "voiceProfile" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatStyle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatStyle_chatId_key" ON "ChatStyle"("chatId");
ALTER TABLE "ChatStyle" ADD CONSTRAINT "ChatStyle_chatId_fkey"
  FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChannelChatLink" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "relationType" TEXT NOT NULL DEFAULT 'MANUAL',
  "isPrimary" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChannelChatLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChannelChatLink_channelId_chatId_key" ON "ChannelChatLink"("channelId", "chatId");
CREATE INDEX "ChannelChatLink_chatId_idx" ON "ChannelChatLink"("chatId");
CREATE INDEX "ChannelChatLink_channelId_isPrimary_idx" ON "ChannelChatLink"("channelId", "isPrimary");
ALTER TABLE "ChannelChatLink" ADD CONSTRAINT "ChannelChatLink_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelChatLink" ADD CONSTRAINT "ChannelChatLink_chatId_fkey"
  FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Community" ADD COLUMN "chatId" TEXT;
ALTER TABLE "Community" ALTER COLUMN "channelId" DROP NOT NULL;
DROP INDEX IF EXISTS "Community_chatId_key";
CREATE UNIQUE INDEX "Community_chatId_key" ON "Community"("chatId");
ALTER TABLE "Community" DROP CONSTRAINT IF EXISTS "Community_channelId_fkey";
ALTER TABLE "Community" ADD CONSTRAINT "Community_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Community" ADD CONSTRAINT "Community_chatId_fkey"
  FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every connected ModeratorChat becomes one canonical Chat. Ownership comes
-- from the existing community/channel or, for not-yet-connected groups, from
-- the Telegram account that added the bot.
INSERT INTO "Chat" (
  "id", "tgChatId", "title", "username", "type", "telegramMemberCount",
  "memberCountUpdatedAt", "userId", "createdAt", "updatedAt"
)
SELECT
  mc."id", mc."tgChatId", mc."title", mc."username", mc."type",
  legacy."telegramMemberCount", legacy."memberCountUpdatedAt",
  COALESCE(owner_channel."userId", owner_by_telegram."id"),
  mc."createdAt", mc."updatedAt"
FROM "ModeratorChat" mc
LEFT JOIN "Community" community ON community."moderatorChatId" = mc."id"
LEFT JOIN "Channel" owner_channel ON owner_channel."id" = community."channelId"
LEFT JOIN "User" owner_by_telegram ON owner_by_telegram."telegramId" = mc."addedByTgId"
LEFT JOIN "Channel" legacy ON legacy."tgChatId" = mc."tgChatId" AND legacy."kind" = 'CHAT'
WHERE COALESCE(owner_channel."userId", owner_by_telegram."id") IS NOT NULL
ON CONFLICT ("tgChatId") DO UPDATE SET
  "title" = EXCLUDED."title",
  "username" = EXCLUDED."username",
  "type" = EXCLUDED."type",
  "updatedAt" = EXCLUDED."updatedAt";

UPDATE "Community" community
SET "chatId" = chat."id"
FROM "ModeratorChat" mc
JOIN "Chat" chat ON chat."tgChatId" = mc."tgChatId"
WHERE community."moderatorChatId" = mc."id";

-- Preserve standalone chat style as independent ChatStyle data.
INSERT INTO "ChatStyle" ("id", "chatId", "channelAbout", "voiceProfile", "createdAt", "updatedAt")
SELECT
  'migrated_style_' || community."id", community."chatId",
  brand."channelAbout", brand."voiceProfile", brand."createdAt", brand."updatedAt"
FROM "Community" community
JOIN "Channel" channel ON channel."id" = community."channelId" AND channel."kind" = 'CHAT'
JOIN "BrandKit" brand ON brand."channelId" = channel."id"
WHERE community."chatId" IS NOT NULL
ON CONFLICT ("chatId") DO NOTHING;

-- Existing real channel + discussion group pairs become explicit optional links.
INSERT INTO "ChannelChatLink" ("id", "channelId", "chatId", "relationType", "isPrimary")
SELECT
  'migrated_link_' || community."id", community."channelId", community."chatId",
  'TELEGRAM_DISCUSSION', true
FROM "Community" community
JOIN "Channel" channel ON channel."id" = community."channelId" AND channel."kind" = 'CHANNEL'
WHERE community."chatId" IS NOT NULL
ON CONFLICT ("channelId", "chatId") DO NOTHING;

-- Standalone communities no longer belong to a fake publication channel. The
-- legacy Channel and BrandKit rows are intentionally retained, orphaned, for a
-- safe rollback; they are no longer returned by application APIs.
UPDATE "Community" community
SET "channelId" = NULL
FROM "Channel" channel
WHERE community."channelId" = channel."id" AND channel."kind" = 'CHAT';
