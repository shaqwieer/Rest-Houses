"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { removeLogo, saveSettings, uploadHeroImage, uploadLogo } from "@/app/actions/settings";
import { arNum } from "@/lib/format";

/**
 * Site settings.
 *
 * Everything brandable lives here, which is the point: the owner renames the
 * site, changes its colours, swaps the WhatsApp number and edits the home-page
 * copy without a developer or a deploy. The root layout reads these values on
 * every request (src/lib/settings.ts → src/lib/theme.ts), so a save takes effect
 * immediately across every page.
 */

export type SettingsFormValues = {
  siteName: string;
  tagline: string;
  logoGlyph: string;
  logoUrl: string | null;
  heroImageUrl: string | null;
  whatsappNumber: string;
  phone: string;
  email: string;
  instagram: string;
  tiktok: string;
  snapchat: string;
  youtube: string;
  mapLat: number;
  mapLng: number;
  mapZoom: number;
  addressLine: string;
  colorAccent: string;
  colorAccentDeep: string;
  colorNight: string;
  colorSand: string;
  serviceFeePercent: number;
  depositPercent: number;
  freeCancelHours: number;
  checkInTime: string;
  checkOutTime: string;
  depositPaymentsEnabled: boolean;
  heroTitle: string;
  heroTitleAlt: string;
  heroSubtitle: string;
  footerAbout: string;
  seoTitle: string;
  seoDescription: string;
};

/** Preset accent pairs, so the owner can rebrand in one tap instead of picking
 *  two harmonising hex values by hand. */
const ACCENT_PRESETS = [
  { name: "ذهبي صحراوي", accent: "#C9A44C", deep: "#A8873A" },
  { name: "نحاسي", accent: "#B9852F", deep: "#8F6420" },
  { name: "طيني", accent: "#A2705B", deep: "#7E5342" },
  { name: "زيتوني", accent: "#7C8B6B", deep: "#5E6B4F" },
  { name: "برونزي داكن", accent: "#8C6B3F", deep: "#6B4F2B" },
] as const;

