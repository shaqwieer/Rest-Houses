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
  deleteListingImage,
  makeImageCover,
  saveListing,
} from "@/app/actions/listings";
import { AMENITIES, CATEGORIES, CITIES } from "@/lib/constants";
import { arNum } from "@/lib/format";

/**
 * Listing create/edit form — mobile-first, single column, thumb-sized controls.
 *
 * Images are handled separately from the text fields, and only for a listing
 * that already exists: uploading needs a listing id to attach rows to. On a new
 * listing the gallery block therefore tells the owner to save first, rather than
 * silently dropping their photos.
 */

export type ListingDraft = {
  id: string | null;
  name: string;
  description: string;
  city: string;
  area: string;
  pricePerNight: number;
  weekendPrice: number;
  capacity: number;
  lat: number;
  lng: number;
  amenityIds: string[];
  categoryIds: string[];
  verified: boolean;
  featured: boolean;
  published: boolean;
  ownerName: string;
  ownerWhatsapp: string;
  images: { id: string; url: string; alt: string }[];
};

export function ListingEditor({ draft }: { draft: ListingDraft }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [amenities, setAmenities] = useState<string[]>(draft.amenityIds);
  const [categories, setCategories] = useState<string[]>(draft.categoryIds);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [coordinates, setCoordinates] = useState(`${draft.lat}, ${draft.lng}`);

  const isNew = draft.id === null;

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
      setErrors({ coordinates: "اكتب الإحداثيات بالصيغة: 24.7614, 55.3340" });
      toast("الإحداثيات غير صحيحة", "error");
      return;
    }
    formData.set("lat", String(lat));
    formData.set("lng", String(lng));

    // Chips are React state, not form controls, so append them explicitly.
    for (const id of amenities) formData.append("amenities", id);
    for (const id of categories) formData.append("categories", id);

    startTransition(async () => {
      const result = await saveListing(formData);
      if (result.ok) {
        toast(result.message ?? "تم الحفظ");
        if (isNew && result.id) {
          // Land on the saved listing so images can be uploaded next.
          router.replace(`/admin/listings/${result.id}`);
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
      const result = await addListingImages(draft.id!, list);
      toast(result.ok ? (result.message ?? "تم الرفع") : result.error, result.ok ? "ok" : "error");
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (result.ok) router.refresh();
    });
  }

  function onDeleteImage(imageId: string) {
    startTransition(async () => {
      const result = await deleteListingImage(imageId);
      toast(result.ok ? (result.message ?? "تم") : result.error, result.ok ? "ok" : "error");
      if (result.ok) router.refresh();
    });
  }

  function onMakeCover(imageId: string) {
    startTransition(async () => {
      const result = await makeImageCover(imageId);
      toast(result.ok ? (result.message ?? "تم") : result.error, result.ok ? "ok" : "error");
      if (result.ok) router.refresh();
    });
  }

  const sectionLabel = "mb-2.5 text-[12.5px] font-bold text-bronze";

  return (
    <div className="animate-fade-up">
      <div className="mb-4.5 flex items-center gap-3">
        <Link
          href="/admin/listings"
          aria-label="رجوع"
          className="grid size-9 place-items-center rounded-xl border border-line bg-surface text-ink no-underline hover:no-underline"
        >
          {/* RTL: "back" points right */}
          <Icon name="arrow_forward" size={20} />
        </Link>
        <h1 className="m-0 font-display text-[19px] font-extrabold text-ink">
          {isNew ? "إضافة استراحة جديدة" : "تعديل بيانات الاستراحة"}
        </h1>
      </div>

      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-4 rounded-[28px] border border-line bg-surface p-4 shadow-e1 md:p-5"
      >
        {draft.id && <input type="hidden" name="id" value={draft.id} />}

        {/* ---- images ---- */}
        <div>
          <div className={sectionLabel}>صور الاستراحة</div>

          {isNew ? (
            <p className="m-0 flex items-center gap-2 rounded-[13px] border border-dashed border-sand-300 bg-sand-50 px-3.5 py-3 text-[12.5px] text-muted">
              <Icon name="info" size={18} className="text-bronze" />
              احفظ الاستراحة أولًا، ثم ستتمكّن من رفع الصور.
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
                        الغلاف
                      </span>
                    )}

                    <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-night-900/55 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                      {i !== 0 && (
                        <button
                          type="button"
                          onClick={() => onMakeCover(img.id)}
                          disabled={pending}
                          title="اجعلها الغلاف"
                          aria-label="اجعلها الغلاف"
                          className="grid size-7.5 place-items-center rounded-lg bg-surface text-ink"
                        >
                          <Icon name="star" size={16} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDeleteImage(img.id)}
                        disabled={pending}
                        title="حذف الصورة"
                        aria-label="حذف الصورة"
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
                    {uploading ? "جارٍ الرفع…" : "إضافة"}
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
              <p className="m-0 mt-2 text-[11.5px] text-muted">
                JPG أو PNG أو WebP — حتى ٢٠٠ ميغابايت للصورة. أول صورة هي الغلاف.
              </p>
            </>
          )}
        </div>

        <div className="h-px bg-line" />

        {/* ---- basics ---- */}
        <Field label="اسم الاستراحة" required error={errors.name}>
          <TextInput
            name="name"
            defaultValue={draft.name}
            placeholder="مثال: استراحة الرمال الذهبية"
            required
            invalid={Boolean(errors.name)}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="المدينة" required error={errors.city}>
            <Select name="city" defaultValue={draft.city} required>
              {CITIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.ar}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="المنطقة / الموقع" error={errors.area}>
            <TextInput name="area" defaultValue={draft.area} placeholder="لهباب – دبي" />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="سعر الليلة (د.إ)"
            required
            error={errors.pricePerNight}
          >
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
            label="سعر نهاية الأسبوع"
            hint="اتركه صفرًا ليساوي السعر العادي"
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

          <Field label="السعة (ضيف)" required error={errors.capacity}>
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

        <Field label="الوصف" error={errors.description}>
          <TextArea
            name="description"
            rows={5}
            defaultValue={draft.description}
            placeholder="اكتب وصفًا موجزًا يبرز ما يميّز استراحتك."
          />
        </Field>

        <div className="h-px bg-line" />

        {/* ---- categories ---- */}
        <div>
          <div className={sectionLabel}>المناسبات المناسبة</div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <Chip
                key={c.id}
                active={categories.includes(c.id)}
                onClick={() => toggle(categories, setCategories, c.id)}
              >
                <Icon name={c.icon as never} size={16} />
                {c.ar}
              </Chip>
            ))}
          </div>
        </div>

        {/* ---- amenities ---- */}
        <div>
          <div className={sectionLabel}>
            المرافق المتوفرة{" "}
            <span className="font-medium text-muted">({arNum(amenities.length)} مُحدَّد)</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {AMENITIES.map((a) => (
              <Chip
                key={a.id}
                active={amenities.includes(a.id)}
                onClick={() => toggle(amenities, setAmenities, a.id)}
              >
                <Icon name={a.icon as never} size={16} />
                {a.ar}
              </Chip>
            ))}
          </div>
        </div>

        <div className="h-px bg-line" />

        {/* ---- location ---- */}
        <Field
          label="الموقع على الخريطة"
          hint="انسخ الإحداثيات من خرائط جوجل والصقها هنا"
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
              className="min-w-0 flex-1 border-0 bg-transparent py-3 text-end text-[14.5px] text-ink outline-none"
            />
          </span>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="اسم المالك" error={errors.ownerName}>
            <TextInput name="ownerName" defaultValue={draft.ownerName} placeholder="أبو سلطان" />
          </Field>

          <Field
            label="واتساب المالك"
            hint="اتركه فارغًا لاستخدام رقم الموقع العام"
            error={errors.ownerWhatsapp}
          >
            <TextInput
              name="ownerWhatsapp"
              defaultValue={draft.ownerWhatsapp}
              dir="ltr"
              inputMode="tel"
              placeholder="+971 50 123 4567"
              className="text-end"
            />
          </Field>
        </div>

        <div className="h-px bg-line" />

        {/* ---- flags ---- */}
        <div className="flex flex-col gap-2.5">
          <ToggleRow
            name="published"
            defaultChecked={draft.published}
            icon="public"
            label="منشورة على الموقع"
            hint="عند إيقافها لن تظهر للزوار"
          />
          <ToggleRow
            name="verified"
            defaultChecked={draft.verified}
            icon="verified"
            label="موثّقة"
            hint="تظهر شارة «موثّقة» على البطاقة"
          />
          <ToggleRow
            name="featured"
            defaultChecked={draft.featured}
            icon="star"
            label="مميّزة في الصفحة الرئيسية"
            hint="تظهر في قسم «استراحات مميّزة»"
          />
        </div>

        {/* ---- save ---- */}
        <div className="sticky bottom-2 flex gap-2.5 pt-1.5">
          <button
            type="submit"
            disabled={pending}
            className="flex-1 rounded-2xl bg-night-900 p-4 font-display text-[15px] font-extrabold text-sand-50 shadow-e2 transition hover:bg-night-700 disabled:opacity-60"
          >
            {pending ? "جارٍ الحفظ…" : isNew ? "إنشاء الاستراحة" : "حفظ التعديلات"}
          </button>
          <Link
            href="/admin/listings"
            className="rounded-2xl border border-line bg-surface px-5 py-4 text-[14.5px] font-bold text-ink no-underline hover:no-underline"
          >
            إلغاء
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
