import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/settings";
import { getPublicListingSlugs } from "@/lib/listings";
import { CATEGORIES, CITIES } from "@/lib/constants";

/**
 * sitemap.xml
 *
 * Includes the static pages, every published listing, and the city/category
 * filtered views — those are real landing pages with their own titles and
 * descriptions (see generateMetadata in the listings page), so they're worth
 * indexing rather than being treated as duplicate query-string noise.
 *
 * Excluded on purpose: /admin, /login, /favorites and the booking flow, all of
 * which are also `robots: noindex` at the page level.
 */
/**
 * Generated per request rather than at build time: it enumerates listings from
 * the database, and the container image is built without one. It should reflect
 * the live catalogue anyway — a sitemap frozen at build time would omit every
 * listing added afterwards.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();

  // Routed through the shared public predicate rather than a local
  // `{ published: true }`, so a listing hidden because its owner is suspended or
  // their membership lapsed also drops out of the sitemap. Submitting URLs that
  // 404 is worse than omitting them, and a stale sitemap is precisely how a
  // "hidden" listing keeps getting crawled.
  const listings = await getPublicListingSlugs();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/listings`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/how-it-works`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/faq`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/policies`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];

  const listingPages: MetadataRoute.Sitemap = listings.map((l) => ({
    // Arabic slugs must be percent-encoded to be a valid XML <loc>.
    url: `${base}/listings/${encodeURIComponent(l.slug)}`,
    lastModified: l.updatedAt,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  const cityPages: MetadataRoute.Sitemap = CITIES.map((c) => ({
    url: `${base}/listings?city=${c.id}`,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const categoryPages: MetadataRoute.Sitemap = CATEGORIES.map((c) => ({
    url: `${base}/listings?category=${c.id}`,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...staticPages, ...listingPages, ...cityPages, ...categoryPages];
}