export function SettingsForm({
  values,
  paymentStatusText,
}: {
  values: SettingsFormValues;
  paymentStatusText: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const logoInput = useRef<HTMLInputElement | null>(null);
  const heroInput = useRef<HTMLInputElement | null>(null);

  // Colours are local state so the live preview swatches update as they change.
  const [accent, setAccent] = useState(values.colorAccent);
  const [accentDeep, setAccentDeep] = useState(values.colorAccentDeep);
  const [night, setNight] = useState(values.colorNight);
  const [sand, setSand] = useState(values.colorSand);

  const [coordinates, setCoordinates] = useState(`${values.mapLat}, ${values.mapLng}`);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("coordinates", coordinates);
    formData.set("colorAccent", accent);
    formData.set("colorAccentDeep", accentDeep);
    formData.set("colorNight", night);
    formData.set("colorSand", sand);
    setErrors({});

    startTransition(async () => {
      const result = await saveSettings(formData);
      if (result.ok) {
        toast(result.message ?? "تم الحفظ");
        router.refresh();
      } else {
        setErrors(result.fieldErrors ?? {});
        toast(result.error, "error");
      }
    });
  }

  function onUploadLogo(file: File | undefined) {
    if (!file) return;
    startTransition(async () => {
      const result = await uploadLogo(file);
      toast(result.ok ? (result.message ?? "تم") : result.error, result.ok ? "ok" : "error");
      if (logoInput.current) logoInput.current.value = "";
      if (result.ok) router.refresh();
    });
  }

  function onUploadHero(file: File | undefined) {
    if (!file) return;
    startTransition(async () => {
      const result = await uploadHeroImage(file);
      toast(result.ok ? (result.message ?? "تم") : result.error, result.ok ? "ok" : "error");
      if (heroInput.current) heroInput.current.value = "";
      if (result.ok) router.refresh();
    });
  }

  const mapSrc = `https://www.google.com/maps?q=${values.mapLat},${values.mapLng}&z=${values.mapZoom}&hl=ar&output=embed`;

  return (
    <form onSubmit={onSubmit} className="animate-fade-up">
      <h1 className="m-0 mb-1 font-display text-[20px] font-extrabold text-ink">إعدادات الموقع</h1>
      <p className="m-0 mb-4 text-[13.5px] leading-relaxed text-muted">
        كل ما تعدّله هنا يظهر على الموقع فورًا — لا حاجة لتعديل الكود أو إعادة النشر.
      </p>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        {/* =============== identity =============== */}
        <Card icon="badge" title="الهوية">
          <Field label="اسم الموقع" required error={errors.siteName}>
            <TextInput
              name="siteName"
              defaultValue={values.siteName}
              required
              invalid={Boolean(errors.siteName)}
            />
          </Field>

          <Field label="الوصف المختصر" hint="يظهر تحت الاسم في الهيدر">
            <TextInput name="tagline" defaultValue={values.tagline} />
          </Field>

          <Field label="حرف الشعار" hint="يظهر داخل المربّع الذهبي عند عدم وجود صورة">
            <TextInput name="logoGlyph" defaultValue={values.logoGlyph} maxLength={2} className="w-20 text-center" />
          </Field>

          {/* logo upload */}
          <div className="flex items-center gap-3 rounded-[13px] border border-line bg-sand-50 px-3 py-3">
            <div className="relative size-11 shrink-0 overflow-hidden rounded-xl bg-sand-200">
              {values.logoUrl ? (
                <Image src={values.logoUrl} alt="الشعار" fill sizes="44px" className="object-cover" />
              ) : (
                <div
                  className="grid size-full place-items-center font-display text-[18px] font-extrabold text-night-900"
                  style={{ background: "linear-gradient(150deg, var(--gold-500), var(--bronze))" }}
                >
                  {values.logoGlyph}
                </div>
              )}
            </div>
            <div className="flex-1 text-[12px] leading-relaxed text-muted">
              الشعار يظهر في الهيدر والفوتر وصفحة الدخول.
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                onClick={() => logoInput.current?.click()}
                disabled={pending}
                title="رفع شعار"
                aria-label="رفع شعار"
                className="grid size-9 place-items-center rounded-[10px] bg-sand-100 text-ink hover:bg-gold-100 disabled:opacity-50"
              >
                <Icon name="upload" size={17} />
              </button>
              {values.logoUrl && (
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      const r = await removeLogo();
                      toast(r.ok ? (r.message ?? "تم") : r.error, r.ok ? "ok" : "error");
                      if (r.ok) router.refresh();
                    })
                  }
                  disabled={pending}
                  title="إزالة الشعار"
                  aria-label="إزالة الشعار"
                  className="grid size-9 place-items-center rounded-[10px] bg-busy-bg text-busy disabled:opacity-50"
                >
                  <Icon name="delete" size={17} />
                </button>
              )}
            </div>
            <input
              ref={logoInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              onChange={(e) => onUploadLogo(e.target.files?.[0])}
              className="hidden"
            />
          </div>
        </Card>

        {/* =============== contact =============== */}
        <Card icon="contact_phone" title="التواصل">
          <Field
            label="رقم الواتساب"
            required
            hint="يُستخدم في كل أزرار الواتساب على الموقع"
            error={errors.whatsappNumber}
          >
            <TextInput
              name="whatsappNumber"
              defaultValue={values.whatsappNumber}
              dir="ltr"
              inputMode="tel"
              required
              invalid={Boolean(errors.whatsappNumber)}
              className="text-end"
            />
          </Field>

          <Field label="رقم الهاتف" hint="يظهر في الشريط العلوي" error={errors.phone}>
            <TextInput
              name="phone"
              defaultValue={values.phone}
              dir="ltr"
              inputMode="tel"
              className="text-end"
            />
          </Field>

          <Field label="البريد الإلكتروني" error={errors.email}>
            <TextInput
              name="email"
              type="email"
              defaultValue={values.email}
              dir="ltr"
              invalid={Boolean(errors.email)}
              className="text-end"
            />
          </Field>

          <Field label="إنستغرام" hint="الرابط الكامل" error={errors.instagram}>
            <TextInput
              name="instagram"
              defaultValue={values.instagram}
              dir="ltr"
              placeholder="https://instagram.com/username"
              invalid={Boolean(errors.instagram)}
              className="text-end"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="تيك توك" error={errors.tiktok}>
              <TextInput name="tiktok" defaultValue={values.tiktok} dir="ltr" className="text-end" />
            </Field>
            <Field label="يوتيوب" error={errors.youtube}>
              <TextInput name="youtube" defaultValue={values.youtube} dir="ltr" className="text-end" />
            </Field>
          </div>
        </Card>

        {/* =============== theme =============== */}
        <Card icon="palette" title="الألوان">
          <p className="m-0 text-[12px] leading-relaxed text-muted">
            اختر لونين أساسيين وستُشتَق بقية التدرّجات تلقائيًا — الأزرار، الشارات، التقويم والخرائط.
          </p>

          <div>
            <div className="mb-2 text-[12.5px] font-bold text-bronze">مجموعات جاهزة</div>
            <div className="flex flex-wrap gap-2">
              {ACCENT_PRESETS.map((preset) => {
                const active = accent.toLowerCase() === preset.accent.toLowerCase();
                return (
                  <button
                    key={preset.accent}
                    type="button"
                    onClick={() => {
                      setAccent(preset.accent);
                      setAccentDeep(preset.deep);
                    }}
                    title={preset.name}
                    aria-label={preset.name}
                    aria-pressed={active}
                    className="size-10 rounded-xl border-2 transition hover:scale-105"
                    style={{
                      background: `linear-gradient(140deg, ${preset.accent}, ${preset.deep})`,
                      borderColor: active ? "var(--ink)" : "transparent",
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <ColorField label="اللون المميّز" value={accent} onChange={setAccent} error={errors.colorAccent} />
            <ColorField label="درجة أغمق" value={accentDeep} onChange={setAccentDeep} error={errors.colorAccentDeep} />
            <ColorField label="اللون الداكن" value={night} onChange={setNight} error={errors.colorNight} />
            <ColorField label="لون الخلفية" value={sand} onChange={setSand} error={errors.colorSand} />
          </div>

          {/* live preview so the effect is visible before saving */}
          <div className="rounded-[13px] border border-line p-3" style={{ background: sand }}>
            <div className="mb-2 text-[11.5px] font-bold" style={{ color: accentDeep }}>
              معاينة
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-4 py-2 text-[13px] font-extrabold"
                style={{ background: `linear-gradient(140deg, ${accent}, ${accentDeep})`, color: night }}
              >
                زر أساسي
              </span>
              <span
                className="rounded-full px-4 py-2 text-[13px] font-bold"
                style={{ background: night, color: sand }}
              >
                زر داكن
              </span>
              <span
                className="rounded-full px-3 py-1.5 text-[12px] font-bold"
                style={{ background: `color-mix(in srgb, ${accent} 22%, white)`, color: accentDeep }}
              >
                شارة
              </span>
            </div>
          </div>
        </Card>

        {/* =============== location =============== */}
        <Card icon="pin_drop" title="الموقع الجغرافي">
          <Field
            label="إحداثيات خرائط جوجل"
            hint="انسخها من خرائط جوجل والصقها كما هي"
            error={errors.coordinates}
          >
            <TextInput
              value={coordinates}
              onChange={(e) => setCoordinates(e.target.value)}
              dir="ltr"
              inputMode="decimal"
              placeholder="24.7614, 55.3340"
              invalid={Boolean(errors.coordinates)}
              className="text-end"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="مستوى التكبير" hint="١ (بعيد) – ٢٠ (قريب)">
              <TextInput
                name="mapZoom"
                type="number"
                min={1}
                max={20}
                defaultValue={values.mapZoom}
              />
            </Field>
            <Field label="العنوان النصّي">
              <TextInput name="addressLine" defaultValue={values.addressLine} />
            </Field>
          </div>

          <div className="h-37.5 overflow-hidden rounded-[13px] border border-line bg-sand-200">
            <iframe
              src={mapSrc}
              title="معاينة الموقع"
              loading="lazy"
              className="size-full border-0"
            />
          </div>
          <p className="m-0 text-[11.5px] text-muted">
            المعاينة تتحدّث بعد الحفظ.
          </p>
        </Card>

        {/* =============== booking commercials =============== */}
        <Card icon="receipt_long" title="شروط الحجز">
          <div className="grid grid-cols-2 gap-3">
            <Field label="رسوم الخدمة (٪)" error={errors.serviceFeePercent}>
              <TextInput
                name="serviceFeePercent"
                type="number"
                min={0}
                max={50}
                defaultValue={values.serviceFeePercent}
                className="font-bold"
              />
            </Field>
            <Field label="العربون (٪)" error={errors.depositPercent}>
              <TextInput
                name="depositPercent"
                type="number"
                min={0}
                max={100}
                defaultValue={values.depositPercent}
                className="font-bold"
              />
            </Field>
            <Field label="الإلغاء المجاني (ساعة)" error={errors.freeCancelHours}>
              <TextInput
                name="freeCancelHours"
                type="number"
                min={0}
                max={720}
                defaultValue={values.freeCancelHours}
                className="font-bold"
              />
            </Field>
            <div className="grid gap-3">
              <Field label="وقت الدخول">
                <TextInput name="checkInTime" defaultValue={values.checkInTime} />
              </Field>
              <Field label="وقت الخروج">
                <TextInput name="checkOutTime" defaultValue={values.checkOutTime} />
              </Field>
            </div>
          </div>

          {/* ---- online deposit: disabled stub ---- */}
          <div className="rounded-[13px] border border-dashed border-sand-300 bg-sand-50 p-3.5">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                name="depositPaymentsEnabled"
                defaultChecked={values.depositPaymentsEnabled}
                className="mt-0.5 size-5 shrink-0 accent-[var(--gold-600)]"
              />
              <span>
                <span className="block text-[13.5px] font-bold text-ink">
                  تفعيل دفع العربون إلكترونيًا
                </span>
                <span className="mt-1 block text-[11.5px] leading-relaxed text-muted">
                  {paymentStatusText}
                </span>
              </span>
            </label>
            <p className="m-0 mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-bronze">
              <Icon name="info" size={14} className="mt-0.5 shrink-0" />
              بوابة الدفع غير مربوطة بعد. الخطوات مكتوبة في{" "}
              <code dir="ltr" className="font-mono">src/lib/payments/index.ts</code>.
            </p>
          </div>
        </Card>

        {/* =============== home page + SEO =============== */}
        <Card icon="image" title="الصفحة الرئيسية و SEO">
          <Field label="عنوان الغلاف" error={errors.heroTitle}>
            <TextInput name="heroTitle" defaultValue={values.heroTitle} />
          </Field>
          <Field label="السطر الثاني (بلون مميّز)">
            <TextInput name="heroTitleAlt" defaultValue={values.heroTitleAlt} />
          </Field>
          <Field label="نص الغلاف">
            <TextArea name="heroSubtitle" rows={3} defaultValue={values.heroSubtitle} />
          </Field>

          {/* hero image */}
          <div className="flex items-center gap-3 rounded-[13px] border border-line bg-sand-50 px-3 py-3">
            <div className="relative h-11 w-16 shrink-0 overflow-hidden rounded-lg bg-sand-200">
              {values.heroImageUrl ? (
                <Image src={values.heroImageUrl} alt="" fill sizes="64px" className="object-cover" />
              ) : (
                <div className="grid size-full place-items-center text-sand-400">
                  <Icon name="image" size={18} />
                </div>
              )}
            </div>
            <span className="flex-1 text-[12px] leading-relaxed text-muted">
              صورة غلاف الصفحة الرئيسية. تُستخدم صورة أول استراحة مميّزة إن لم تُحدَّد.
            </span>
            <button
              type="button"
              onClick={() => heroInput.current?.click()}
              disabled={pending}
              title="رفع صورة الغلاف"
              aria-label="رفع صورة الغلاف"
              className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-sand-100 text-ink hover:bg-gold-100 disabled:opacity-50"
            >
              <Icon name="upload" size={17} />
            </button>
            <input
              ref={heroInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              onChange={(e) => onUploadHero(e.target.files?.[0])}
              className="hidden"
            />
          </div>

          <Field label="نص «عن الموقع» في الفوتر">
            <TextArea name="footerAbout" rows={3} defaultValue={values.footerAbout} />
          </Field>

          <div className="h-px bg-line" />

          <Field label="عنوان SEO" hint="يظهر في نتائج البحث">
            <TextInput name="seoTitle" defaultValue={values.seoTitle} maxLength={120} />
          </Field>
          <Field
            label="وصف SEO"
            hint={`الأفضل بين ١٢٠ و ١٦٠ حرفًا — حاليًا ${arNum(values.seoDescription.length)}`}
          >
            <TextArea name="seoDescription" rows={3} defaultValue={values.seoDescription} maxLength={320} />
          </Field>
        </Card>
      </div>

      {/* save bar — sticky so it's reachable without scrolling back on a phone */}
      <div className="sticky bottom-2 mt-3.5">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-2xl bg-night-900 p-4 font-display text-[15px] font-extrabold text-sand-50 shadow-e2 transition hover:bg-night-700 disabled:opacity-60"
        >
          {pending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
        </button>
      </div>
    </form>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3.5 rounded-[20px] border border-line bg-surface p-4.5 shadow-e1">
      <h2 className="m-0 flex items-center gap-2 font-display text-[15px] font-extrabold text-ink">
        <Icon name={icon} size={19} className="text-bronze" />
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Native colour picker plus the hex, because owners often have a brand hex. */
function ColorField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-bronze">{label}</span>
      <span className="flex items-center gap-2 rounded-[13px] border border-line bg-sand-50 px-2 py-2 focus-within:border-gold-500">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#C9A44C"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          aria-label={label}
          className="size-8 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-0"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          dir="ltr"
          className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[12.5px] font-semibold text-ink outline-none"
        />
      </span>
      {error && <span className="text-[11px] font-semibold text-busy">{error}</span>}
    </div>
  );
}
