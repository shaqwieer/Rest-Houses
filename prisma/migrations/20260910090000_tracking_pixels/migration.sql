-- ---------------------------------------------------------------------------
-- The advertising pixels — five identifier columns and one switch.
--
-- Pure DDL. Five TEXT columns NOT NULL DEFAULT '', one BOOLEAN NOT NULL
-- DEFAULT false, no data movement, nothing dropped, no index (nothing filters
-- on them; they are read once per render with the rest of the settings row).
--
-- ─── Why '' and false are the right backfill ───────────────────────────────
-- '' means "no pixel configured" and false means "the owner dashboard loads no
-- pixel", and both are true of every existing row by construction: until this
-- release the site rendered no Meta, TikTok or Snapchat script at all, and the
-- dashboard has never rendered a tracking script of any kind.
-- `<TrackingScripts>` renders nothing for an empty id, so a database that
-- migrates and is never touched again serves exactly the HTML it served
-- yesterday.
--
-- This repeats the reasoning of 20260822090000_google_tag deliberately. A
-- plausible-looking default here is not a wording bug — it would begin
-- reporting a live site's traffic, its booking requests and its owner
-- registrations into somebody else's advertising account.
--
-- ─── Why googleAnalyticsId is not googleTagId ──────────────────────────────
-- googleTagId is one gtag.js loader, and in practice it holds the Ads tag
-- ("AW-…"). A site that also runs GA4 needs a second `config` command, not a
-- second loader, so the measurement id gets its own column rather than
-- fighting the Ads tag for the existing one. gtmContainerId is separate again:
-- a Tag Manager container is loaded by gtm.js and would silently do nothing if
-- it were ever passed to gtag/js?id=.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "metaPixelId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "tiktokPixelId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "snapchatPixelId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "googleAnalyticsId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "gtmContainerId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "ownerAreaTracking" BOOLEAN NOT NULL DEFAULT false;
