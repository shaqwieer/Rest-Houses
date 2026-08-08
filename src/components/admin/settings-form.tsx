"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { PhoneInput } from "@/components/ui/phone-input";
import { useToast } from "@/components/ui/toast";
import { removeLogo, saveSettings, uploadHeroImage, uploadLogo } from "@/app/actions/settings";
import { arNum } from "@/lib/format";
import { useLocale } from "@/lib/i18n/provider";
import { stayHourOptions } from "@/lib/clock";
import type { Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";

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
  /**
   * English copy. All optional — blank means "use the Arabic value", which is
   * what `localized()` in src/lib/settings.ts does. See the English-copy card
   * near the bottom of the form.
   */
  siteNameEn: string;
  taglineEn: string;
  addressLineEn: string;
  seoTitleEn: string;
  seoDescriptionEn: string;
  heroTitleEn: string;
  heroTitleAltEn: string;
  heroSubtitleEn: string;
  footerAboutEn: string;
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
  bankName: string;
  bankAccountHolder: string;
  bankAccountNumber: string;
  bankIban: string;
  tradeLicense: string;
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
  commissionPercent: number;
  reviewInviteDays: number;
  freeCancelHours: number;
  /** 0-23, or null while this row still answers with the legacy text below. */
  checkInHour: number | null;
  checkOutHour: number | null;
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
  { key: "presetDesertGold", accent: "#C9A44C", deep: "#A8873A" },
  { key: "presetCopper", accent: "#B9852F", deep: "#8F6420" },
  { key: "presetClay", accent: "#A2705B", deep: "#7E5342" },
  { key: "presetOlive", accent: "#7C8B6B", deep: "#5E6B4F" },
  { key: "presetDarkBronze", accent: "#8C6B3F", deep: "#6B4F2B" },
] as const;

