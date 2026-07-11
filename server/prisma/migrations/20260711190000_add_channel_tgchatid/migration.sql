-- AlterTable: stable numeric Telegram chat id so publishing survives channel renames.
ALTER TABLE "Channel" ADD COLUMN "tgChatId" TEXT;
