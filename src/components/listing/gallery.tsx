"use client";

import Image from "next/image";
import { useState } from "react";
import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { useFavorites } from "@/components/site/favorites-provider";
import { arNum } from "@/lib/format";

/**
 * Listing gallery: one large hero plus a horizontal thumbnail strip.
 *
 * The hero is a plain swap rather than a lightbox/carousel library — the design
 * shows exactly this, and it keeps the page free of another JS dependency on
 * the most-visited template on the site.
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
  const { isFavorite, toggle } = useFavorites();
  const favorited = isFavorite(listingId);

  const hero = images[active];

  return (
    <div className="mb-3.5 flex flex-col gap-2.5">
      <div className="relative h-62.5 overflow-hidden rounded-[20px] bg-sand-200 md:h-[clamp(300px,42vw,480px)]">
        {hero ? (
          <Image
            src={hero.url}
            alt={hero.alt || name}
            fill
            // Full-bleed on phones, capped by the 1280px container on desktop.
            sizes="(max-width: 1280px) 100vw, 1280px"
            className="object-cover"
            // The gallery hero is this page's LCP element.
            priority
          />
        ) : (
          <div className="grid size-full place-items-center text-sand-400">
            <Icon name="image" size={56} />
          </div>
        )}

        <div className="pointer-events-none absolute bottom-3 end-3 flex gap-2">
          {verified && (
            <Badge tone="glass" icon="verified">
              مالك موثّق
            </Badge>
          )}
          {images.length > 0 && (
            <Badge tone="glass" icon="photo_library" className="text-sand-100">
              {arNum(images.length)} صورة
            </Badge>
          )}
        </div>

        <button
          type="button"
          onClick={() => toggle(listingId)}
          aria-label={favorited ? "إزالة من المفضلة" : "إضافة إلى المفضلة"}
          aria-pressed={favorited}
          className="absolute top-3 start-3 grid size-10 place-items-center rounded-full bg-surface/95 shadow-[0_4px_12px_rgb(0_0_0/0.18)] transition hover:scale-105"
        >
          <Icon
            name={favorited ? "favorite" : "favorite_border"}
            size={21}
            className={favorited ? "text-busy" : "text-ink"}
          />
        </button>
      </div>

      {images.length > 1 && (
        <div className="no-scrollbar flex gap-2.5 overflow-x-auto pb-0.5">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`صورة ${i + 1}`}
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
    </div>
  );
}
