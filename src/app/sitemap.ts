import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { siteUrl } from "@/lib/settings";
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

  const listings = await prisma.listing.findMany({
    where: { published: true },
    select: { slug: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

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
