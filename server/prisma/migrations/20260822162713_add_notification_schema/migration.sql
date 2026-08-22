-- CreateTable
CREATE TABLE "NotificationObject" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "actorUserId" TEXT,
    "verb" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "notificationObjectId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationObject_orgId_actorUserId_idx" ON "NotificationObject"("orgId", "actorUserId");

-- CreateIndex
CREATE INDEX "NotificationObject_orgId_objectType_objectId_idx" ON "NotificationObject"("orgId", "objectType", "objectId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationObject_orgId_eventKey_key" ON "NotificationObject"("orgId", "eventKey");

-- CreateIndex
CREATE INDEX "Notification_orgId_recipientUserId_archivedAt_snoozedUntil__idx" ON "Notification"("orgId", "recipientUserId", "archivedAt", "snoozedUntil", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_orgId_recipientUserId_readAt_idx" ON "Notification"("orgId", "recipientUserId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_notificationObjectId_recipientUserId_key" ON "Notification"("notificationObjectId", "recipientUserId");

-- AddForeignKey
ALTER TABLE "NotificationObject" ADD CONSTRAINT "NotificationObject_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationObject" ADD CONSTRAINT "NotificationObject_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_notificationObjectId_fkey" FOREIGN KEY ("notificationObjectId") REFERENCES "NotificationObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
