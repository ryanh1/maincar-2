-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "batchKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "deliveryMode" TEXT NOT NULL DEFAULT 'immediate',
ADD COLUMN     "objectIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Notification_orgId_recipientUserId_batchKey_createdAt_idx" ON "Notification"("orgId", "recipientUserId", "batchKey", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_orgId_recipientUserId_deliveryMode_createdAt_idx" ON "Notification"("orgId", "recipientUserId", "deliveryMode", "createdAt");

-- Backfill existing single-object inbox rows so the read aggregation work can
-- treat historical and newly-written notifications uniformly.
UPDATE "Notification" AS n
SET
  "batchKey" = n."recipientUserId" || ':' || o."verb" || ':' || o."objectType" || ':' || o."objectId",
  "objectIds" = ARRAY[n."notificationObjectId"]
FROM "NotificationObject" AS o
WHERE o."id" = n."notificationObjectId";
