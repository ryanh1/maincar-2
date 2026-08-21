-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "companyId" TEXT,
    "dealId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "joinUrl" TEXT,
    "conferenceProvider" TEXT,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timeZone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "organizerEmail" TEXT,
    "organizerPersonId" TEXT,
    "provider" TEXT,
    "providerEventId" TEXT,
    "iCalUid" TEXT,
    "recurringEventId" TEXT,
    "syncCursor" TEXT,
    "webLink" TEXT,
    "recordingUrl" TEXT,
    "recordingProvider" TEXT,
    "transcriptStatus" TEXT,
    "externalRecordingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAttendee" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "personId" TEXT,
    "responseStatus" TEXT NOT NULL DEFAULT 'needs_action',
    "isOrganizer" BOOLEAN NOT NULL DEFAULT false,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "isResource" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Meeting_orgId_idx" ON "Meeting"("orgId");

-- CreateIndex
CREATE INDEX "Meeting_orgId_startsAt_idx" ON "Meeting"("orgId", "startsAt");

-- CreateIndex
CREATE INDEX "Meeting_orgId_companyId_startsAt_idx" ON "Meeting"("orgId", "companyId", "startsAt");

-- CreateIndex
CREATE INDEX "Meeting_orgId_dealId_startsAt_idx" ON "Meeting"("orgId", "dealId", "startsAt");

-- CreateIndex
CREATE INDEX "Meeting_orgId_iCalUid_idx" ON "Meeting"("orgId", "iCalUid");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_orgId_provider_providerEventId_key" ON "Meeting"("orgId", "provider", "providerEventId");

-- CreateIndex
CREATE INDEX "MeetingAttendee_orgId_meetingId_idx" ON "MeetingAttendee"("orgId", "meetingId");

-- CreateIndex
CREATE INDEX "MeetingAttendee_orgId_email_idx" ON "MeetingAttendee"("orgId", "email");

-- CreateIndex
CREATE INDEX "MeetingAttendee_personId_idx" ON "MeetingAttendee"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingAttendee_meetingId_email_key" ON "MeetingAttendee"("meetingId", "email");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_organizerPersonId_fkey" FOREIGN KEY ("organizerPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
