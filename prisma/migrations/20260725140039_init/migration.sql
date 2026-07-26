-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SiteSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "siteName" TEXT NOT NULL DEFAULT 'استراحات الرمال',
    "tagline" TEXT NOT NULL DEFAULT 'استراحات وشاليهات الإمارات',
    "logoUrl" TEXT,
    "logoGlyph" TEXT NOT NULL DEFAULT 'و',
    "whatsappNumber" TEXT NOT NULL DEFAULT '+971500000000',
    "phone" TEXT DEFAULT '+971500000000',
    "email" TEXT DEFAULT 'hello@example.ae',
    "instagram" TEXT DEFAULT '',
    "tiktok" TEXT DEFAULT '',
    "snapchat" TEXT DEFAULT '',
    "youtube" TEXT DEFAULT '',
    "mapLat" REAL NOT NULL DEFAULT 24.7614,
    "mapLng" REAL NOT NULL DEFAULT 55.3340,
    "mapZoom" INTEGER NOT NULL DEFAULT 10,
    "addressLine" TEXT DEFAULT 'دبي — الإمارات العربية المتحدة',
    "colorAccent" TEXT NOT NULL DEFAULT '#C9A44C',
    "colorAccentDeep" TEXT NOT NULL DEFAULT '#A8873A',
    "colorNight" TEXT NOT NULL DEFAULT '#0C1522',
    "colorSand" TEXT NOT NULL DEFAULT '#FBF7F0',
    "serviceFeePercent" INTEGER NOT NULL DEFAULT 5,
    "depositPercent" INTEGER NOT NULL DEFAULT 30,
    "freeCancelHours" INTEGER NOT NULL DEFAULT 48,
    "checkInTime" TEXT NOT NULL DEFAULT '٤ عصرًا',
    "checkOutTime" TEXT NOT NULL DEFAULT '١٢ ظهرًا',
    "depositPaymentsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "seoTitle" TEXT DEFAULT 'حجز الاستراحات والشاليهات في الإمارات',
    "seoDescription" TEXT DEFAULT 'استراحات وشاليهات صحراوية موثّقة في دبي وأبوظبي والعين وليوا والشارقة — أسعار واضحة وتقويم متاح لحظيًا وتأكيد مباشر عبر الواتساب.',
    "ogImageUrl" TEXT,
    "heroTitle" TEXT NOT NULL DEFAULT 'استراحتك في قلب الصحراء',
    "heroTitleAlt" TEXT NOT NULL DEFAULT 'تبدأ بحجز واحد',
    "heroSubtitle" TEXT NOT NULL DEFAULT 'اختر من بين استراحات وشاليهات مختارة بعناية في لهباب وليوا والعين — أسعار واضحة، تقويم متاح لحظيًا، وتأكيد مباشر مع المالك.',
    "heroImageUrl" TEXT,
    "footerAbout" TEXT NOT NULL DEFAULT 'منصّة إماراتية لحجز الاستراحات والشاليهات الصحراوية — موثّقة ميدانيًا وبأسعار واضحة.',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Listing" (
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
    "ownerName" TEXT DEFAULT 'المالك',
    "ownerWhatsapp" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ListingImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listingId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ListingImage_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Availability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listingId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BLOCKED',
    "note" TEXT,
    CONSTRAINT "Availability_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BookingRequest" (
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
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "paymentStatus" TEXT NOT NULL DEFAULT 'NONE',
    "paymentReference" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BookingRequest_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listingId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 5,
    "body" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Review_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_slug_key" ON "Listing"("slug");

-- CreateIndex
CREATE INDEX "Listing_city_idx" ON "Listing"("city");

-- CreateIndex
CREATE INDEX "Listing_published_featured_idx" ON "Listing"("published", "featured");

-- CreateIndex
CREATE INDEX "ListingImage_listingId_sortOrder_idx" ON "ListingImage"("listingId", "sortOrder");

-- CreateIndex
CREATE INDEX "Availability_listingId_idx" ON "Availability"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "Availability_listingId_date_key" ON "Availability"("listingId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BookingRequest_reference_key" ON "BookingRequest"("reference");

-- CreateIndex
CREATE INDEX "BookingRequest_status_createdAt_idx" ON "BookingRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BookingRequest_listingId_idx" ON "BookingRequest"("listingId");

-- CreateIndex
CREATE INDEX "Review_listingId_published_idx" ON "Review"("listingId", "published");
