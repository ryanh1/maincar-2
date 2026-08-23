-- CreateTable
CREATE TABLE "CalendarSource" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerCalendarId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "timeZone" TEXT,
    "accessRole" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "syncCursor" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "providerVersion" TEXT,
    "iCalUid" TEXT,
    "title" TEXT,
    "description" TEXT,
    "location" TEXT,
    "webLink" TEXT,
    "kind" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timeZone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "cancelledAt" TIMESTAMP(3),
    "recurrenceKind" TEXT NOT NULL DEFAULT 'none',
    "providerSeriesId" TEXT,
    "recurrenceRule" TEXT,
    "originalStartAt" TIMESTAMP(3),
    "originalStartDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventAttendee" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "isResource" BOOLEAN NOT NULL DEFAULT false,
    "response" TEXT NOT NULL DEFAULT 'needs-action',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEventAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarSource_orgId_userId_connectionId_idx" ON "CalendarSource"("orgId", "userId", "connectionId");

-- CreateIndex
CREATE INDEX "CalendarSource_orgId_userId_isPrimary_isSelected_idx" ON "CalendarSource"("orgId", "userId", "isPrimary", "isSelected");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarSource_connectionId_providerCalendarId_key" ON "CalendarSource"("connectionId", "providerCalendarId");

-- CreateIndex
CREATE INDEX "CalendarEvent_orgId_userId_connectionId_idx" ON "CalendarEvent"("orgId", "userId", "connectionId");

-- CreateIndex
CREATE INDEX "CalendarEvent_orgId_userId_startsAt_idx" ON "CalendarEvent"("orgId", "userId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_sourceId_providerEventId_key" ON "CalendarEvent"("sourceId", "providerEventId");

-- CreateIndex
CREATE INDEX "CalendarEventAttendee_orgId_userId_connectionId_idx" ON "CalendarEventAttendee"("orgId", "userId", "connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventAttendee_eventId_email_key" ON "CalendarEventAttendee"("eventId", "email");

-- AddForeignKey
ALTER TABLE "CalendarSource" ADD CONSTRAINT "CalendarSource_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarSource" ADD CONSTRAINT "CalendarSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarSource" ADD CONSTRAINT "CalendarSource_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "OAuthConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "OAuthConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CalendarSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventAttendee" ADD CONSTRAINT "CalendarEventAttendee_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventAttendee" ADD CONSTRAINT "CalendarEventAttendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventAttendee" ADD CONSTRAINT "CalendarEventAttendee_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "OAuthConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventAttendee" ADD CONSTRAINT "CalendarEventAttendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
