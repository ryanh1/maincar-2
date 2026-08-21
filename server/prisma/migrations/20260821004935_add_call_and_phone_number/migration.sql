-- CreateTable
CREATE TABLE "PhoneNumber" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "assignedUserId" TEXT NOT NULL,
    "e164" TEXT NOT NULL,
    "twilioSid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'searching',
    "isActiveForOutbound" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromE164" TEXT NOT NULL,
    "toE164" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "twilioCallSid" TEXT,
    "recordingConsent" TEXT,
    "recordingEnabled" BOOLEAN,
    "recordingUrl" TEXT,
    "transcriptStatus" TEXT NOT NULL DEFAULT 'pending',
    "transcript" TEXT,
    "durationS" INTEGER,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhoneNumber_orgId_idx" ON "PhoneNumber"("orgId");

-- CreateIndex
CREATE INDEX "PhoneNumber_assignedUserId_idx" ON "PhoneNumber"("assignedUserId");

-- CreateIndex
CREATE INDEX "PhoneNumber_e164_idx" ON "PhoneNumber"("e164");

-- CreateIndex
CREATE UNIQUE INDEX "Call_twilioCallSid_key" ON "Call"("twilioCallSid");

-- CreateIndex
CREATE INDEX "Call_orgId_idx" ON "Call"("orgId");

-- CreateIndex
CREATE INDEX "Call_userId_idx" ON "Call"("userId");

-- CreateIndex
CREATE INDEX "Call_toE164_idx" ON "Call"("toE164");

-- CreateIndex
CREATE INDEX "Call_createdAt_idx" ON "Call"("createdAt");

-- AddForeignKey
ALTER TABLE "PhoneNumber" ADD CONSTRAINT "PhoneNumber_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneNumber" ADD CONSTRAINT "PhoneNumber_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
