-- AlterTable
ALTER TABLE "MailAccount" ADD COLUMN     "calendarSyncCursor" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "mailSyncCursor" TEXT;
