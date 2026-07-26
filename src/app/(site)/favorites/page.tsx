import type { Metadata } from "next";
import { FavoritesGrid } from "@/components/site/favorites-grid";
import { findListings } from "@/lib/listings";
import { toCardData } from "@/components/listing/card-data";

/**
 * Rendered per request: this page reads the database, and the container image is
 * built without one. See the note on the home page for the full reasoning.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "المفضلة",
  description: "الاستراحات التي حفظتها لمقارنتها قبل الحجز.",
  // The contents are per-device localStorage, so there's nothing stable to index.
  robots: { index: false, follow: true },
};

/**
 * Favourites.
 *
 * Which listings are favourited is only known in the browser (localStorage — see
 * favorites-provider.tsx), so the server sends every published listing's card
 * data and the client filters it. That is fine at this catalogue size and keeps
 * the feature account-free, which is what the design promises: «تُحفظ على جهازك
 * ولا تحتاج حسابًا».
 *
 * If the catalogue grows past a few hundred, the fix is to send ids only and
 * fetch the selected cards through a route handler.
 */
export default async function FavoritesPage() {
  const listings = await findListings({ sort: "reco" });
  return <FavoritesGrid all={listings.map(toCardData)} />;
}
