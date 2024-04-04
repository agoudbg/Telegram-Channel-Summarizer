-- CreateTable
CREATE TABLE "UserWhiteList" (
    "userId" BIGINT NOT NULL,
    "canPromoteOthers" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "History" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" BIGINT NOT NULL,
    "targetChannelId" BIGINT NOT NULL,
    "tokenSpent" INTEGER NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "UserWhiteList_userId_key" ON "UserWhiteList"("userId");
