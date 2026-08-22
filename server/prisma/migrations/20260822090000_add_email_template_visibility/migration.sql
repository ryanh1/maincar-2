-- CreateEnum
CREATE TYPE "EmailTemplateVisibility" AS ENUM ('PRIVATE', 'ORGANIZATION');

-- AlterTable
-- Existing rows were created before templates had a privacy boundary, so retain
-- their historic organization-wide behavior. New templates default private.
ALTER TABLE "EmailTemplate" ADD COLUMN "visibility" "EmailTemplateVisibility" NOT NULL DEFAULT 'ORGANIZATION';
ALTER TABLE "EmailTemplate" ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE';
