"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { Chip, Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import {
  addListingImages,
  addOwnerListingImages,
  deleteListingImage,
  deleteOwnerListingImage,
  makeImageCover,
  makeOwnerImageCover,
  saveListing,
  saveOwnerListing,
} from "@/app/actions/listings";
import { AMENITIES, CATEGORIES, CITIES, label } from "@/lib/constants";
import { useLocale } from "@/lib/i18n/provider";
import { arNum } from "@/lib/format";
import type { WeekendMode } from "@/lib/dates";

/**
 * Listing create/edit form — mobile-first, single column, thumb-sized controls.
 *
 * One component serves both dashboards, switched by `scope`:
 *   • "admin" — every field, including the editorial `verified`/`featured`
 *     badges and the owner assignment
 *   • "owner" — everything except those, because a listing's owner marking it
 *     "verified" would defeat the badge and self-featuring would let owners
 *     promote themselves onto the home page. The server enforces this
 *     independently (see `listingColumns` in actions/listings.ts); hiding the
 *     controls is the UX half of the same rule.
 *
 * Images are handled separately from the text fields, and only for a listing
 * that already exists: uploading needs a listing id to attach rows to. On a new
 * listing the gallery block therefore says to save first, rather than silently
 * dropping the photos.
 */

export type ListingDraft = {
  id: string | null;
  name: string;
  description: string;
  city: string;
  area: string;
  /**
   * English versions of the three free-text fields. All optional — blank means
   * "show the Arabic text to English readers too", which is what
   * `localizeListing()` in src/lib/listings.ts does. See the English card below
   * the description, and the note on `nameEn` in prisma/schema.prisma.
   */
  nameEn: string;
  descriptionEn: string;
  areaEn: string;
  pricePerNight: number;
  weekendPrice: number;
  /** Which days `weekendPrice` covers — "short" (Sat+Sun) or "long" (+Friday). */
  weekendMode: WeekendMode;
  /**
   * This rest house's own stay policy. "" on the times and null on the hours
   * mean "inherit the platform's", which is what a listing nobody has touched
   * carries — and null is NOT 0 on the hours: 0 is an owner saying they allow
   * no free cancellation. See `resolveFreeCancelHours` in src/lib/policies.ts.
   */
  checkInTime: string;
  checkInTimeEn: string;
  checkOutTime: string;
  checkOutTimeEn: string;
  freeCancelHours: number | null;
  /**
   * Day-use (بدون مبيت) rates, the hour the guest leaves by, and the refundable
   * security deposit. 0 / "" everywhere means "not offered", and a listing left
   * that way shows nothing extra to a visitor — which is why they are plain
   * numbers rather than nullable: there is no third "inherit" state to model.
   */
  dayUsePrice: number;
  dayUseWeekendPrice: number;
  dayUseCheckOutTime: string;
  dayUseCheckOutTimeEn: string;
  securityDeposit: number;
  /** Full profile URL, or "" for a rest house with no Instagram. */
  instagram: string;
  capacity: number;
  lat: number;
  lng: number;
  /** null = "use the platform default" — distinct from 0, "no deposit". */
  depositPercent: number | null;
  amenityIds: string[];
  categoryIds: string[];
  verified: boolean;
  featured: boolean;
  published: boolean;
  ownerName: string;
  ownerWhatsapp: string;
  ownerId: string | null;
  images: { id: string; url: string; alt: string }[];
};

export type OwnerOption = { id: string; name: string };

