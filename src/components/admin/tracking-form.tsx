"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import clsx from "clsx";
import { Icon, type IconName } from "@/components/ui/icon";
import { Field, TextInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { saveTracking } from "@/app/actions/tracking";
import { useLocale } from "@/lib/i18n/provider";
import { EVENT_MAP, TRACKED_EVENTS } from "@/lib/tracking-events";

/**
 * /admin/tracking — the media buyer's page.
 *
 * ─── Why this is not a card inside /admin/settings ───────────────────────────
 * It used to be. Site settings is the *operator's* surface — the name, the
 * colours, the WhatsApp number, the fees — changed once and then left alone. A
 * tracking configuration is a different person's job on a different day: it is
 * connected while a campaign is being set up, checked against Events Manager,
 * and changed again the next time an account moves. Two audiences, two rhythms,
 * two pages.
 *
 * Splitting them also removed a real hazard. `saveSettings` reads every field
 * as `formData.get(name) ?? ""`, so the moment the settings form stopped
 * rendering these inputs, saving an unrelated tagline would have silently wiped
 * the operator's Google tag. The fields are now written only by `saveTracking`,
 * which is the only form that posts them. See src/app/actions/tracking.ts.
 *
 * ─── What this form accepts ──────────────────────────────────────────────────
 * Identifiers, never code. Every platform below hands out a block of
 * `<script>`; the site assembles that itself from the id
 * (src/components/site/tracking-scripts.tsx), which is what keeps one
 * compromised admin session from becoming a script on every page of the site.
 *
 * ─── Why the events table is on the page ─────────────────────────────────────
 * A media buyer's next step after connecting a pixel is to build conversions
 * and audiences, and for that they need the exact event names the site sends —
 * which differ per platform for the same moment. Printing them here, from the
 * same table the browser fires from, means the names they type into Ads Manager
 * cannot drift from the names the site actually sends.
 */

export type TrackingFormValues = {
  googleTagId: string;
  googleAdsConversionLabel: string;
  googleAnalyticsId: string;
  gtmContainerId: string;
  metaPixelId: string;
  tiktokPixelId: string;
  snapchatPixelId: string;
  ownerAreaTracking: boolean;
};

export function TrackingForm({
  values,
  /**
   * Whether a container and a directly wired pixel are both configured,
   * computed server-side from the SAVED row — see `gtmOverlaps`. Passed in
   * rather than derived from the inputs because it answers "what is the site
   * doing right now", which is the question somebody who just came back from
   * Tag Manager is actually asking.
   */
  gtmOverlap,
}: {
  values: TrackingFormValues;
  gtmOverlap: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useLocale();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const tt = t.tracking;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setErrors({});

    startTransition(async () => {
      const result = await saveTracking(formData);
      if (result.ok) {
        toast(result.message ?? t.common.saved);
        router.refresh();
      } else {
        setErrors(result.fieldErrors ?? {});
        toast(result.error, "error");
      }
    });
  }

  // Reads the saved row, not the inputs: this block is the answer to "is it
  // live", and an unsaved keystroke has not made anything live.
  const platforms: { label: string; on: boolean }[] = [
    { label: tt.platformGoogleAds, on: Boolean(values.googleTagId) },
    { label: tt.platformGa4, on: Boolean(values.googleAnalyticsId) },
    { label: tt.platformGtm, on: Boolean(values.gtmContainerId) },
    { label: tt.platformMeta, on: Boolean(values.metaPixelId) },
    { label: tt.platformTiktok, on: Boolean(values.tiktokPixelId) },
    { label: tt.platformSnap, on: Boolean(values.snapchatPixelId) },
  ];
  const anyLive = platforms.some((p) => p.on);

  return (
    <form onSubmit={onSubmit} className="animate-fade-up">
      <h1 className="m-0 mb-1 font-display text-[20px] font-extrabold text-ink">{tt.title}</h1>
      <p className="m-0 mb-4 text-[13.5px] leading-relaxed text-muted">{tt.subtitle}</p>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        {/* =============== Google =============== */}
        <Card icon="donut_large" title={tt.googleCard}>
          <p className="m-0 text-[12px] leading-relaxed text-muted">{tt.googleHint}</p>

          <Field
            label={tt.fieldGoogleTagId}
            hint={tt.fieldGoogleTagIdHint}
            error={errors.googleTagId}
          >
            <TextInput
              name="googleTagId"
              dir="ltr"
              placeholder="AW-950802645"
              defaultValue={values.googleTagId}
              maxLength={40}
              invalid={Boolean(errors.googleTagId)}
            />
          </Field>

          <Field
            label={tt.fieldConversionLabel}
            hint={tt.fieldConversionLabelHint}
            error={errors.googleAdsConversionLabel}
          >
            <TextInput
              name="googleAdsConversionLabel"
              dir="ltr"
              placeholder="dVoECJ30sOQcENWxsMUD"
              defaultValue={values.googleAdsConversionLabel}
              maxLength={80}
              invalid={Boolean(errors.googleAdsConversionLabel)}
            />
          </Field>

          <Field label={tt.fieldGa4} hint={tt.fieldGa4Hint} error={errors.googleAnalyticsId}>
            <TextInput
              name="googleAnalyticsId"
              dir="ltr"
              placeholder="G-ABC123XYZ"
              defaultValue={values.googleAnalyticsId}
              maxLength={40}
              invalid={Boolean(errors.googleAnalyticsId)}
            />
          </Field>

          <Field label={tt.fieldGtm} hint={tt.fieldGtmHint} error={errors.gtmContainerId}>
            <TextInput
              name="gtmContainerId"
              dir="ltr"
              placeholder="GTM-ABC1234"
              defaultValue={values.gtmContainerId}
              maxLength={40}
              invalid={Boolean(errors.gtmContainerId)}
            />
          </Field>
        </Card>

        {/* =============== the pixels =============== */}
        <Card icon="bolt" title={tt.pixelsCard}>
          <p className="m-0 text-[12px] leading-relaxed text-muted">{tt.pixelsHint}</p>

          <Field
            label={tt.fieldMetaPixel}
            hint={tt.fieldMetaPixelHint}
            error={errors.metaPixelId}
          >
            <TextInput
              name="metaPixelId"
              dir="ltr"
              inputMode="numeric"
              placeholder="123456789012345"
              defaultValue={values.metaPixelId}
              maxLength={30}
              invalid={Boolean(errors.metaPixelId)}
            />
          </Field>

          <Field
            label={tt.fieldTiktokPixel}
            hint={tt.fieldTiktokPixelHint}
            error={errors.tiktokPixelId}
          >
            <TextInput
              name="tiktokPixelId"
              dir="ltr"
              placeholder="CO4A2JJC77UF1234ABCD"
              defaultValue={values.tiktokPixelId}
              maxLength={50}
              invalid={Boolean(errors.tiktokPixelId)}
            />
          </Field>

          <Field
            label={tt.fieldSnapPixel}
            hint={tt.fieldSnapPixelHint}
            error={errors.snapchatPixelId}
          >
            <TextInput
              name="snapchatPixelId"
              dir="ltr"
              placeholder="0a1b2c3d-4e5f-6789-abcd-ef0123456789"
              defaultValue={values.snapchatPixelId}
              maxLength={60}
              invalid={Boolean(errors.snapchatPixelId)}
            />
          </Field>
        </Card>

        {/* =============== status =============== */}
        <Card icon="visibility" title={tt.statusCard}>
          <p className="m-0 text-[12px] leading-relaxed text-muted">{tt.statusHint}</p>

          <div className="grid gap-1.5 sm:grid-cols-2">
            {platforms.map((platform) => (
              <span
                key={platform.label}
                className={clsx(
                  "flex items-center gap-2 rounded-xl border px-3 py-2 text-[12.5px] font-bold",
                  platform.on
                    ? "border-ok/40 bg-ok-bg text-ok"
                    : "border-line bg-sand-50 text-muted",
                )}
              >
                <Icon name={platform.on ? "check_circle" : "info"} size={16} />
                <span className="min-w-0 flex-1 truncate">{platform.label}</span>
                <span className="shrink-0 text-[11px] font-semibold">
                  {platform.on ? tt.connected : tt.notConnected}
                </span>
              </span>
            ))}
          </div>

          {!anyLive && (
            <p className="m-0 text-[12px] font-bold text-muted">{tt.nothingLive}</p>
          )}

          {values.googleTagId && (
            <p className="m-0 flex items-start gap-1.5 text-[12px] font-bold text-muted">
              <Icon
                name={values.googleAdsConversionLabel ? "check_circle" : "info"}
                size={16}
                className={values.googleAdsConversionLabel ? "text-ok" : "text-muted"}
              />
              {values.googleAdsConversionLabel ? tt.conversionOn : tt.conversionOff}
            </p>
          )}

          {/* Reported, never resolved. Silently suppressing one side would leave
              a tag configured here, shown as live, that never fires — a harder
              bug to find than the double count it would avoid. */}
          {gtmOverlap && (
            <p className="m-0 flex items-start gap-2 rounded-xl border border-gold-500/40 bg-gold-100 px-3 py-2.5 text-[12px] leading-relaxed font-semibold text-bronze">
              <Icon name="warning" size={17} className="mt-0.5 shrink-0" />
              {tt.gtmWarning}
            </p>
          )}
        </Card>

        {/* =============== where it runs =============== */}
        <Card icon="policy" title={tt.scopeCard}>
          <p className="m-0 text-[12px] leading-relaxed text-muted">{tt.scopeHint}</p>

          <div className="rounded-[13px] border border-dashed border-sand-300 bg-sand-50 p-3.5">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                name="ownerAreaTracking"
                defaultChecked={values.ownerAreaTracking}
                className="mt-0.5 size-5 shrink-0 accent-[var(--gold-600)]"
              />
              <span>
                <span className="block text-[13.5px] font-bold text-ink">
                  {tt.fieldOwnerArea}
                </span>
                <span className="mt-1 block text-[11.5px] leading-relaxed text-muted">
                  {tt.fieldOwnerAreaHint}
                </span>
              </span>
            </label>
          </div>
        </Card>

        {/* =============== the event map =============== */}
        <div className="lg:col-span-2">
          <Card icon="task_alt" title={tt.eventsCard}>
            <p className="m-0 text-[12px] leading-relaxed text-muted">{tt.eventsHint}</p>

            {/* Its own scroller: five columns of Latin event names do not fit a
                phone, and letting the page scroll sideways instead would break
                every other card on the screen. */}
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[640px] border-collapse text-[12px]">
                <thead>
                  <tr className="text-start text-[11.5px] font-bold text-bronze">
                    <th className="border-b border-line py-2 pe-3 text-start">{tt.colEvent}</th>
                    <th className="border-b border-line py-2 pe-3 text-start">{tt.colMeta}</th>
                    <th className="border-b border-line py-2 pe-3 text-start">{tt.colTiktok}</th>
                    <th className="border-b border-line py-2 pe-3 text-start">{tt.colSnap}</th>
                    <th className="border-b border-line py-2 text-start">{tt.colGoogle}</th>
                  </tr>
                </thead>
                <tbody>
                  {TRACKED_EVENTS.map((event) => {
                    const names = EVENT_MAP[event];
                    return (
                      <tr key={event}>
                        <td className="border-b border-line py-2 pe-3 font-semibold text-ink">
                          {tt.eventNames[event]}
                        </td>
                        <PlatformCell value={names.meta?.name ?? null} notSent={tt.notSent} />
                        <PlatformCell value={names.tiktok} notSent={tt.notSent} />
                        <PlatformCell value={names.snapchat} notSent={tt.notSent} />
                        <PlatformCell value={names.google} notSent={tt.notSent} last />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="m-0 text-[11.5px] leading-relaxed text-muted">{tt.pageViewNote}</p>
            <p className="m-0 text-[11.5px] leading-relaxed text-muted">{tt.ownerEventsNote}</p>
          </Card>
        </div>

        {/* =============== testing =============== */}
        <div className="lg:col-span-2">
          <Card icon="task_alt" title={tt.testCard}>
            <p className="m-0 text-[12.5px] leading-relaxed text-muted">{tt.testHint}</p>
          </Card>
        </div>
      </div>

      {/* save bar — sticky, so it is reachable without scrolling back on a phone */}
      <div className="sticky bottom-2 mt-3.5">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-2xl bg-night-900 p-4 font-display text-[15px] font-extrabold text-sand-50 shadow-e2 transition hover:bg-night-700 disabled:opacity-60"
        >
          {pending ? t.common.saving : tt.saveButton}
        </button>
      </div>
    </form>
  );
}

/** One platform's name for one event — always LTR, whatever the page is. */
function PlatformCell({
  value,
  notSent,
  last,
}: {
  value: string | null;
  notSent: string;
  last?: boolean;
}) {
  return (
    <td className={clsx("border-b border-line py-2", !last && "pe-3")}>
      {value ? (
        <code dir="ltr" className="font-mono text-[11.5px] text-ink">
          {value}
        </code>
      ) : (
        <span className="text-muted">{notSent}</span>
      )}
    </td>
  );
}

/** The settings form's card, in the one other place that needs the same shell. */
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
