-- AlterTable
ALTER TABLE "CallSpeaker" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "CallSpeaker_orgId_userId_idx" ON "CallSpeaker"("orgId", "userId");

-- AddForeignKey
ALTER TABLE "CallSpeaker" ADD CONSTRAINT "CallSpeaker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
