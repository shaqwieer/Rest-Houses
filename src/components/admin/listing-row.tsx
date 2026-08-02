"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import {
  deleteListing,
  deleteOwnerListing,
  toggleListingPublished,
  toggleOwnerListingPublished,
} from "@/app/actions/listings";
import { useLocale } from "@/lib/i18n/provider";
import { arNum } from "@/lib/format";

export type AdminListingRowData = {
  id: string;
  slug: string;
  name: string;
  area: string;
  pricePerNight: number;
  capacity: number;
  coverUrl: string | null;
  published: boolean;
  verified: boolean;
  featured: boolean;
  /** True when the listing is hidden from the public because of owner state. */
  hiddenByOwnerState?: boolean;
};

/**
 * One listing card in the admin or owner grid, with inline publish/edit/delete.
 *
 * `scope` picks which server actions run. The owner variants are scoped by
 * `ownerId` in their WHERE clause, so an owner cannot act on a listing that
 * isn't theirs even if they forge an id — the choice here is about which
 * endpoint to call, never about whether the caller is allowed.
 */
export function AdminListingRow({
  listing,
  scope = "admin",
}: {
  listing: AdminListingRowData;
  scope?: "admin" | "owner";
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { t, locale } = useLocale();
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isOwner = scope === "owner";
  const editHref = isOwner ? `/owner/listings/${listing.id}` : `/admin/listings/${listing.id}`;

  function onTogglePublished() {
    startTransition(async () => {
      const result = isOwner
        ? await toggleOwnerListingPublished(listing.id)
        : await toggleListingPublished(listing.id);
      toast(
        result.ok ? (result.message ?? t.common.saved) : result.error,
        result.ok ? "ok" : "error",
      );
      if (result.ok) router.refresh();
    });
  }

  function onDelete() {
    startTransition(async () => {
      const result = isOwner
        ? await deleteOwnerListing(listing.id)
        : await deleteListing(listing.id);
      toast(
        result.ok ? (result.message ?? t.common.deleted) : result.error,
        result.ok ? "ok" : "error",
      );
      setConfirmingDelete(false);
      if (result.ok) router.refresh();
    });
  }

  const publishLabel = listing.published ? t.common.unpublished : t.common.published;

  return (
    <div className="flex gap-3 rounded-[20px] border border-line bg-surface p-3 shadow-e1">
      <div className="relative size-19 shrink-0 overflow-hidden rounded-[13px] bg-sand-200">
        {listing.coverUrl ? (
          <Image src={listing.coverUrl} alt="" fill sizes="76px" className="object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-sand-400">
            <Icon name="image" size={24} />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="m-0 truncate font-display text-[14.5px] font-bold leading-snug text-ink">
            {listing.name}
          </h2>
          <span className="flex shrink-0 gap-1">
            {listing.featured && <Badge tone="gold">{t.admin.featured}</Badge>}
            {listing.published ? (
              listing.verified ? (
                <Badge tone="ok">{t.common.verified}</Badge>
              ) : (
                <Badge tone="sand">{t.admin.publishedBadge}</Badge>
              )
            ) : (
              <Badge tone="busy">{t.admin.hiddenBadge}</Badge>
            )}
          </span>
        </div>

        {/* A listing can be `published` and still invisible to the public because
            its owner lapsed. Saying so here is the difference between an owner
            thinking the site is broken and an owner renewing their membership. */}
        {listing.hiddenByOwnerState && (
          <p className="m-0 flex items-center gap-1.5 rounded-lg bg-busy-bg px-2 py-1 text-[11.5px] font-semibold text-busy">
            <Icon name="visibility_off" size={14} />
            {t.admin.hiddenByOwnerState}
          </p>
        )}

        <div className="flex items-center gap-1 text-[12px] text-muted">
          <Icon name="location_on" size={14} />
          <span className="truncate">{listing.area}</span>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="text-[13px] text-ink">
            <strong className="font-display text-[15px]">
              {arNum(listing.pricePerNight, locale)}
            </strong>{" "}
            {t.common.aed} · {arNum(listing.capacity, locale)} {t.common.guest}
          </span>

          <span className="flex gap-1.5">
            <Link
              href={`/listings/${encodeURIComponent(listing.slug)}`}
              target="_blank"
              title={t.admin.viewOnSite}
              aria-label={t.admin.viewOnSite}
              className="grid size-8 place-items-center rounded-[10px] bg-sand-100 text-ink no-underline transition hover:bg-gold-100 hover:no-underline"
            >
              <Icon name="public" size={17} />
            </Link>

            <button
              type="button"
              onClick={onTogglePublished}
              disabled={pending}
              title={publishLabel}
              aria-label={publishLabel}
              className="grid size-8 place-items-center rounded-[10px] bg-sand-100 text-ink transition hover:bg-gold-100 disabled:opacity-40"
            >
              <Icon name={listing.published ? "visibility" : "visibility_off"} size={17} />
            </button>

            <Link
              href={editHref}
              title={t.common.edit}
              aria-label={t.common.edit}
              className="grid size-8 place-items-center rounded-[10px] bg-sand-100 text-ink no-underline transition hover:bg-gold-100 hover:no-underline"
            >
              <Icon name="edit" size={17} />
            </Link>

            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={pending}
              title={t.common.delete}
              aria-label={t.common.delete}
              className="grid size-8 place-items-center rounded-[10px] bg-busy-bg text-busy transition hover:bg-[#f0d2cc] disabled:opacity-40"
            >
              <Icon name="delete" size={17} />
            </button>
          </span>
        </div>
      </div>

      {/* Deleting cascades to bookings and reviews, so it gets an explicit
          confirm step rather than a one-tap destructive action. */}
      {confirmingDelete && (
        <div className="fixed inset-0 z-300 grid place-items-center bg-night-900/60 p-4 backdrop-blur-sm">
          <div className="animate-pop-in w-full max-w-95 rounded-[24px] border border-line bg-surface p-5 shadow-e2">
            <div className="mx-auto mb-3.5 grid size-14 place-items-center rounded-full bg-busy-bg">
              <Icon name="delete" size={28} className="text-busy" />
            </div>
            <h2 className="m-0 mb-2 text-center font-display text-[17px] font-extrabold text-ink">
              {t.admin.confirmDeleteTitle(listing.name)}
            </h2>
            <p className="m-0 mb-4.5 text-center text-[13.5px] leading-relaxed text-muted">
              {t.admin.confirmDeleteBody}
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={onDelete}
                disabled={pending}
                className="flex-1 rounded-2xl bg-busy p-3.5 text-[14px] font-bold text-white disabled:opacity-60"
              >
                {pending ? t.admin.deleting : t.admin.confirmDeleteYes}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={pending}
                className="rounded-2xl border border-line bg-surface px-5 py-3.5 text-[14px] font-bold text-ink"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
