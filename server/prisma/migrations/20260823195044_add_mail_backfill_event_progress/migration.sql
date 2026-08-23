-- AlterTable
ALTER TABLE "MailBackfill" ADD COLUMN     "eventCursor" TEXT,
ADD COLUMN     "eventsScannedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "meetingsMatchedCount" INTEGER NOT NULL DEFAULT 0;