export function SettingsForm({
  values,
  paymentState,
}: {
  values: SettingsFormValues;
  paymentState: "DISABLED" | "MISCONFIGURED" | "ENABLED";
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { t, locale } = useLocale();
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
        toast(result.message ?? t.common.saved);
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
      toast(
        result.ok ? (result.message ?? t.common.saved) : result.error,
        result.ok ? "ok" : "error",
      );
      if (logoInput.current) logoInput.current.value = "";
      if (result.ok) router.refresh();
    });
  }

  function onUploadHero(file: File | undefined) {
    if (!file) return;
    startTransition(async () => {
      const result = await uploadHeroImage(file);
      toast(
        result.ok ? (result.message ?? t.common.saved) : result.error,
        result.ok ? "ok" : "error",
      );
      if (heroInput.current) heroInput.current.value = "";
      if (result.ok) router.refresh();
    });
  }

  const mapSrc = `https://www.google.com/maps?q=${values.mapLat},${values.mapLng}&z=${values.mapZoom}&hl=ar&output=embed`;

  return (
    <form onSubmit={onSubmit} className="animate-fade-up">
      <h1 className="m-0 mb-1 font-display text-[20px] font-extrabold text-ink">
          {t.admin.settingsTitle}
        </h1>
      <p className="m-0 mb-4 text-[13.5px] leading-relaxed text-muted">
        {t.admin.settingsSubtitle}
      </p>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        {/* =============== identity =============== */}
        <Card icon="badge" title={t.admin.cardIdentity}>
          <Field label={t.admin.fieldSiteName} required error={errors.siteName}>
            <TextInput
              name="siteName"
              defaultValue={values.siteName}
              required
              invalid={Boolean(errors.siteName)}
            />
          </Field>

          <Field label={t.admin.fieldTagline} hint={t.admin.fieldTaglineHint}>
            <TextInput name="tagline" defaultValue={values.tagline} />
          </Field>

          <Field label={t.admin.fieldLogoGlyph} hint={t.admin.fieldLogoGlyphHint}>
            <TextInput name="logoGlyph" defaultValue={values.logoGlyph} maxLength={2} className="w-20 text-center" />
          </Field>

          {/* logo upload */}
          <div className="flex items-center gap-3 rounded-[13px] border border-line bg-sand-50 px-3 py-3">
            <div className="relative size-11 shrink-0 overflow-hidden rounded-xl bg-sand-200">
              {values.logoUrl ? (
                <Image src={values.logoUrl} alt={t.admin.logoAlt} fill sizes="44px" className="object-cover" />
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
              {t.admin.logoNote}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                onClick={() => logoInput.current?.click()}
                disabled={pending}
                title={t.admin.uploadLogo}
                aria-label={t.admin.uploadLogo}
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
                      toast(r.ok ? (r.message ?? t.common.saved) : r.error, r.ok ? "ok" : "error");
                      if (r.ok) router.refresh();
                    })
                  }
                  disabled={pending}
                  title={t.admin.removeLogo}
                  aria-label={t.admin.removeLogo}
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
        <Card icon="contact_phone" title={t.admin.cardContact}>
          <Field
            label={t.admin.fieldWhatsapp}
            required
            hint={t.admin.fieldWhatsappHint}
            error={errors.whatsappNumber}
          >
            <PhoneInput
              name="whatsappNumber"
              defaultValue={values.whatsappNumber}
              required
              invalid={Boolean(errors.whatsappNumber)}
              className="text-end"
            />
          </Field>

          <Field label={t.admin.fieldPhone} hint={t.admin.fieldPhoneHint} error={errors.phone}>
            <PhoneInput
              name="phone"
              defaultValue={values.phone}
              invalid={Boolean(errors.phone)}
              className="text-end"
            />
          </Field>

          <Field label={t.auth.email} error={errors.email}>
            <TextInput
              name="email"
              type="email"
              defaultValue={values.email}
              dir="ltr"
              invalid={Boolean(errors.email)}
              className="text-end"
            />
          </Field>

          <Field label={t.admin.fieldInstagram} hint={t.admin.fieldFullUrlHint} error={errors.instagram}>
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
            <Field label={t.admin.fieldTiktok} error={errors.tiktok}>
              <TextInput name="tiktok" defaultValue={values.tiktok} dir="ltr" className="text-end" />
            </Field>
            <Field label={t.admin.fieldYoutube} error={errors.youtube}>
              <TextInput name="youtube" defaultValue={values.youtube} dir="ltr" className="text-end" />
            </Field>
          </div>
        </Card>

        {/* =============== legal + banking ===============

            The account owners transfer their commission into, and the trade
            licence number the footer publishes. Grouped because both are the
            platform's own paperwork rather than anything a guest sees — and
            because an operator setting the site up fills them in together.

            Every field may be left blank: each of the two surfaces that reads
            them (step 6 of the booking workflow, the footer) renders nothing at
            all when they are empty, rather than an empty label. */}
        <Card icon="payments" title={t.admin.cardBanking}>
          <p className="m-0 text-[12px] leading-relaxed text-muted">
            {t.admin.bankingIntro}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.admin.fieldBankName} error={errors.bankName}>
              <TextInput
                name="bankName"
                defaultValue={values.bankName}
                placeholder={t.admin.fieldBankNamePlaceholder}
                invalid={Boolean(errors.bankName)}
              />
            </Field>

            <Field label={t.admin.fieldAccountHolder} error={errors.bankAccountHolder}>
              <TextInput
                name="bankAccountHolder"
                defaultValue={values.bankAccountHolder}
                invalid={Boolean(errors.bankAccountHolder)}
              />
            </Field>

            <Field label={t.admin.fieldAccountNumber} error={errors.bankAccountNumber}>
              <TextInput
                name="bankAccountNumber"
                defaultValue={values.bankAccountNumber}
                dir="ltr"
                invalid={Boolean(errors.bankAccountNumber)}
                className="text-end"
              />
            </Field>

            <Field
              label={t.admin.fieldIban}
              hint={t.admin.fieldIbanHint}
              error={errors.bankIban}
            >
              <TextInput
                name="bankIban"
                defaultValue={values.bankIban}
                dir="ltr"
                placeholder="AE000000000000000000000"
                invalid={Boolean(errors.bankIban)}
                className="text-end"
              />
            </Field>
          </div>

          <Field
            label={t.admin.fieldTradeLicense}
            hint={t.admin.fieldTradeLicenseHint}
            error={errors.tradeLicense}
          >
            <TextInput
              name="tradeLicense"
              defaultValue={values.tradeLicense}
              dir="ltr"
              invalid={Boolean(errors.tradeLicense)}
              className="text-end"
            />
          </Field>
        </Card>

        {/* =============== theme =============== */}
        <Card icon="palette" title={t.admin.cardColors}>
          <p className="m-0 text-[12px] leading-relaxed text-muted">
            {t.admin.colorsIntro}
          </p>

          <div>
            <div className="mb-2 text-[12.5px] font-bold text-bronze">{t.admin.colorPresets}</div>
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
                    title={t.admin[preset.key]}
                    aria-label={t.admin[preset.key]}
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
            <ColorField
            label={t.admin.colorAccentLabel}
            value={accent}
            onChange={setAccent}
            error={errors.colorAccent}
          />
            <ColorField
            label={t.admin.colorAccentDeepLabel}
            value={accentDeep}
            onChange={setAccentDeep}
            error={errors.colorAccentDeep}
          />
            <ColorField
            label={t.admin.colorNightLabel}
            value={night}
            onChange={setNight}
            error={errors.colorNight}
          />
            <ColorField
            label={t.admin.colorSandLabel}
            value={sand}
            onChange={setSand}
            error={errors.colorSand}
          />
          </div>

          {/* live preview so the effect is visible before saving */}
          <div className="rounded-[13px] border border-line p-3" style={{ background: sand }}>
            <div className="mb-2 text-[11.5px] font-bold" style={{ color: accentDeep }}>
              {t.admin.previewLabel}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-4 py-2 text-[13px] font-extrabold"
                style={{ background: `linear-gradient(140deg, ${accent}, ${accentDeep})`, color: night }}
              >
                {t.admin.previewPrimaryButton}
              </span>
              <span
                className="rounded-full px-4 py-2 text-[13px] font-bold"
                style={{ background: night, color: sand }}
              >
                {t.admin.previewDarkButton}
              </span>
              <span
                className="rounded-full px-3 py-1.5 text-[12px] font-bold"
                style={{ background: `color-mix(in srgb, ${accent} 22%, white)`, color: accentDeep }}
              >
                {t.admin.previewBadge}
              </span>
            </div>
          </div>
        </Card>

        {/* =============== location =============== */}
        <Card icon="pin_drop" title={t.admin.cardLocation}>
          <Field
            label={t.admin.fieldCoordinates}
            hint={t.admin.fieldCoordinatesHint}
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
            <Field label={t.admin.fieldZoom} hint={t.admin.fieldZoomHint}>
              <TextInput
                name="mapZoom"
                type="number"
                min={1}
                max={20}
                defaultValue={values.mapZoom}
              />
            </Field>
            <Field label={t.admin.fieldAddressLine}>
              <TextInput name="addressLine" defaultValue={values.addressLine} />
            </Field>
          </div>

          <div className="h-37.5 overflow-hidden rounded-[13px] border border-line bg-sand-200">
            <iframe
              src={mapSrc}
              title={t.admin.locationPreview}
              loading="lazy"
              className="size-full border-0"
            />
          </div>
          <p className="m-0 text-[11.5px] text-muted">
            {t.admin.previewAfterSave}
          </p>
        </Card>

        {/* =============== booking commercials =============== */}
        <Card icon="receipt_long" title={t.admin.cardBooking}>
          <div className="grid grid-cols-2 gap-3">
            {/* 0 is the shipped default and means "no service fee at all" —
                every fee line disappears from the listing card, the booking
                summary and the public copy rather than rendering "0%". The hint
                says so, because a field that silently removes UI when zeroed is
                otherwise indistinguishable from one that's broken. */}
            <Field
              label={t.admin.fieldServiceFee}
              hint={t.admin.fieldServiceFeeHint}
              error={errors.serviceFeePercent}
            >
              <TextInput
                name="serviceFeePercent"
                type="number"
                min={0}
                max={50}
                defaultValue={values.serviceFeePercent}
                className="font-bold"
              />
            </Field>
            <Field
            label={t.admin.fieldDepositDefault}
            hint={t.admin.fieldDepositDefaultHint}
            error={errors.depositPercent}
          >
              <TextInput
                name="depositPercent"
                type="number"
                min={0}
                max={100}
                defaultValue={values.depositPercent}
                className="font-bold"
              />
            </Field>
            {/* The platform's own cut — the opposite direction of travel from
                the service fee two fields up. That one is added to the guest's
                bill; this one is deducted from what the owner keeps and
                transferred to the platform at step 6 of the booking workflow.
                Kept side by side so the difference is visible where it is set. */}
            <Field
              label={t.admin.fieldCommission}
              hint={t.admin.fieldCommissionHint}
              error={errors.commissionPercent}
            >
              <TextInput
                name="commissionPercent"
                type="number"
                min={0}
                max={100}
                defaultValue={values.commissionPercent}
                className="font-bold"
              />
            </Field>
            <Field
              label={t.admin.fieldReviewInviteDays}
              hint={t.admin.fieldReviewInviteDaysHint}
              error={errors.reviewInviteDays}
            >
              <TextInput
                name="reviewInviteDays"
                type="number"
                min={1}
                max={365}
                defaultValue={values.reviewInviteDays}
                className="font-bold"
              />
            </Field>
            {/* These three are now the FALLBACK, not the answer. Each rest
                house can state its own arrival hour, departure hour and
                cancellation window in its listing editor; what is set here is
                what a listing that has stated none of its own shows. Said in
                the hints, because otherwise an operator edits this and wonders
                why one listing's page did not change. */}
            <Field
              label={t.admin.fieldFreeCancel}
              hint={t.admin.platformFallbackHint}
              error={errors.freeCancelHours}
            >
              <TextInput
                name="freeCancelHours"
                type="number"
                min={0}
                max={720}
                defaultValue={values.freeCancelHours}
                className="font-bold"
              />
            </Field>
            {/* Hours, not free text, and stored once for both languages — the
                same menu the listing editor offers. See src/lib/clock.ts. The
                first option keeps whatever text this row already had, so an
                operator who never opens this menu keeps their exact wording. */}
            <div className="grid gap-3">
              <Field label={t.admin.fieldCheckIn} hint={t.admin.platformFallbackHint}>
                <PlatformHourSelect
                  name="checkInHour"
                  hour={values.checkInHour}
                  legacyText={values.checkInTime}
                  locale={locale}
                  t={t}
                />
              </Field>
              <Field label={t.admin.fieldCheckOut} hint={t.admin.platformFallbackHint}>
                <PlatformHourSelect
                  name="checkOutHour"
                  hour={values.checkOutHour}
                  legacyText={values.checkOutTime}
                  locale={locale}
                  t={t}
                />
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
                  {t.admin.enableOnlineDeposit}
                </span>
                <span className="mt-1 block text-[11.5px] leading-relaxed text-muted">
                  {paymentState === "ENABLED"
                    ? t.admin.paymentEnabled
                    : paymentState === "MISCONFIGURED"
                      ? t.admin.paymentMisconfigured
                      : t.admin.paymentDisabled}
                </span>
              </span>
            </label>
            <p className="m-0 mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-bronze">
              <Icon name="info" size={14} className="mt-0.5 shrink-0" />
              {t.admin.gatewayNotWired}{" "}
              <code dir="ltr" className="font-mono">src/lib/payments/index.ts</code>.
            </p>
          </div>
        </Card>

        {/* =============== home page + SEO =============== */}
        <Card icon="image" title={t.admin.cardHomeSeo}>
          <Field label={t.admin.fieldHeroTitle} error={errors.heroTitle}>
            <TextInput name="heroTitle" defaultValue={values.heroTitle} />
          </Field>
          <Field label={t.admin.fieldHeroTitleAlt}>
            <TextInput name="heroTitleAlt" defaultValue={values.heroTitleAlt} />
          </Field>
          <Field label={t.admin.fieldHeroSubtitle}>
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
              {t.admin.heroImageNote}
            </span>
            <button
              type="button"
              onClick={() => heroInput.current?.click()}
              disabled={pending}
              title={t.admin.uploadHeroImage}
              aria-label={t.admin.uploadHeroImage}
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

          <Field label={t.admin.fieldFooterAbout}>
            <TextArea name="footerAbout" rows={3} defaultValue={values.footerAbout} />
          </Field>

          <div className="h-px bg-line" />

          <Field label={t.admin.fieldSeoTitle} hint={t.admin.fieldSeoTitleHint}>
            <TextInput name="seoTitle" defaultValue={values.seoTitle} maxLength={120} />
          </Field>
          <Field
            label={t.admin.fieldSeoDescription}
            hint={t.admin.seoDescriptionHint(arNum(values.seoDescription.length, locale))}
          >
            <TextArea name="seoDescription" rows={3} defaultValue={values.seoDescription} maxLength={320} />
          </Field>
        </Card>

        {/* =============== English copy ===============
            The site stores its marketing copy in the database, so the
            dictionary alone cannot translate it — the hero, tagline and SEO
            strings are values, not code. These fields are what make the English
            site fully English. Every one is optional: blank falls back to the
            Arabic text, so an operator who ignores this card still gets a
            working English site rather than an empty hero. */}
        <Card icon="public" title={t.admin.englishCopyCard}>
          <p className="m-0 text-[12px] leading-relaxed text-muted">
            {t.admin.englishCopyHint}
          </p>

          <Field label={t.admin.siteNameEnLabel}>
            <TextInput name="siteNameEn" dir="ltr" defaultValue={values.siteNameEn} />
          </Field>
          <Field label={t.admin.taglineEnLabel}>
            <TextInput name="taglineEn" dir="ltr" defaultValue={values.taglineEn} />
          </Field>

          <div className="h-px bg-line" />

          <Field label={t.admin.heroTitleEnLabel}>
            <TextInput name="heroTitleEn" dir="ltr" defaultValue={values.heroTitleEn} />
          </Field>
          <Field label={t.admin.heroTitleAltEnLabel}>
            <TextInput name="heroTitleAltEn" dir="ltr" defaultValue={values.heroTitleAltEn} />
          </Field>
          <Field label={t.admin.heroSubtitleEnLabel}>
            <TextArea name="heroSubtitleEn" dir="ltr" rows={3} defaultValue={values.heroSubtitleEn} />
          </Field>
          <Field label={t.admin.footerAboutEnLabel}>
            <TextArea name="footerAboutEn" dir="ltr" rows={3} defaultValue={values.footerAboutEn} />
          </Field>

          <div className="h-px bg-line" />

          <Field label={t.admin.seoTitleEnLabel}>
            <TextInput name="seoTitleEn" dir="ltr" defaultValue={values.seoTitleEn} maxLength={120} />
          </Field>
          <Field label={t.admin.seoDescriptionEnLabel}>
            <TextArea
              name="seoDescriptionEn"
              dir="ltr"
              rows={3}
              defaultValue={values.seoDescriptionEn}
              maxLength={320}
            />
          </Field>

          <div className="h-px bg-line" />

          <Field label={t.admin.addressLineEnLabel}>
            <TextInput name="addressLineEn" dir="ltr" defaultValue={values.addressLineEn} />
          </Field>
          {/* The English arrival and departure boxes are gone: both languages
              now come from one stored hour. */}
        </Card>
      </div>

      {/* save bar — sticky so it's reachable without scrolling back on a phone */}
      <div className="sticky bottom-2 mt-3.5">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-2xl bg-night-900 p-4 font-display text-[15px] font-extrabold text-sand-50 shadow-e2 transition hover:bg-night-700 disabled:opacity-60"
        >
          {pending ? t.common.saving : t.common.save}
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

/**
 * The platform's fallback arrival or departure hour.
 *
 * The listing editor's twin (`StayHourSelect`) has an "inherit" case; this one
 * does not, because the settings row *is* what everything else inherits. Its
 * blank option means "leave the text this row already has", which is what keeps
 * the change non-breaking: an operator who never touches the menu keeps their
 * own wording, and the fallback chain in src/lib/policies.ts keeps reading it.
 */
function PlatformHourSelect({
  name,
  hour,
  legacyText,
  locale,
  t,
}: {
  name: string;
  hour: number | null;
  legacyText: string;
  locale: Locale;
  t: Dictionary;
}) {
  return (
    <Select name={name} defaultValue={hour === null ? "" : String(hour)}>
      <option value="">{t.admin.keepCurrentTime(legacyText.trim() || "—")}</option>
      {stayHourOptions(locale).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}
