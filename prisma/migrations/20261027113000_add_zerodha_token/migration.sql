-- CreateTable
CREATE TABLE IF NOT EXISTS "ZerodhaToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "accessToken" TEXT NOT NULL,
    "publicToken" TEXT,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "userType" TEXT,
    "email" TEXT,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ZerodhaToken_expiresAt_idx" ON "ZerodhaToken"("expiresAt");
