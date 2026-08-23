-- AlterTable
ALTER TABLE "PhoneNumber" ADD COLUMN     "callerName" TEXT,
ADD COLUMN     "callerNameStatus" TEXT NOT NULL DEFAULT 'not_requested',
ADD COLUMN     "isCallerNameRequested" BOOLEAN NOT NULL DEFAULT false;
