-- The home page heading, rewritten for the searches paid traffic arrives from.
--
-- «استراحتك في قلب الصحراء / تبدأ بحجز واحد» said nothing about what is for
-- rent, while the ads run on «شاليهات للايجار» and «مزارع للايجار». The new
-- heading names it in one line, so the optional second line is emptied.
--
-- The UPDATEs are gated on the EXACT old default title. A site whose operator
-- has already written their own heading in /admin/settings is left alone —
-- this changes a default nobody chose, never a choice somebody made. On
-- tryrihla.com the title is still the default; its subtitle was operator-
-- written, and is replaced here at the operator's request together with the
-- title it belongs to.

ALTER TABLE "SiteSettings" ALTER COLUMN "heroTitle" SET DEFAULT 'استراحات وشاليهات ومزارع للإيجار في الإمارات';
ALTER TABLE "SiteSettings" ALTER COLUMN "heroTitleAlt" SET DEFAULT '';
ALTER TABLE "SiteSettings" ALTER COLUMN "heroSubtitle" SET DEFAULT 'قارن الأسعار والتوافر، واختر المكان المناسب لموعدك وعدد ضيوفك.';
ALTER TABLE "SiteSettings" ALTER COLUMN "heroTitleEn" SET DEFAULT 'Rest houses, chalets and farms for rent in the UAE';
ALTER TABLE "SiteSettings" ALTER COLUMN "heroTitleAltEn" SET DEFAULT '';
ALTER TABLE "SiteSettings" ALTER COLUMN "heroSubtitleEn" SET DEFAULT 'Compare prices and availability, and choose the place that suits your dates and your group.';

UPDATE "SiteSettings"
SET "heroTitle" = 'استراحات وشاليهات ومزارع للإيجار في الإمارات',
    "heroTitleAlt" = '',
    "heroSubtitle" = 'قارن الأسعار والتوافر، واختر المكان المناسب لموعدك وعدد ضيوفك.'
WHERE "heroTitle" = 'استراحتك في قلب الصحراء';

UPDATE "SiteSettings"
SET "heroTitleEn" = 'Rest houses, chalets and farms for rent in the UAE',
    "heroTitleAltEn" = '',
    "heroSubtitleEn" = 'Compare prices and availability, and choose the place that suits your dates and your group.'
WHERE "heroTitleEn" = 'Your rest house in the heart of the desert';
