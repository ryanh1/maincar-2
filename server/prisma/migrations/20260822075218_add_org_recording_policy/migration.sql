-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "destinationState" TEXT,
ADD COLUMN     "recordingPlanned" BOOLEAN,
ADD COLUMN     "recordingReason" TEXT;

-- AlterTable
ALTER TABLE "Org" ADD COLUMN     "blockTwoPartyConsentStates" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "recordCalls" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "recordingAllowedStates" TEXT[] DEFAULT ARRAY[]::TEXT[];
