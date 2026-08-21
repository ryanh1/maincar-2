-- CreateTable
CREATE TABLE "VoicemailGreeting" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "audioUrl" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoicemailGreeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voicemail" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "callSid" TEXT NOT NULL,
    "fromE164" TEXT NOT NULL,
    "toE164" TEXT NOT NULL,
    "greeting" TEXT,
    "recordingUrl" TEXT,
    "transcriptStatus" TEXT NOT NULL DEFAULT 'pending',
    "transcript" TEXT,
    "durationS" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Voicemail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoicemailGreeting_orgId_key" ON "VoicemailGreeting"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Voicemail_callSid_key" ON "Voicemail"("callSid");

-- CreateIndex
CREATE INDEX "Voicemail_orgId_idx" ON "Voicemail"("orgId");

-- CreateIndex
CREATE INDEX "Voicemail_orgId_createdAt_idx" ON "Voicemail"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "VoicemailGreeting" ADD CONSTRAINT "VoicemailGreeting_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voicemail" ADD CONSTRAINT "Voicemail_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