export function ListingEditor({
  draft,
  scope = "admin",
  platformDepositPercent,
  platformPolicy,
  owners = [],
  ownerWhatsapp,
}: {
  draft: ListingDraft;
  scope?: "admin" | "owner";
  /** Shown as the fallback hint next to the deposit field. */
  platformDepositPercent: number;
  /**
   * What a blank policy field resolves to, shown as the placeholder in each
   * box. Without it "leave blank for the default" asks the owner to trust a
   * default they cannot see — and the times are free text, so there is no way
   * for them to guess it.
   */
  platformPolicy: { checkInTime: string; checkOutTime: string; freeCancelHours: number };
  /** Admin only: the owners a listing can be assigned to. */
  owners?: OwnerOption[];
  /** Owner only: the number their listings will use, shown read-only. */
  ownerWhatsapp?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { t, locale } = useLocale();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [amenities, setAmenities] = useState<string[]>(draft.amenityIds);
  const [categories, setCategories] = useState<string[]>(draft.categoryIds);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [coordinates, setCoordinates] = useState(`${draft.lat}, ${draft.lng}`);

  const isNew = draft.id === null;
  const isOwner = scope === "owner";
  const backHref = isOwner ? "/owner/listings" : "/admin/listings";

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setErrors({});

    // Split the single "lat, lng" field the owner pastes from Google Maps.
    const [latRaw, lngRaw] = coordinates.split(",").map((p) => p.trim());
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setErrors({ coordinates: t.admin.coordinatesFormat });
      toast(t.admin.coordinatesInvalid, "error");
      return;
    }
    formData.set("lat", String(lat));
    formData.set("lng", String(lng));

    // Chips are React state, not form controls, so append them explicitly.
    for (const id of amenities) formData.append("amenities", id);
    for (const id of categories) formData.append("categories", id);

    startTransition(async () => {
      const result = isOwner
        ? await saveOwnerListing(formData)
        : await saveListing(formData);
      if (result.ok) {
        toast(result.message ?? t.common.saved);
        if (isNew && result.id) {
          // Land on the saved listing so images can be uploaded next.
          router.replace(`${backHref}/${result.id}`);
        } else {
          router.refresh();
        }
      } else {
        setErrors(result.fieldErrors ?? {});
        toast(result.error, "error");
      }
    });
  }

  function onPickFiles(files: FileList | null) {
    if (!files || files.length === 0 || !draft.id) return;
    const list = Array.from(files);

    setUploading(true);
    startTransition(async () => {
      const result = isOwner
        ? await addOwnerListingImages(draft.id!, list)
        : await addListingImages(draft.id!, list);
      toast(
        result.ok ? (result.message ?? t.common.saved) : result.error,
        result.ok ? "ok" : "error",
      );
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (result.ok) router.refresh();
    });
  }

  function onDeleteImage(imageId: string) {
    startTransition(async () => {
      const result = isOwner
        ? await deleteOwnerListingImage(imageId)
        : await deleteListingImage(imageId);
      toast(
        result.ok ? (result.message ?? t.common.deleted) : result.error,
        result.ok ? "ok" : "error",
      );
      if (result.ok) router.refresh();
    });
  }

  function onMakeCover(imageId: string) {
    startTransition(async () => {
      const result = isOwner ? await makeOwnerImageCover(imageId) : await makeImageCover(imageId);
      toast(
        result.ok ? (result.message ?? t.common.saved) : result.error,
        result.ok ? "ok" : "error",
      );
      if (result.ok) router.refresh();
    });
  }

  const sectionLabel = "mb-2.5 text-[12.5px] font-bold text-bronze";

  return (
    <div className="animate-fade-up">
      <div className="mb-4.5 flex items-center gap-3">
        <Link
          href={backHref}
          aria-label={t.common.back}
          className="grid size-9 place-items-center rounded-xl border border-line bg-surface text-ink no-underline hover:no-underline"
        >
          {/* The glyph points back along the reading direction, so it flips with
              the document: "forward" arrow in RTL is visually a back arrow. */}
          <Icon name={locale === "ar" ? "arrow_forward" : "arrow_back"} size={20} />
        </Link>
        <h1 className="m-0 font-display text-[19px] font-extrabold text-ink">
          {isNew ? t.admin.newListingTitle : t.admin.editListingTitle}
        </h1>
      </div>

      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-4 rounded-[28px] border border-line bg-surface p-4 shadow-e1 md:p-5"
      >
        {draft.id && <input type="hidden" name="id" value={draft.id} />}

        {/* ---- images ---- */}
        <div>
          <div className={sectionLabel}>{t.admin.photosLabel}</div>

          {isNew ? (
            <p className="m-0 flex items-center gap-2 rounded-[13px] border border-dashed border-sand-300 bg-sand-50 px-3.5 py-3 text-[12.5px] text-muted">
              <Icon name="info" size={18} className="text-bronze" />
              {t.admin.saveBeforePhotos}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
                {draft.images.map((img, i) => (
                  <div
                    key={img.id}
                    className="group relative aspect-4/3 overflow-hidden rounded-[13px] border border-line bg-sand-100"
                  >
                    <Image src={img.url} alt={img.alt} fill sizes="120px" className="object-cover" />

                    {i === 0 && (
                      <span className="absolute bottom-1 start-1 rounded-md bg-night-900/85 px-1.5 py-0.5 text-[9.5px] font-bold text-gold-300">
                        {t.admin.coverPhoto}
                      </span>
                    )}

                    <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-night-900/55 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                      {i !== 0 && (
                        <button
                          type="button"
                          onClick={() => onMakeCover(img.id)}
                          disabled={pending}
                          title={t.admin.makeCover}
                          aria-label={t.admin.makeCover}
                          className="grid size-7.5 place-items-center rounded-lg bg-surface text-ink"
                        >
                          <Icon name="star" size={16} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDeleteImage(img.id)}
                        disabled={pending}
                        title={t.admin.deletePhoto}
                        aria-label={t.admin.deletePhoto}
                        className="grid size-7.5 place-items-center rounded-lg bg-busy text-white"
                      >
                        <Icon name="delete" size={16} />
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || pending}
                  className="flex aspect-4/3 flex-col items-center justify-center gap-1 rounded-[13px] border-[1.5px] border-dashed border-sand-300 bg-sand-50 text-muted transition hover:border-gold-500 hover:text-bronze disabled:opacity-50"
                >
                  <Icon name={uploading ? "upload" : "add_photo_alternate"} size={22} />
                  <span className="text-[11px] font-semibold">
                    {uploading ? t.admin.uploading : t.common.add}
                  </span>
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                multiple
                onChange={(e) => onPickFiles(e.target.files)}
                className="hidden"
              />
              <p className="m-0 mt-2 text-[11.5px] text-muted">{t.admin.photoHint}</p>
            </>
          )}
        </div>

        <div className="h-px bg-line" />

        {/* ---- basics ---- */}
        <Field label={t.admin.listingName} required error={errors.name}>
          <TextInput
            name="name"
            defaultValue={draft.name}
            placeholder={t.admin.listingNamePlaceholder}
            required
            invalid={Boolean(errors.name)}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.listings.city} required error={errors.city}>
            <Select name="city" defaultValue={draft.city} required>
              {CITIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {label(c, locale)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t.admin.areaLabel} error={errors.area}>
            <TextInput
              name="area"
              defaultValue={draft.area}
              placeholder={t.admin.areaPlaceholder}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t.admin.pricePerNightLabel} required error={errors.pricePerNight}>
            <TextInput
              name="pricePerNight"
              type="number"
              min={1}
              defaultValue={draft.pricePerNight}
              required
              invalid={Boolean(errors.pricePerNight)}
              className="font-bold"
            />
          </Field>

          <Field
            label={t.admin.weekendPriceLabel}
            hint={t.admin.weekendPriceHint}
            error={errors.weekendPrice}
          >
            <TextInput
              name="weekendPrice"
              type="number"
              min={0}
              defaultValue={draft.weekendPrice}
              invalid={Boolean(errors.weekendPrice)}
              className="font-bold"
            />
          </Field>

          <Field label={t.admin.capacityLabel} required error={errors.capacity}>
            <TextInput
              name="capacity"
              type="number"
              min={1}
              defaultValue={draft.capacity}
              required
              invalid={Boolean(errors.capacity)}
              className="font-bold"
            />
          </Field>
        </div>

        {/* ---- weekend days + this rest house's own stay policy ----
            Two things that used to have one platform-wide answer and never
            should have. The weekend is three days in Sharjah and two elsewhere,
            so a single national constant charged Sharjah owners the weekday
            rate on their busiest night. The arrival hour and the cancellation
            window are the individual owner's terms, and printing the
            platform's on their page told guests something that was simply not
            true of that venue.

            Blank inherits, everywhere, and the placeholders show what blank
            resolves to right now — an owner who does not care scrolls past and
            keeps exactly the page they have today. */}
        <div className="rounded-[20px] border border-dashed border-sand-300 bg-sand-50 p-3.5">
          <div className="mb-1.5 flex items-center gap-2">
            <Icon name="event_repeat" size={18} className="text-bronze" />
            <span className="text-[12.5px] font-bold text-bronze">
              {t.admin.weekendModeCardTitle}
            </span>
          </div>
          <p className="m-0 mb-3 text-[11.5px] leading-relaxed text-muted">
            {t.admin.weekendModeCardHint}
          </p>

          <Field label={t.admin.weekendModeLabel} hint={t.admin.weekendModeHint}>
            <Select name="weekendMode" defaultValue={draft.weekendMode}>
              <option value="short">{t.admin.weekendModeShort}</option>
              <option value="long">{t.admin.weekendModeLong}</option>
            </Select>
          </Field>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field
              label={t.admin.listingCheckInLabel}
              hint={t.admin.usingPlatformTime(platformPolicy.checkInTime)}
              error={errors.checkInTime}
            >
              <TextInput
                name="checkInTime"
                defaultValue={draft.checkInTime}
                placeholder={platformPolicy.checkInTime}
              />
            </Field>

            <Field
              label={t.admin.listingCheckOutLabel}
              hint={t.admin.usingPlatformTime(platformPolicy.checkOutTime)}
              error={errors.checkOutTime}
            >
              <TextInput
                name="checkOutTime"
                defaultValue={draft.checkOutTime}
                placeholder={platformPolicy.checkOutTime}
              />
            </Field>

            {/* Blank ≠ 0 here, and the hint says so. Blank means "whatever the
                platform allows"; a typed 0 means this owner allows no free
                cancellation at all, and the listing page then says so in
                words. `defaultValue` is "" for null rather than 0 — rendering
                null as 0 would silently convert every inheriting listing into
                a no-cancellation one the first time it was saved. */}
            <Field
              label={t.admin.listingFreeCancelLabel}
              hint={
                errors.freeCancelHours ? undefined : t.admin.listingFreeCancelHint
              }
              error={errors.freeCancelHours}
            >
              <TextInput
                name="freeCancelHours"
                type="number"
                min={0}
                max={720}
                defaultValue={draft.freeCancelHours ?? ""}
                placeholder={String(platformPolicy.freeCancelHours)}
                invalid={Boolean(errors.freeCancelHours)}
                className="font-bold"
              />
            </Field>
          </div>

          {/* The two times are free text, so they need the English siblings
              every other stored string on a listing has. Blank falls back to
              the Arabic, which is at least this venue's real hour — never to
              the platform's, which would not be. */}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label={t.admin.listingCheckInEnLabel} error={errors.checkInTimeEn}>
              <TextInput
                name="checkInTimeEn"
                dir="ltr"
                defaultValue={draft.checkInTimeEn}
                placeholder={t.admin.listingCheckInEnPlaceholder}
              />
            </Field>
            <Field label={t.admin.listingCheckOutEnLabel} error={errors.checkOutTimeEn}>
              <TextInput
                name="checkOutTimeEn"
                dir="ltr"
                defaultValue={draft.checkOutTimeEn}
                placeholder={t.admin.listingCheckOutEnPlaceholder}
              />
            </Field>
          </div>
        </div>

        {/* ---- day use (بدون مبيت) ----
            Entirely optional, and the whole block is inert until a price is
            entered: at 0 nothing about it reaches the listing page, so an owner
            who does not offer day bookings sees the same page they have today.
            Grouped in its own dashed card for the same reason as the English
            block below — the common case is scrolling straight past it. */}
        <div className="rounded-[20px] border border-dashed border-sand-300 bg-sand-50 p-3.5">
          <div className="mb-1.5 flex items-center gap-2">
            <Icon name="schedule" size={18} className="text-bronze" />
            <span className="text-[12.5px] font-bold text-bronze">
              {t.admin.dayUseCardTitle}
            </span>
          </div>
          <p className="m-0 mb-3 text-[11.5px] leading-relaxed text-muted">
            {t.admin.dayUseCardHint}
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t.admin.dayUsePriceLabel} error={errors.dayUsePrice}>
              <TextInput
                name="dayUsePrice"
                type="number"
                min={0}
                defaultValue={draft.dayUsePrice}
                invalid={Boolean(errors.dayUsePrice)}
                className="font-bold"
              />
            </Field>

            <Field
              label={t.admin.dayUseWeekendPriceLabel}
              error={errors.dayUseWeekendPrice}
            >
              <TextInput
                name="dayUseWeekendPrice"
                type="number"
                min={0}
                defaultValue={draft.dayUseWeekendPrice}
                invalid={Boolean(errors.dayUseWeekendPrice)}
                className="font-bold"
              />
            </Field>

            <Field
              label={t.admin.dayUseCheckOutLabel}
              hint={t.admin.dayUseCheckOutHint}
              error={errors.dayUseCheckOutTime}
            >
              <TextInput
                name="dayUseCheckOutTime"
                defaultValue={draft.dayUseCheckOutTime}
                placeholder={t.admin.dayUseCheckOutPlaceholder}
              />
            </Field>
          </div>

          {/* The leave-by time is the one free-text value in this block, so it
              gets the same English sibling every other stored string on a
              listing has. Blank falls back to the Arabic. */}
          <Field
            label={t.admin.dayUseCheckOutEnLabel}
            error={errors.dayUseCheckOutTimeEn}
            className="mt-3"
          >
            <TextInput
              name="dayUseCheckOutTimeEn"
              dir="ltr"
              defaultValue={draft.dayUseCheckOutTimeEn}
              placeholder={t.admin.dayUseCheckOutEnPlaceholder}
            />
          </Field>
        </div>

        {/* ---- deposit ----
            Left blank the listing inherits the platform default; an explicit 0
            means no deposit at all. The hint names the default so an owner can
            see what "blank" resolves to without leaving the page. The amount is
            always recomputed on the server at booking time — nothing here is
            trusted for money. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t.owner.depositPercent}
            hint={
              errors.depositPercent
                ? undefined
                : `${t.owner.depositPercentHint} ${t.owner.usingPlatformDefault(
                    arNum(platformDepositPercent, locale),
                  )}`
            }
            error={errors.depositPercent}
          >
            <span className="flex items-center gap-2 rounded-[13px] border border-line bg-sand-50 px-3.5 focus-within:border-gold-500 focus-within:bg-surface">
              <Icon name="savings" size={20} className="text-bronze" />
              <input
                name="depositPercent"
                type="number"
                min={0}
                max={100}
                step={1}
                defaultValue={draft.depositPercent ?? ""}
                placeholder={String(platformDepositPercent)}
                className="min-w-0 flex-1 border-0 bg-transparent py-3 text-[14.5px] font-bold text-ink outline-none"
              />
              <span className="shrink-0 text-[12.5px] font-semibold text-muted">
                {t.owner.depositPercentSuffix}
              </span>
            </span>
          </Field>

          {/* ---- refundable security deposit ----
              A separate idea from the العربون above and deliberately next to
              it: the deposit is a share of the booking that the guest pays
              towards it, this is an amount that comes back. It is never added
              to the total, and 0 hides it from the listing page entirely. */}
          <Field
            label={t.owner.securityDeposit}
            hint={errors.securityDeposit ? undefined : t.owner.securityDepositHint}
            error={errors.securityDeposit}
          >
            <span className="flex items-center gap-2 rounded-[13px] border border-line bg-sand-50 px-3.5 focus-within:border-gold-500 focus-within:bg-surface">
              <Icon name="shield" size={20} className="text-bronze" />
              <input
                name="securityDeposit"
                type="number"
                min={0}
                step={1}
                defaultValue={draft.securityDeposit}
                className="min-w-0 flex-1 border-0 bg-transparent py-3 text-[14.5px] font-bold text-ink outline-none"
              />
              <span className="shrink-0 text-[12.5px] font-semibold text-muted">
                {t.common.aed}
              </span>
            </span>
          </Field>
        </div>

        {/* ---- the rest house's own Instagram ----
            Not the platform's account (that one lives in /admin/settings and
            appears in the footer) — this is the venue's own feed, which is
            where a guest goes looking for more photos before they book. Blank
            means no icon at all on the listing page. */}
        <Field
          label={t.admin.listingInstagram}
          hint={errors.instagram ? undefined : t.admin.listingInstagramHint}
          error={errors.instagram}
        >
          <TextInput
            name="instagram"
            defaultValue={draft.instagram}
            dir="ltr"
            placeholder="https://instagram.com/username"
            invalid={Boolean(errors.instagram)}
            className="text-end"
          />
        </Field>

        <Field label={t.admin.descriptionLabel} error={errors.description}>
          <TextArea
            name="description"
            rows={5}
            defaultValue={draft.description}
            placeholder={t.admin.descriptionPlaceholder}
          />
        </Field>

        <div className="h-px bg-line" />

        {/* ---- English version ----
            The name, the area line and the description are the only stored
            prose on a listing; everything else (city, amenities, occasions) is
            an id the interface already translates on its own. Without these
            three boxes the English site showed an English frame around Arabic
            content, which is what was reported.

            Grouped in one block rather than paired with each Arabic field so
            the common case — an owner who writes Arabic and stops — stays a
            short form they can scroll past. `dir="ltr"` on the inputs because
            the surrounding document is RTL and English typed into an RTL box
            puts its punctuation on the wrong end. */}
        <div className="rounded-[20px] border border-dashed border-sand-300 bg-sand-50 p-3.5">
          <div className="mb-1.5 flex items-center gap-2">
            <Icon name="public" size={18} className="text-bronze" />
            <span className="text-[12.5px] font-bold text-bronze">
              {t.admin.englishListingCard}
            </span>
          </div>
          <p className="m-0 mb-3 text-[11.5px] leading-relaxed text-muted">
            {t.admin.englishListingHint}
          </p>

          <div className="flex flex-col gap-3">
            <Field label={t.admin.listingNameEnLabel} error={errors.nameEn}>
              <TextInput
                name="nameEn"
                dir="ltr"
                defaultValue={draft.nameEn}
                placeholder={t.admin.listingNameEnPlaceholder}
                invalid={Boolean(errors.nameEn)}
              />
            </Field>

            <Field label={t.admin.areaEnLabel} error={errors.areaEn}>
              <TextInput
                name="areaEn"
                dir="ltr"
                defaultValue={draft.areaEn}
                placeholder={t.admin.areaEnPlaceholder}
                invalid={Boolean(errors.areaEn)}
              />
            </Field>

            <Field label={t.admin.descriptionEnLabel} error={errors.descriptionEn}>
              <TextArea
                name="descriptionEn"
                dir="ltr"
                rows={5}
                defaultValue={draft.descriptionEn}
                placeholder={t.admin.descriptionEnPlaceholder}
              />
            </Field>
          </div>
        </div>

        <div className="h-px bg-line" />

        {/* ---- categories ---- */}
        <div>
          <div className={sectionLabel}>{t.admin.occasionsLabel}</div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <Chip
                key={c.id}
                active={categories.includes(c.id)}
                onClick={() => toggle(categories, setCategories, c.id)}
              >
                <Icon name={c.icon as never} size={16} />
                {label(c, locale)}
              </Chip>
            ))}
          </div>
        </div>

        {/* ---- amenities ---- */}
        <div>
          <div className={sectionLabel}>
            {t.listings.amenities}{" "}
            <span className="font-medium text-muted">
              ({t.admin.selectedCount(arNum(amenities.length, locale))})
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {AMENITIES.map((a) => (
              <Chip
                key={a.id}
                active={amenities.includes(a.id)}
                onClick={() => toggle(amenities, setAmenities, a.id)}
              >
                <Icon name={a.icon as never} size={16} />
                {label(a, locale)}
              </Chip>
            ))}
          </div>
        </div>

        <div className="h-px bg-line" />

        {/* ---- location ---- */}
        <Field
          label={t.admin.mapLocationLabel}
          hint={t.admin.mapLocationHint}
          error={errors.coordinates}
        >
          <span className="flex items-center gap-2.5 rounded-[13px] border border-line bg-sand-50 px-3.5 focus-within:border-gold-500 focus-within:bg-surface">
            <Icon name="pin_drop" size={20} className="text-bronze" />
            <input
              value={coordinates}
              onChange={(e) => setCoordinates(e.target.value)}
              dir="ltr"
              inputMode="decimal"
              placeholder="24.7614, 55.3340"
              className="min-w-0 flex-1 border-0 bg-transparent py-3 text-[14.5px] text-ink outline-none"
            />
          </span>
        </Field>

        {/* ---- contact / owner ---- */}
        {isOwner ? (
          // An owner does not get a per-listing contact field: their listings all
          // resolve to the number on their profile, which is what makes changing
          // it once update every listing at once. Showing it read-only here makes
          // that relationship visible instead of leaving them hunting for a field
          // that isn't there.
          <div className="flex items-center gap-3 rounded-[13px] border border-line bg-sand-50 px-3.5 py-3">
            <Icon name="chat" size={20} className="text-wa" />
            <span className="flex-1">
              <span className="block text-[12.5px] font-bold text-bronze">
                {t.owner.whatsapp}
              </span>
              <span className="block text-[14px] font-bold text-ink" dir="ltr">
                {ownerWhatsapp || "—"}
              </span>
            </span>
            <Link
              href="/owner/profile"
              className="shrink-0 text-[12.5px] font-bold text-bronze no-underline hover:no-underline"
            >
              {t.common.edit}
            </Link>
          </div>
        ) : (
          <>
            {owners.length > 0 && (
              <Field label={t.admin.assignOwner} hint={t.admin.assignOwnerHint}>
                <Select name="ownerId" defaultValue={draft.ownerId ?? ""}>
                  <option value="">{t.admin.platformOwned}</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t.admin.ownerNameLabel} error={errors.ownerName}>
                <TextInput name="ownerName" defaultValue={draft.ownerName} />
              </Field>

              <Field
                label={t.admin.ownerWhatsappLabel}
                hint={t.admin.ownerWhatsappHint}
                error={errors.ownerWhatsapp}
              >
                <TextInput
                  name="ownerWhatsapp"
                  defaultValue={draft.ownerWhatsapp}
                  dir="ltr"
                  inputMode="tel"
                  placeholder="+971 50 123 4567"
                />
              </Field>
            </div>
          </>
        )}

        <div className="h-px bg-line" />

        {/* ---- flags ---- */}
        <div className="flex flex-col gap-2.5">
          <ToggleRow
            name="published"
            defaultChecked={draft.published}
            icon="public"
            label={t.admin.publishedToggle}
            hint={t.admin.publishedToggleHint}
          />
          {!isOwner && (
            <>
              <ToggleRow
                name="verified"
                defaultChecked={draft.verified}
                icon="verified"
                label={t.admin.verifiedToggle}
                hint={t.admin.verifiedToggleHint}
              />
              <ToggleRow
                name="featured"
                defaultChecked={draft.featured}
                icon="star"
                label={t.admin.featuredToggle}
                hint={t.admin.featuredToggleHint}
              />
            </>
          )}
        </div>

        {/* ---- save ---- */}
        <div className="sticky bottom-2 flex gap-2.5 pt-1.5">
          <button
            type="submit"
            disabled={pending}
            className="flex-1 rounded-2xl bg-night-900 p-4 font-display text-[15px] font-extrabold text-sand-50 shadow-e2 transition hover:bg-night-700 disabled:opacity-60"
          >
            {pending
              ? t.common.saving
              : isNew
                ? t.admin.createListing
                : t.admin.saveChanges}
          </button>
          <Link
            href={backHref}
            className="rounded-2xl border border-line bg-surface px-5 py-4 text-[14.5px] font-bold text-ink no-underline hover:no-underline"
          >
            {t.common.cancel}
          </Link>
        </div>
      </form>
    </div>
  );
}

/** Big, tappable switch row — sized for thumbs, not cursors. */
function ToggleRow({
  name,
  defaultChecked,
  icon,
  label,
  hint,
}: {
  name: string;
  defaultChecked: boolean;
  icon: "public" | "verified" | "star";
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-[13px] border border-line bg-sand-50 px-3.5 py-3 transition hover:border-gold-500">
      <Icon name={icon} size={20} className="text-bronze" />
      <span className="flex-1">
        <span className="block text-[14px] font-bold text-ink">{label}</span>
        <span className="block text-[11.5px] text-muted">{hint}</span>
      </span>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-5.5 shrink-0 accent-[var(--gold-600)]"
      />
    </label>
  );
}
