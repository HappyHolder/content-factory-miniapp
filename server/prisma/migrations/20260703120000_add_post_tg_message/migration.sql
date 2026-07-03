-- Track the published Telegram message so a post can be edited in place
-- (5-hour re-publish window) instead of only re-sent.
ALTER TABLE "GeneratedPost" ADD COLUMN "tgChatId" TEXT;
ALTER TABLE "GeneratedPost" ADD COLUMN "tgMessageId" INTEGER;
