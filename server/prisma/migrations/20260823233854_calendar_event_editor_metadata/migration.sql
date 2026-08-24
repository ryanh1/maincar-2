-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "availability" TEXT NOT NULL DEFAULT 'busy',
ADD COLUMN     "meetingLink" TEXT,
ADD COLUMN     "meetingLinkOverride" TEXT,
ADD COLUMN     "privacy" TEXT NOT NULL DEFAULT 'default',
ADD COLUMN     "timeZoneOverride" TEXT;

-- AlterTable
ALTER TABLE "RecordLink" ADD COLUMN     "calendarEventId" TEXT;

-- CreateIndex
CREATE INDEX "RecordLink_orgId_calendarEventId_idx" ON "RecordLink"("orgId", "calendarEventId");

-- AddForeignKey
ALTER TABLE "RecordLink" ADD CONSTRAINT "RecordLink_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
