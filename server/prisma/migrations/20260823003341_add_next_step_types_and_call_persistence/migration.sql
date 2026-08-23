-- CreateTable
CREATE TABLE "NextStepType" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'option-1',
    "icon" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinOrder" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isOverflow" BOOLEAN NOT NULL DEFAULT false,
    "requiresDateTime" BOOLEAN NOT NULL DEFAULT false,
    "createsTask" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NextStepType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispositionNextStepRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dispositionId" TEXT NOT NULL,
    "nextStepTypeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispositionNextStepRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallNextStep" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "nextStepTypeId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallNextStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NextStepType_orgId_isArchived_isPinned_pinOrder_idx" ON "NextStepType"("orgId", "isArchived", "isPinned", "pinOrder");

-- CreateIndex
CREATE INDEX "NextStepType_orgId_isArchived_sortOrder_idx" ON "NextStepType"("orgId", "isArchived", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "NextStepType_orgId_value_key" ON "NextStepType"("orgId", "value");

-- CreateIndex
CREATE INDEX "DispositionNextStepRule_orgId_nextStepTypeId_idx" ON "DispositionNextStepRule"("orgId", "nextStepTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "DispositionNextStepRule_orgId_dispositionId_key" ON "DispositionNextStepRule"("orgId", "dispositionId");

-- CreateIndex
CREATE INDEX "CallNextStep_orgId_callId_sortOrder_idx" ON "CallNextStep"("orgId", "callId", "sortOrder");

-- CreateIndex
CREATE INDEX "CallNextStep_orgId_nextStepTypeId_idx" ON "CallNextStep"("orgId", "nextStepTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "CallNextStep_callId_nextStepTypeId_key" ON "CallNextStep"("callId", "nextStepTypeId");

-- AddForeignKey
ALTER TABLE "NextStepType" ADD CONSTRAINT "NextStepType_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispositionNextStepRule" ADD CONSTRAINT "DispositionNextStepRule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispositionNextStepRule" ADD CONSTRAINT "DispositionNextStepRule_dispositionId_fkey" FOREIGN KEY ("dispositionId") REFERENCES "DispositionDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispositionNextStepRule" ADD CONSTRAINT "DispositionNextStepRule_nextStepTypeId_fkey" FOREIGN KEY ("nextStepTypeId") REFERENCES "NextStepType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallNextStep" ADD CONSTRAINT "CallNextStep_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallNextStep" ADD CONSTRAINT "CallNextStep_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallNextStep" ADD CONSTRAINT "CallNextStep_nextStepTypeId_fkey" FOREIGN KEY ("nextStepTypeId") REFERENCES "NextStepType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
