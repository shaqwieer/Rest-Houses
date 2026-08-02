-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerProfile" (
    "id" TEXT NOT NULL,
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
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "membershipExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT NOT NULL DEFAULT '',
    "actorRole" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "siteName" TEXT NOT NULL DEFAULT 'استراحات الرمال',
    "tagline" TEXT NOT NULL DEFAULT 'استراحات وشاليهات الإمارات',
    "logoUrl" TEXT,
    "logoGlyph" TEXT NOT NULL DEFAULT 'و',
    "siteNameEn" TEXT DEFAULT 'Sands Rest Houses',
    "taglineEn" TEXT DEFAULT 'Rest houses & chalets across the UAE',
    "addressLineEn" TEXT DEFAULT 'Dubai — United Arab Emirates',
    "checkInTimeEn" TEXT DEFAULT '4 PM',
    "checkOutTimeEn" TEXT DEFAULT '12 noon',
    "seoTitleEn" TEXT DEFAULT 'Book rest houses and chalets in the UAE',
    "seoDescriptionEn" TEXT DEFAULT 'Verified desert rest houses and chalets across Abu Dhabi, Dubai, Sharjah, Ras Al Khaimah, Ajman, Umm Al Quwain and Fujairah — clear pricing, a live calendar, and direct confirmation on WhatsApp.',
    "heroTitleEn" TEXT DEFAULT 'Your rest house in the heart of the desert',
    "heroTitleAltEn" TEXT DEFAULT 'is one booking away',
    "heroSubtitleEn" TEXT DEFAULT 'Choose from carefully selected rest houses and chalets in Lahbab, Liwa and Al Ain — clear pricing, a live calendar, and direct confirmation with the owner.',
    "footerAboutEn" TEXT DEFAULT 'An Emirati platform for booking desert rest houses and chalets — verified in person, with clear pricing.',
    "whatsappNumber" TEXT NOT NULL DEFAULT '+971500000000',
    "phone" TEXT DEFAULT '+971500000000',
    "email" TEXT DEFAULT 'hello@example.ae',
    "instagram" TEXT DEFAULT '',
    "tiktok" TEXT DEFAULT '',
    "snapchat" TEXT DEFAULT '',
    "youtube" TEXT DEFAULT '',
    "mapLat" DOUBLE PRECISION NOT NULL DEFAULT 24.7614,
    "mapLng" DOUBLE PRECISION NOT NULL DEFAULT 55.3340,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL,
    "area" TEXT NOT NULL DEFAULT '',
    "lat" DOUBLE PRECISION NOT NULL DEFAULT 24.7614,
    "lng" DOUBLE PRECISION NOT NULL DEFAULT 55.3340,
    "pricePerNight" INTEGER NOT NULL,
    "weekendPrice" INTEGER NOT NULL DEFAULT 0,
    "capacity" INTEGER NOT NULL DEFAULT 20,
    "amenities" TEXT NOT NULL DEFAULT '[]',
    "categories" TEXT NOT NULL DEFAULT '[]',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewsCount" INTEGER NOT NULL DEFAULT 0,
    "bookingsCount" INTEGER NOT NULL DEFAULT 0,
    "depositPercent" INTEGER,
    "ownerId" TEXT,
    "ownerName" TEXT DEFAULT 'المالك',
    "ownerWhatsapp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredImage" (
    "id" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "folder" TEXT NOT NULL DEFAULT 'listings',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingImage" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ListingImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Availability" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BLOCKED',
    "note" TEXT,

    CONSTRAINT "Availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingRequest" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 5,
    "body" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

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
CREATE UNIQUE INDEX "Listing_slug_key" ON "Listing"("slug");

-- CreateIndex
CREATE INDEX "Listing_city_idx" ON "Listing"("city");

-- CreateIndex
CREATE INDEX "Listing_published_featured_idx" ON "Listing"("published", "featured");

-- CreateIndex
CREATE INDEX "Listing_ownerId_idx" ON "Listing"("ownerId");

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

-- AddForeignKey
ALTER TABLE "OwnerProfile" ADD CONSTRAINT "OwnerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingImage" ADD CONSTRAINT "ListingImage_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
