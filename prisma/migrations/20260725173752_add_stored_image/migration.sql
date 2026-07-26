-- CreateTable
CREATE TABLE "StoredImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mimeType" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "size" INTEGER NOT NULL,
    "folder" TEXT NOT NULL DEFAULT 'listings',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
