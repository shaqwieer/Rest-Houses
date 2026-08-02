-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN "addressLineEn" TEXT DEFAULT '';
ALTER TABLE "SiteSettings" ADD COLUMN "checkInTimeEn" TEXT DEFAULT '';
ALTER TABLE "SiteSettings" ADD COLUMN "checkOutTimeEn" TEXT DEFAULT '';
ALTER TABLE "SiteSettings" ADD COLUMN "footerAboutEn" TEXT DEFAULT '';
ALTER TABLE "SiteSettings" ADD COLUMN "heroSubtitleEn" TEXT DEFAULT '';
ALTER TABLE "SiteSettings" ADD COLUMN "heroTitleAltEn" TEXT DEFAULT '';
ALTER TABLE "SiteSettings" ADD COLUMN "heroTitleEn" TEXT DEFAULT '';
ALTER TABLE "SiteSettings" ADD COLUMN "seoDescriptionEn" TEXT DEFAULT '';
ALTER TABLE "SiteSettings" ADD COLUMN "seoTitleEn" TEXT DEFAULT '';
ALTER TABLE "SiteSettings" ADD COLUMN "siteNameEn" TEXT DEFAULT '';
ALTER TABLE "SiteSettings" ADD COLUMN "taglineEn" TEXT DEFAULT '';

-- CreateTable
CREATE TABLE "OwnerProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "businessName" TEXT NOT NULL DEFAULT '',
    "idNumber" TEXT,
    "city" TEXT NOT NULL DEFAULT '',
    "about" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedAt" DATETIME,
    "reviewedById" TEXT,
    "membershipExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OwnerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "actorEmail" TEXT NOT NULL DEFAULT '',
    "actorRole" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BookingRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerEmail" TEXT,
    "notes" TEXT,
    "checkIn" TEXT NOT NULL,
    "checkOut" TEXT NOT NULL,
    "nights" INTEGER NOT NULL,
    "guests" INTEGER NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "serviceFee" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "depositDue" INTEGER NOT NULL DEFAULT 0,
    "depositPercent" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "paymentStatus" TEXT NOT NULL DEFAULT 'NONE',
    "paymentReference" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BookingRequest_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BookingRequest" ("checkIn", "checkOut", "createdAt", "customerEmail", "customerName", "customerPhone", "depositDue", "guests", "id", "listingId", "nights", "notes", "paymentReference", "paymentStatus", "reference", "serviceFee", "status", "subtotal", "total", "updatedAt") SELECT "checkIn", "checkOut", "createdAt", "customerEmail", "customerName", "customerPhone", "depositDue", "guests", "id", "listingId", "nights", "notes", "paymentReference", "paymentStatus", "reference", "serviceFee", "status", "subtotal", "total", "updatedAt" FROM "BookingRequest";
DROP TABLE "BookingRequest";
ALTER TABLE "new_BookingRequest" RENAME TO "BookingRequest";
CREATE UNIQUE INDEX "BookingRequest_reference_key" ON "BookingRequest"("reference");
CREATE INDEX "BookingRequest_status_createdAt_idx" ON "BookingRequest"("status", "createdAt");
CREATE INDEX "BookingRequest_listingId_idx" ON "BookingRequest"("listingId");
CREATE TABLE "new_Listing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL,
    "area" TEXT NOT NULL DEFAULT '',
    "lat" REAL NOT NULL DEFAULT 24.7614,
    "lng" REAL NOT NULL DEFAULT 55.3340,
    "pricePerNight" INTEGER NOT NULL,
    "weekendPrice" INTEGER NOT NULL DEFAULT 0,
    "capacity" INTEGER NOT NULL DEFAULT 20,
    "amenities" TEXT NOT NULL DEFAULT '[]',
    "categories" TEXT NOT NULL DEFAULT '[]',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "rating" REAL NOT NULL DEFAULT 0,
    "reviewsCount" INTEGER NOT NULL DEFAULT 0,
    "bookingsCount" INTEGER NOT NULL DEFAULT 0,
    "depositPercent" INTEGER,
    "ownerId" TEXT,
    "ownerName" TEXT DEFAULT 'المالك',
    "ownerWhatsapp" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Listing_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Listing" ("amenities", "area", "bookingsCount", "capacity", "categories", "city", "createdAt", "description", "featured", "id", "lat", "lng", "name", "ownerName", "ownerWhatsapp", "pricePerNight", "published", "rating", "reviewsCount", "slug", "updatedAt", "verified", "weekendPrice") SELECT "amenities", "area", "bookingsCount", "capacity", "categories", "city", "createdAt", "description", "featured", "id", "lat", "lng", "name", "ownerName", "ownerWhatsapp", "pricePerNight", "published", "rating", "reviewsCount", "slug", "updatedAt", "verified", "weekendPrice" FROM "Listing";
DROP TABLE "Listing";
ALTER TABLE "new_Listing" RENAME TO "Listing";
CREATE UNIQUE INDEX "Listing_slug_key" ON "Listing"("slug");
CREATE INDEX "Listing_city_idx" ON "Listing"("city");
CREATE INDEX "Listing_published_featured_idx" ON "Listing"("published", "featured");
CREATE INDEX "Listing_ownerId_idx" ON "Listing"("ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "OwnerProfile_userId_key" ON "OwnerProfile"("userId");

-- CreateIndex
CREATE INDEX "OwnerProfile_status_idx" ON "OwnerProfile"("status");

-- CreateIndex
CREATE INDEX "OwnerProfile_status_membershipExpiresAt_idx" ON "OwnerProfile"("status", "membershipExpiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- ---------------------------------------------------------------------------
-- Backfill: BookingRequest.depositPercent
-- ---------------------------------------------------------------------------
-- The column above lands with a literal default of 30, but a site whose
-- operator configured a different platform-wide deposit would have every
-- historical booking suddenly claim 30% next to a `depositDue` computed at
-- their real rate. Re-point existing rows at the value that actually produced
-- those amounts.
--
-- Only rows that existed before this migration are touched (they are the only
-- ones that can be wrong); new bookings write their own snapshot explicitly.
-- The subselect is guarded with COALESCE so a database with no settings row
-- keeps the 30 default rather than nulling the column.
UPDATE "BookingRequest"
SET "depositPercent" = COALESCE(
  (SELECT "depositPercent" FROM "SiteSettings" WHERE "id" = 1),
  30
);
