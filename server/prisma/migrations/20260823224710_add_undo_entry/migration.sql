-- CreateTable
CREATE TABLE "UndoEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "inverseJson" JSONB NOT NULL,
    "redoJson" JSONB NOT NULL,
    "undone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UndoEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UndoEntry_orgId_userId_sessionId_seq_idx" ON "UndoEntry"("orgId", "userId", "sessionId", "seq");

-- AddForeignKey
ALTER TABLE "UndoEntry" ADD CONSTRAINT "UndoEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UndoEntry" ADD CONSTRAINT "UndoEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
