import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/settings";

/**
 * robots.txt
 *
 * Crawlers get the public catalogue and nothing else. The disallowed paths are
 * either private (/admin, /login, /api) or per-visitor and therefore worthless
 * in an index (/favorites, /booking/*, the booking form).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/admin/",
          "/login",
          "/api/",
          "/favorites",
          "/booking/",
          // The per-listing booking form — a form with no indexable content.
          "/listings/*/book",
        ],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
