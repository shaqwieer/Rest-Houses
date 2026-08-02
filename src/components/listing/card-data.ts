/**
 * Narrow a full `ListingView` down to the fields `<ListingCard>` renders.
 *
 * Lives in its own module (no "use client") because server components call it
 * while building props — a function exported from a client module can only be
 * rendered or passed as a prop, never invoked on the server.
 *
 * The narrowing is not cosmetic: client-component props are serialised into the
 * RSC payload, so returning the whole row would ship every listing's full
 * description and image list to the browser for a grid of cards.
 */

export type ListingCardData = {
  id: string;
  slug: string;
  name: string;
  city: string;
  area: string;
  /**
   * The English siblings travel to the card *unresolved*.
   *
   * `<ListingCard>` is a client component that already reads the locale from
   * context to label the city and the amenity chips, so it resolves the name
   * and area the same way. Picking the language here instead would mean
   * threading a `locale` argument through all four call sites — and the card
   * would then have two different mechanisms for the same job.
   */
  nameEn: string | null;
  areaEn: string | null;
  pricePerNight: number;
  capacity: number;
  rating: number;
  reviewsCount: number;
  verified: boolean;
  coverUrl: string | null;
  amenityIds: string[];
};

export function toCardData(listing: ListingCardData): ListingCardData {
  return {
    id: listing.id,
    slug: listing.slug,
    name: listing.name,
    city: listing.city,
    area: listing.area,
    nameEn: listing.nameEn,
    areaEn: listing.areaEn,
    pricePerNight: listing.pricePerNight,
    capacity: listing.capacity,
    rating: listing.rating,
    reviewsCount: listing.reviewsCount,
    verified: listing.verified,
    coverUrl: listing.coverUrl,
    amenityIds: listing.amenityIds,
  };
}
