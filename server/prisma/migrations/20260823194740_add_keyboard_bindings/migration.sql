-- CreateTable
CREATE TABLE "KeyboardBinding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "keys" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeyboardBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KeyboardBinding_userId_idx" ON "KeyboardBinding"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "KeyboardBinding_userId_actionId_key" ON "KeyboardBinding"("userId", "actionId");

-- AddForeignKey
ALTER TABLE "KeyboardBinding" ADD CONSTRAINT "KeyboardBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
