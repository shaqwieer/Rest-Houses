"use client";

import { Photo } from "@/components/ui/photo";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { useFavorites } from "@/components/site/favorites-provider";
import { arNum, arRating } from "@/lib/format";
import { cityLabel, DEFAULT_PHOTO_URL, getAmenity, label as pickLabel } from "@/lib/constants";
import { localized } from "@/lib/i18n/config";
import type { ListingCardData } from "./card-data";
import { useLocale } from "@/lib/i18n/provider";

/**
 * The listing card — used on the home page, the results grid and favourites.
 *
 * Takes the narrowed `ListingCardData` rather than a full `ListingView`; see
 * ./card-data.ts for why the narrowing helper lives in a separate module.
 */

export type { ListingCardData };

export function ListingCard({
  listing,
  showCityBadge = false,
  showVerifiedBadge = false,
  /** Cards above the fold should not lazy-load — it delays the LCP image. */
  priority = false,
}: {
  listing: ListingCardData;
  showCityBadge?: boolean;
  showVerifiedBadge?: boolean;
  priority?: boolean;
}) {
  const { isFavorite, toggle } = useFavorites();
  const { t, locale } = useLocale();
  const favorited = isFavorite(listing.id);

  // Four amenity chips, matching the design's `amens.slice(0,4)`.
  const chips = listing.amenityIds.slice(0, 4).map(getAmenity);

  // The owner's own words, in the reader's language — falling back to Arabic
  // per field, so a listing with an English name but no English area line still
  // shows the English name.
  const name = localized(listing.name, listing.nameEn, locale);
  const where = localized(listing.area, listing.areaEn, locale) || cityLabel(listing.city, locale);

  return (
    <article className="group flex flex-col overflow-hidden rounded-[20px] border border-line bg-surface shadow-e1 transition duration-200 hover:-translate-y-1 hover:border-sand-300 hover:shadow-e2">
      <div className="relative h-46 shrink-0 bg-sand-200">
        <Photo
          // `toView` already resolves this to the stand-in when a listing has
          // no photo; the `??` covers the handful of callers that build card
          // data by hand.
          src={listing.coverUrl ?? DEFAULT_PHOTO_URL}
          alt={name}
          fill
          // Two columns on tablet, up to four on desktop — tells the browser
          // to fetch a ~300px-wide file for a card, not the full 1600px.
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 320px"
          className="object-cover transition duration-500 group-hover:scale-[1.03]"
          priority={priority}
        />

        {/* favourite toggle — a button, not a link, so it never navigates */}
        <button
          type="button"
          onClick={() => toggle(listing.id)}
          aria-label={
            favorited ? t.favorites.removeFromFavorites : t.favorites.addToFavorites
          }
          aria-pressed={favorited}
          className="absolute top-3 start-3 z-6 grid size-9 place-items-center rounded-full bg-surface/95 shadow-[0_4px_12px_rgb(0_0_0/0.18)] transition hover:scale-108"
        >
          <Icon
            name={favorited ? "favorite" : "favorite_border"}
            size={20}
            className={favorited ? "text-busy" : "text-ink"}
          />
        </button>

        {showVerifiedBadge && listing.verified && (
          <div className="pointer-events-none absolute top-3 end-3">
            <Badge tone="glass" icon="verified">
              {t.common.verified}
            </Badge>
          </div>
        )}

        {showCityBadge && (
          <span className="pointer-events-none absolute bottom-3 end-3 rounded-full bg-night-900/85 px-2.5 py-1 text-[12px] font-bold text-sand-100 backdrop-blur-sm">
            {cityLabel(listing.city, locale)}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-2.5">
          <h3 className="m-0 font-display text-[16px] font-bold leading-snug text-ink">
            <Link
              href={`/listings/${encodeURIComponent(listing.slug)}`}
              className="text-ink no-underline hover:text-bronze hover:no-underline"
            >
              {name}
            </Link>
          </h3>

          {listing.reviewsCount > 0 ? (
            <span className="flex shrink-0 items-center gap-1 text-[12.5px] font-bold text-ink">
              <Icon name="star" size={15} className="text-gold-500" />
              {arRating(listing.rating, locale)}
              <span className="font-medium text-muted">({arNum(listing.reviewsCount, locale)})</span>
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-gold-100 px-2.5 py-1 text-[11px] font-bold text-bronze">
              {t.common.new}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
          <span className="flex items-center gap-1">
            <Icon name="location_on" size={15} />
            {where}
          </span>
          <span className="opacity-40">·</span>
          <span className="flex items-center gap-1">
            <Icon name="group" size={15} />
            {t.common.upToGuests(arNum(listing.capacity, locale), listing.capacity)}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {chips.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 rounded-lg bg-sand-100 px-2 py-1 text-[11px] font-semibold text-bronze"
            >
              <Icon name={a.icon as never} size={13} />
              {pickLabel(a, locale)}
            </span>
          ))}
        </div>

        <div className="mt-auto flex items-end justify-between gap-2.5 border-t border-dashed border-line pt-3">
          <div>
            <span className="font-display text-[18px] font-extrabold text-ink">
              {arNum(listing.pricePerNight, locale)}
            </span>
            <span className="text-[12px] font-semibold text-muted">
              {" "}
              {t.common.aed} {t.common.perNight}
            </span>
          </div>
          <Link
            href={`/listings/${encodeURIComponent(listing.slug)}`}
            className="rounded-full bg-night-900 px-4 py-2.5 text-[13px] font-bold text-sand-100 no-underline transition hover:bg-gold-600 hover:text-night-900 hover:no-underline"
          >
            {t.common.details}
          </Link>
        </div>
      </div>
    </article>
  );
}
