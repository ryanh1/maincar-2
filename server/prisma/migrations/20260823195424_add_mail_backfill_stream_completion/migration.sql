-- AlterTable
ALTER TABLE "MailBackfill" ADD COLUMN     "eventsComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "messagesComplete" BOOLEAN NOT NULL DEFAULT false;
