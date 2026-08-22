/*
  Warnings:

  - A unique constraint covering the columns `[defaultForNewUser]` on the table `EmailSignature` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[defaultForReplyUser]` on the table `EmailSignature` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "EmailSignature" ADD COLUMN     "defaultForNewUser" TEXT,
ADD COLUMN     "defaultForReplyUser" TEXT,
ADD COLUMN     "isDefaultForNew" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isDefaultForReply" BOOLEAN NOT NULL DEFAULT false;

-- Existing reps configured one default for every message context. Preserve that
-- choice in both new fields before the new uniqueness constraints are added.
UPDATE "EmailSignature"
SET
  "isDefaultForNew" = "isDefault",
  "defaultForNewUser" = "defaultForUser",
  "isDefaultForReply" = "isDefault",
  "defaultForReplyUser" = "defaultForUser";

-- CreateIndex
CREATE UNIQUE INDEX "EmailSignature_defaultForNewUser_key" ON "EmailSignature"("defaultForNewUser");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSignature_defaultForReplyUser_key" ON "EmailSignature"("defaultForReplyUser");
