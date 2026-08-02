-- ---------------------------------------------------------------------------
-- City list becomes the seven emirates
-- ---------------------------------------------------------------------------
-- `CITIES` in src/lib/constants.ts previously mixed emirates with regions
-- inside them: "العين" and "الظفرة وليوا" are both part of Abu Dhabi, so a
-- visitor filtering by أبوظبي never saw them. The list is now the seven
-- emirates, and town-level detail lives in `Listing.area`, which already holds
-- strings like "لهباب – دبي" and "العين – الهيلي".
--
-- Data-only migration: no schema change. `city` is a String column (SQLite has
-- no native enum — see the portability note at the top of schema.prisma), so
-- the ids are plain values that need remapping rather than a type to alter.
--
-- Both retired ids fold into the emirate that contains them, which is
-- geographically correct and loses no information — the specific town is still
-- in `area`.
--
-- Idempotent: re-running matches nothing the second time.
-- ---------------------------------------------------------------------------

UPDATE "Listing"      SET "city" = 'abudhabi' WHERE "city" IN ('alain', 'liwa');
UPDATE "OwnerProfile" SET "city" = 'abudhabi' WHERE "city" IN ('alain', 'liwa');

-- ---------------------------------------------------------------------------
-- Backfill the English copy columns
-- ---------------------------------------------------------------------------
-- They shipped defaulting to "", which `localized()` treats as "fall back to
-- Arabic" — so the English site rendered an Arabic hero, the most visible text
-- on the page. Give the existing row the same defaults a fresh install now gets.
--
-- Only blank values are touched, so anything an operator has already written in
-- /admin/settings → «النسخة الإنجليزية» is preserved.
-- ---------------------------------------------------------------------------

UPDATE "SiteSettings" SET "siteNameEn" = 'Sands Rest Houses'
  WHERE "siteNameEn" IS NULL OR "siteNameEn" = '';

UPDATE "SiteSettings" SET "taglineEn" = 'Rest houses & chalets across the UAE'
  WHERE "taglineEn" IS NULL OR "taglineEn" = '';

UPDATE "SiteSettings" SET "addressLineEn" = 'Dubai — United Arab Emirates'
  WHERE "addressLineEn" IS NULL OR "addressLineEn" = '';

UPDATE "SiteSettings" SET "checkInTimeEn" = '4 PM'
  WHERE "checkInTimeEn" IS NULL OR "checkInTimeEn" = '';

UPDATE "SiteSettings" SET "checkOutTimeEn" = '12 noon'
  WHERE "checkOutTimeEn" IS NULL OR "checkOutTimeEn" = '';

UPDATE "SiteSettings" SET "seoTitleEn" = 'Book rest houses and chalets in the UAE'
  WHERE "seoTitleEn" IS NULL OR "seoTitleEn" = '';

UPDATE "SiteSettings" SET "seoDescriptionEn" =
  'Verified desert rest houses and chalets across Abu Dhabi, Dubai, Sharjah, Ras Al Khaimah, Ajman, Umm Al Quwain and Fujairah — clear pricing, a live calendar, and direct confirmation on WhatsApp.'
  WHERE "seoDescriptionEn" IS NULL OR "seoDescriptionEn" = '';

UPDATE "SiteSettings" SET "heroTitleEn" = 'Your rest house in the heart of the desert'
  WHERE "heroTitleEn" IS NULL OR "heroTitleEn" = '';

UPDATE "SiteSettings" SET "heroTitleAltEn" = 'is one booking away'
  WHERE "heroTitleAltEn" IS NULL OR "heroTitleAltEn" = '';

UPDATE "SiteSettings" SET "heroSubtitleEn" =
  'Choose from carefully selected rest houses and chalets in Lahbab, Liwa and Al Ain — clear pricing, a live calendar, and direct confirmation with the owner.'
  WHERE "heroSubtitleEn" IS NULL OR "heroSubtitleEn" = '';

UPDATE "SiteSettings" SET "footerAboutEn" =
  'An Emirati platform for booking desert rest houses and chalets — verified in person, with clear pricing.'
  WHERE "footerAboutEn" IS NULL OR "footerAboutEn" = '';
