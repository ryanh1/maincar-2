-- CreateTable
CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "plainText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "speakerKey" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "words" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSpeaker" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "speakerKey" TEXT NOT NULL,
    "displayName" TEXT,
    "source" TEXT NOT NULL,
    "evidence" JSONB,
    "confidence" DOUBLE PRECISION,
    "personId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallSpeaker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_callId_key" ON "Transcript"("callId");

-- CreateIndex
CREATE INDEX "Transcript_orgId_idx" ON "Transcript"("orgId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_orgId_idx" ON "TranscriptSegment"("orgId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_transcriptId_speakerKey_idx" ON "TranscriptSegment"("transcriptId", "speakerKey");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptSegment_transcriptId_position_key" ON "TranscriptSegment"("transcriptId", "position");

-- CreateIndex
CREATE INDEX "CallSpeaker_orgId_idx" ON "CallSpeaker"("orgId");

-- CreateIndex
CREATE INDEX "CallSpeaker_orgId_personId_idx" ON "CallSpeaker"("orgId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "CallSpeaker_callId_speakerKey_key" ON "CallSpeaker"("callId", "speakerKey");

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSpeaker" ADD CONSTRAINT "CallSpeaker_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSpeaker" ADD CONSTRAINT "CallSpeaker_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSpeaker" ADD CONSTRAINT "CallSpeaker_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve every historic flat transcript as a final legacy pass. There are no
-- trustworthy timings or speakers in the old string, so it intentionally gets
-- no TranscriptSegment or CallSpeaker rows. The deterministic id makes this
-- migration repeatable against a restored database without needing an extension.
INSERT INTO "Transcript" ("id", "orgId", "callId", "provider", "plainText", "createdAt", "updatedAt")
SELECT
    'legacy-transcript-' || "id",
    "orgId",
    "id",
    'legacy',
    "transcript",
    "createdAt",
    "updatedAt"
FROM "Call"
WHERE "transcript" IS NOT NULL;
