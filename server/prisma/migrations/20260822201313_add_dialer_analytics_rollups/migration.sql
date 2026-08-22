-- CreateTable
CREATE TABLE "AnalyticsRollup" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "hourOfDay" INTEGER,
    "numberE164" TEXT NOT NULL,
    "areaCode" TEXT,
    "dials" INTEGER NOT NULL DEFAULT 0,
    "connects" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsRollup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsRollup_orgId_numberE164_idx" ON "AnalyticsRollup"("orgId", "numberE164");

-- CreateIndex
CREATE INDEX "AnalyticsRollup_orgId_areaCode_idx" ON "AnalyticsRollup"("orgId", "areaCode");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsRollup_orgId_day_hourOfDay_numberE164_areaCode_key" ON "AnalyticsRollup"("orgId", "day", "hourOfDay", "numberE164", "areaCode");

-- AddForeignKey
ALTER TABLE "AnalyticsRollup" ADD CONSTRAINT "AnalyticsRollup_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
