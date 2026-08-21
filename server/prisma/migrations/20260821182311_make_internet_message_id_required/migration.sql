/*
  Warnings:

  - Made the column `internetMessageId` on table `Email` required. This step will fail if there are existing NULL values in that column.

*/
-- First, generate synthetic RFC5322 Message-IDs for any existing NULL values.
-- Format: <generated-{id}@maincar.local>
UPDATE "Email"
SET "internetMessageId" = '<generated-' || "id" || '@maincar.local>'
WHERE "internetMessageId" IS NULL;

-- AlterTable
ALTER TABLE "Email" ALTER COLUMN "internetMessageId" SET NOT NULL;
