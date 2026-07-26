"use client";

import Link from "next/link";
import { ListingCard } from "@/components/listing/listing-card";
import type { ListingCardData } from "@/components/listing/card-data";
import { Icon } from "@/components/ui/icon";
import { ButtonLink } from "@/components/ui/button";
import { useFavorites } from "./favorites-provider";
import { arNum } from "@/lib/format";

/** Client half of the favourites page: filters the server-supplied cards by the
 *  ids in localStorage. */
export function FavoritesGrid({ all }: { all: ListingCardData[] }) {
  const { ids, ready, count, clear } = useFavorites();

  // Preserve the order the guest saved them in, not the catalogue order.
  const saved = ids
    .map((id) => all.find((l) => l.id === id))
    .filter((l): l is ListingCardData => Boolean(l));

  return (
    <div className="min-h-[70vh] bg-sand-50">
      <div className="mx-auto max-w-[1280px] px-4 pt-6.5 pb-18 md:px-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="m-0 mb-1.5 flex items-center gap-3 font-display text-[clamp(22px,2.8vw,32px)] font-extrabold text-ink">
              <Icon name="favorite" size={30} className="text-busy" />
              المفضلة
            </h1>
            <p className="m-0 text-[14.5px] text-muted">
              {/* Until the effect has read localStorage we don't know the count,
                  and rendering "٠" first would flash the wrong number. */}
              {ready ? (
                <>
                  <span className="font-bold text-bronze">{arNum(count)}</span> استراحة محفوظة —
                  تُحفظ على جهازك ولا تحتاج حسابًا.
                </>
              ) : (
                "جارٍ تحميل قائمتك…"
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <ButtonLink href="/listings" variant="secondary">
              <Icon name="add" size={18} />
              أضف المزيد
            </ButtonLink>
            {ready && count > 0 && (
              <button
                type="button"
                onClick={clear}
                className="rounded-full px-4 py-2.5 text-[13.5px] font-semibold text-muted transition hover:text-busy"
              >
                إفراغ القائمة
              </button>
            )}
          </div>
        </div>

        {!ready ? (
          // Skeletons rather than a spinner: same shape as the real grid, so the
          // layout doesn't jump when the cards arrive.
          <div className="grid gap-4.5 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-88 animate-pulse rounded-[20px] border border-line bg-surface"
              />
            ))}
          </div>
        ) : saved.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-sand-300 bg-surface px-6 py-14 text-center md:py-20">
            <Icon name="favorite_border" size={54} className="mx-auto text-sand-400" />
            <h2 className="mt-4 mb-2 font-display text-[20px] font-extrabold text-ink">
              قائمتك فارغة حتى الآن
            </h2>
            <p className="mx-auto m-0 mb-5.5 max-w-[42ch] text-[14.5px] leading-[1.85] text-muted">
              اضغط على أيقونة القلب في أي استراحة لحفظها هنا ومقارنتها لاحقًا قبل إرسال الطلب.
            </p>
            <ButtonLink href="/listings" size="lg">
              تصفّح الاستراحات
            </ButtonLink>
          </div>
        ) : (
          <div className="grid gap-4.5 sm:grid-cols-2 xl:grid-cols-3">
            {saved.map((listing) => (
              <ListingCard key={listing.id} listing={listing} showCityBadge />
            ))}
          </div>
        )}

        {ready && saved.length > 0 && saved.length < count && (
          // A saved id with no matching listing means it was unpublished or
          // deleted. Say so instead of silently showing fewer cards.
          <p className="mt-5 text-[13px] text-muted">
            بعض الاستراحات المحفوظة لم تعد متاحة.{" "}
            <Link href="/listings" className="text-bronze">
              تصفّح البدائل
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
