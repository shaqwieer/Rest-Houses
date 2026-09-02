-- Retired listing URLs, so a rename redirects instead of 404-ing.
CREATE TABLE "ListingSlug" (
    "slug" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingSlug_pkey" PRIMARY KEY ("slug")
);

CREATE INDEX "ListingSlug_listingId_idx" ON "ListingSlug"("listingId");

ALTER TABLE "ListingSlug"
    ADD CONSTRAINT "ListingSlug_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- The short share code behind /r/<shortId>.
--
-- Added nullable, backfilled, then made NOT NULL, rather than added with the
-- default in one statement: whether PostgreSQL evaluates a *volatile* default
-- once or per row when it rewrites the table is a detail to depend on, and
-- getting it wrong here would give every existing listing the same share code.
-- Three explicit statements have one meaning on every server.
ALTER TABLE "Listing" ADD COLUMN "shortId" TEXT;

UPDATE "Listing" SET "shortId" = substr(md5(random()::text || "id"), 1, 10);

ALTER TABLE "Listing" ALTER COLUMN "shortId" SET NOT NULL;
ALTER TABLE "Listing" ALTER COLUMN "shortId" SET DEFAULT substr(md5(random()::text), 1, 10);

CREATE UNIQUE INDEX "Listing_shortId_key" ON "Listing"("shortId");
