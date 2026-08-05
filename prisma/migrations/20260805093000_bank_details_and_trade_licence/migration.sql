-- ---------------------------------------------------------------------------
-- The platform's bank account (shown to owners at the commission step) and the
-- trade licence number (shown in the footer).
--
-- Purely additive: five nullable-free columns with an empty-string default, so
-- every existing row acquires them without a backfill and every surface that
-- reads them renders nothing until an operator fills them in. Nothing here can
-- fail on existing data, which is why it is a separate migration from the
-- username backfill — that one touches rows and could conceivably stop a
-- deploy, and there is no reason for these to be blocked behind it.
-- ---------------------------------------------------------------------------

ALTER TABLE "SiteSettings" ADD COLUMN "bankName"          TEXT NOT NULL DEFAULT '';
ALTER TABLE "SiteSettings" ADD COLUMN "bankAccountHolder" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SiteSettings" ADD COLUMN "bankAccountNumber" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SiteSettings" ADD COLUMN "bankIban"          TEXT NOT NULL DEFAULT '';
ALTER TABLE "SiteSettings" ADD COLUMN "tradeLicense"      TEXT NOT NULL DEFAULT '';
