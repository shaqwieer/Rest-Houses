"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useState } from "react";
import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { useFavorites } from "@/components/site/favorites-provider";
import { DEFAULT_PHOTO_URL } from "@/lib/constants";
import { arNum } from "@/lib/format";
import { useLocale } from "@/lib/i18n/provider";

/**
 * The photo viewer is loaded only when a visitor actually opens one.
 *
 * It is a few hundred lines of pointer maths that most visitors never trigger,
 * and this is the most-visited template on the site — so it stays out of the
 * page's first load and arrives on the click that needs it. `ssr: false`
 * because it does nothing until it is open and reads `document` when it is.
 */
const Lightbox = dynamic(() => import("./lightbox").then((m) => m.Lightbox), {
  ssr: false,
});

/**
 * Listing gallery: one large hero plus a horizontal thumbnail strip.
 *
 * ─── The hero opens a full-screen viewer ─────────────────────────────────────
 * It used to be a plain swap and nothing more, on the reasoning that the design
 * showed exactly that and a lightbox library would be another dependency on the
 * busiest template here. Half of that still holds: there is still no library —
 * see the note at the top of ./lightbox.tsx — but the plain swap was the wrong
 * call for the actual audience.
 *
 * These are group venues booked from a phone, and the decision a guest is making
 * is "is this majlis big enough, is that pool clean". At the hero's height on a
 * phone, that is unanswerable: they need the photo full-bleed and they need to
 * zoom into it. So the hero, the photo-count badge and every thumbnail open the
 * viewer, which is where pinch, double-tap and swipe live.
 *
 * The hero itself keeps `priority`: it is this page's LCP element, and moving
 * that budget to a viewer nobody has opened yet would slow the page down for
 * everyone to speed up an interaction for some.
 */
export function Gallery({
  listingId,
  name,
  images,
  verified,
}: {
  listingId: string;
  name: string;
  images: { id: string; url: string; alt: string }[];
  verified: boolean;
}) {
  const [active, setActive] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const { isFavorite, toggle } = useFavorites();
  const { t, locale } = useLocale();
  const favorited = isFavorite(listingId);

  // A listing with no photos yet still gets a banner. `images` stays the real
  // array, so the photo-count badge below is absent rather than claiming "1
  // photo" for a picture the owner never uploaded.
  const hero = images[active];
  const heroUrl = hero?.url ?? DEFAULT_PHOTO_URL;
  const hasPhotos = images.length > 0;

  function openViewer(at: number) {
    // Guard rather than assume: the placeholder banner is not a photo, and
    // opening a viewer onto it would show a stock image full-screen.
    if (!hasPhotos) return;
    setActive(at);
    setViewerOpen(true);
  }

  return (
    <div className="mb-3.5 flex flex-col gap-2.5">
      <div className="relative h-62.5 overflow-hidden rounded-[20px] bg-sand-200 md:h-[clamp(300px,42vw,480px)]">
        {/* A button, not a div with a click handler: this is the primary way
            into the viewer, so it has to be reachable by keyboard and announce
            itself to a screen reader. */}
        <button
          type="button"
          onClick={() => openViewer(active)}
          disabled={!hasPhotos}
          aria-label={t.gallery.openViewer}
          className="absolute inset-0 h-full w-full cursor-zoom-in disabled:cursor-default"
        >
          <Image
            src={heroUrl}
            alt={hero?.alt || name}
            fill
            // Full-bleed on phones, capped by the 1280px container on desktop.
            sizes="(max-width: 1280px) 100vw, 1280px"
            className="object-cover"
            // The gallery hero is this page's LCP element.
            priority
          />
        </button>

        {/* Sits above the hero button, so tapping the count opens the viewer
            rather than falling through to the same handler by accident. */}
        <div className="pointer-events-none absolute bottom-3 end-3 flex gap-2">
          {verified && (
            <Badge tone="glass" icon="verified">
              {t.gallery.verifiedOwner}
            </Badge>
          )}
          {hasPhotos && (
            <button
              type="button"
              onClick={() => openViewer(active)}
              className="pointer-events-auto"
              aria-label={t.gallery.openViewer}
            >
              <Badge tone="glass" icon="photo_library" className="text-sand-100">
                {t.gallery.imageCount(arNum(images.length, locale), images.length)}
              </Badge>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => toggle(listingId)}
          aria-label={
            favorited ? t.favorites.removeFromFavorites : t.favorites.addToFavorites
          }
          aria-pressed={favorited}
          className="absolute top-3 start-3 grid size-10 place-items-center rounded-full bg-surface/95 shadow-[0_4px_12px_rgb(0_0_0/0.18)] transition hover:scale-105"
        >
          <Icon
            name={favorited ? "favorite" : "favorite_border"}
            size={21}
            className={favorited ? "text-busy" : "text-ink"}
          />
        </button>

        {/* A visible affordance on phones, where there is no hover state to
            discover the hero is tappable and no cursor to change. */}
        {hasPhotos && (
          <span className="pointer-events-none absolute top-3 end-3 grid size-9 place-items-center rounded-full bg-night-900/45 text-sand-100 backdrop-blur-sm">
            <Icon name="search" size={18} />
          </span>
        )}
      </div>

      {images.length > 1 && (
        <div className="no-scrollbar flex gap-2.5 overflow-x-auto pb-0.5">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              // One tap selects, and on the already-selected thumbnail opens the
              // viewer. Opening on every tap would make browsing the strip
              // impossible without repeatedly dismissing a full-screen overlay.
              onClick={() => (i === active ? openViewer(i) : setActive(i))}
              onDoubleClick={() => openViewer(i)}
              aria-label={t.gallery.imageNumber(arNum(i + 1, locale))}
              aria-current={i === active}
              className={clsx(
                "relative h-17.5 w-24 shrink-0 overflow-hidden rounded-xl border-2 bg-sand-200 transition md:h-22 md:w-31.5",
                i === active ? "border-gold-500" : "border-line hover:border-sand-400",
              )}
            >
              <Image
                src={img.url}
                alt=""
                fill
                sizes="126px"
                className="object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {viewerOpen && hasPhotos && (
        <Lightbox
          images={images}
          index={active}
          onIndexChange={setActive}
          onClose={() => setViewerOpen(false)}
          name={name}
        />
      )}
    </div>
  );
}
