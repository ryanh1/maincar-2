-- CreateTable
CREATE TABLE "InboundForwarding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mobileE164" TEXT,
    "strategy" TEXT NOT NULL DEFAULT 'simultaneous',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundForwarding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboundForwarding_orgId_userId_enabled_idx" ON "InboundForwarding"("orgId", "userId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "InboundForwarding_orgId_userId_key" ON "InboundForwarding"("orgId", "userId");
