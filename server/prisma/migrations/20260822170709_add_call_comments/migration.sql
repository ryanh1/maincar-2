-- CreateTable
CREATE TABLE "CallComment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "parentId" TEXT,
    "authorUserId" TEXT,
    "bodyJson" JSONB NOT NULL,
    "bodyText" TEXT NOT NULL,
    "atMs" INTEGER,
    "anchorEndMs" INTEGER,
    "anchorQuote" TEXT,
    "selectionStartChar" INTEGER,
    "selectionEndChar" INTEGER,
    "transcriptId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallCommentReaction" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallCommentReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallComment_orgId_idx" ON "CallComment"("orgId");

-- CreateIndex
CREATE INDEX "CallComment_orgId_callId_createdAt_idx" ON "CallComment"("orgId", "callId", "createdAt");

-- CreateIndex
CREATE INDEX "CallComment_parentId_createdAt_idx" ON "CallComment"("parentId", "createdAt");

-- CreateIndex
CREATE INDEX "CallCommentReaction_orgId_idx" ON "CallCommentReaction"("orgId");

-- CreateIndex
CREATE INDEX "CallCommentReaction_commentId_createdAt_idx" ON "CallCommentReaction"("commentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CallCommentReaction_commentId_userId_emoji_key" ON "CallCommentReaction"("commentId", "userId", "emoji");

-- AddForeignKey
ALTER TABLE "CallComment" ADD CONSTRAINT "CallComment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallComment" ADD CONSTRAINT "CallComment_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallComment" ADD CONSTRAINT "CallComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CallComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallComment" ADD CONSTRAINT "CallComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallCommentReaction" ADD CONSTRAINT "CallCommentReaction_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallCommentReaction" ADD CONSTRAINT "CallCommentReaction_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "CallComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallCommentReaction" ADD CONSTRAINT "CallCommentReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
