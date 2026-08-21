-- AlterTable
ALTER TABLE "EmailDraft" ADD COLUMN     "recordObject" TEXT;

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_mailAccountId_fkey" FOREIGN KEY ("mailAccountId") REFERENCES "MailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
