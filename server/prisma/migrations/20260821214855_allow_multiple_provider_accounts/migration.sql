-- DropIndex
DROP INDEX "OAuthConnection_orgId_userId_provider_key";

-- CreateIndex
CREATE UNIQUE INDEX "OAuthConnection_orgId_userId_provider_providerAccountId_key" ON "OAuthConnection"("orgId", "userId", "provider", "providerAccountId");
