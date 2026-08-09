"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import { Field, Select, TextInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import {
  addCalendarFeed,
  disableCalendarExport,
  enableCalendarExport,
  removeCalendarFeed,
  syncCalendarNow,
} from "@/app/actions/calendar";
import { CALENDAR_PLATFORMS, CALENDAR_PLATFORM_NAMES } from "@/lib/constants";
import type { CalendarFeedView } from "@/lib/calendar/feeds";
import { formatDateTime } from "@/lib/dates";
import { useLocale } from "@/lib/i18n/provider";

/**
 * Linking a rest house's calendar to Airbnb and Booking.com.
 *
 * Two halves, and the distinction is the thing an owner most often gets wrong:
 *
 *   IMPORT — URLs pasted from the other platforms. Bookings taken *there* close
 *            the day *here*.
 *   EXPORT — one URL from us, pasted into those platforms. Bookings taken
 *            *here* close the day *there*.
 *
 * Both are needed for the link to actually prevent double bookings, so the
 * panel shows them together and says which direction each one covers rather
 * than leaving an owner to infer it from the word "sync".
 *
 * Rendered for both dashboards: the operator sees it under /admin/calendar for
 * the listing they have selected, and an owner sees it on their own listing
 * page. The actions behind it authorise each caller separately — see
 * actions/calendar.ts — so `scope` here only changes wording.
 */
export function CalendarSyncPanel({
  scope,
  listingId,
  feeds,
  exportUrl,
}: {
  scope: "admin" | "owner";
  listingId: string;
  feeds: CalendarFeedView[];
  exportUrl: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useLocale();
  const [pending, startTransition] = useTransition();

  const [platform, setPlatform] = useState<string>("AIRBNB");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [copied, setCopied] = useState(false);

  function run(action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    startTransition(async () => {
      const result = await action();
      toast(
        result.ok ? (result.message ?? t.common.saved) : (result.error ?? t.common.saved),
        result.ok ? "ok" : "error",
      );
      if (result.ok) router.refresh();
    });
  }

  function onAdd() {
    if (url.trim().length === 0) {
      toast(t.calendar.urlRequired, "error");
      return;
    }
    run(async () => {
      const result = await addCalendarFeed(listingId, platform, url, label);
      if (result.ok) {
        setUrl("");
        setLabel("");
      }
      return result;
    });
  }

  async function onCopy() {
    if (!exportUrl) return;
    try {
      await navigator.clipboard.writeText(exportUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A denied clipboard permission is not an error worth a toast — the URL
      // is on screen and selectable.
    }
  }

  return (
    <section className="mt-4 animate-fade-up rounded-[20px] border border-line bg-surface p-4 shadow-e1">
      <header className="mb-1 flex items-center gap-2">
        <Icon name="event_repeat" size={20} className="text-bronze" />
        <h2 className="m-0 font-display text-[16px] font-extrabold text-ink">
          {t.calendar.title}
        </h2>
      </header>
      <p className="m-0 mb-4 text-[13px] leading-relaxed text-muted">
        {scope === "owner" ? t.calendar.introOwner : t.calendar.introAdmin}
      </p>

      {/* ── Import ─────────────────────────────────────────────────────── */}
      <h3 className="m-0 mb-1 text-[13.5px] font-bold text-ink">{t.calendar.importTitle}</h3>
      <p className="m-0 mb-3 text-[12.5px] leading-relaxed text-muted">
        {t.calendar.importHint}
      </p>

      {feeds.length > 0 && (
        <ul className="m-0 mb-3.5 flex list-none flex-col gap-2 p-0">
          {feeds.map((feed) => (
            <li
              key={feed.id}
              className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-sand-50 px-3.5 py-3"
            >
              <span className="font-bold text-[13px] text-ink">
                {feed.name || t.calendar.platformOther}
              </span>
              <span dir="ltr" className="text-[11.5px] text-off">
                {feed.urlHint}
              </span>

              <span className="ms-auto flex items-center gap-2">
                <FeedStatus feed={feed} />
                <button
                  type="button"
                  onClick={() => run(() => removeCalendarFeed(listingId, feed.id))}
                  disabled={pending}
                  aria-label={t.calendar.removeFeed}
                  title={t.calendar.removeFeed}
                  className="grid size-8 place-items-center rounded-xl border border-line text-muted transition hover:border-busy hover:text-busy disabled:opacity-50"
                >
                  <Icon name="delete" size={17} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mb-2.5 grid gap-2.5 sm:grid-cols-[minmax(0,10rem)_1fr]">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-bronze">{t.calendar.platform}</span>
          <Select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            disabled={pending}
          >
            {CALENDAR_PLATFORMS.map((id) => (
              <option key={id} value={id}>
                {CALENDAR_PLATFORM_NAMES[id] || t.calendar.platformOther}
              </option>
            ))}
          </Select>
        </label>

        <Field label={t.calendar.urlLabel} hint={t.calendar.urlHint}>
          <TextInput
            name="calendarUrl"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.airbnb.com/calendar/ical/…"
            // A URL is Latin text and must not be mirrored inside an RTL page.
            dir="ltr"
            disabled={pending}
          />
        </Field>
      </div>

      {platform === "OTHER" && (
        <div className="mb-2.5">
          <Field label={t.calendar.labelLabel}>
            <TextInput
              name="calendarLabel"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t.calendar.labelPlaceholder}
              disabled={pending}
            />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={onAdd}
          disabled={pending}
          className="flex items-center justify-center gap-2 rounded-2xl bg-night-900 p-3.5 text-[13px] font-bold text-sand-50 transition disabled:opacity-50"
        >
          <Icon name="link" size={18} />
          {t.calendar.addFeed}
        </button>
        <button
          type="button"
          onClick={() => run(() => syncCalendarNow(listingId))}
          disabled={pending || feeds.length === 0}
          className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-surface p-3.5 text-[13px] font-bold text-ink transition hover:border-gold-500 disabled:opacity-50"
        >
          <Icon name="event_repeat" size={18} />
          {pending ? t.calendar.syncing : t.calendar.syncNow}
        </button>
      </div>

      {/* ── Export ─────────────────────────────────────────────────────── */}
      <h3 className="m-0 mt-5 mb-1 border-t border-line pt-4 text-[13.5px] font-bold text-ink">
        {t.calendar.exportTitle}
      </h3>
      <p className="m-0 mb-3 text-[12.5px] leading-relaxed text-muted">
        {t.calendar.exportHint}
      </p>

      {exportUrl ? (
        <div className="flex flex-col gap-2.5">
          <code
            dir="ltr"
            className="block overflow-x-auto rounded-2xl border border-line bg-sand-50 px-3.5 py-3 text-[12px] text-ink"
          >
            {exportUrl}
          </code>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={onCopy}
              className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-surface p-3 text-[13px] font-bold text-ink transition hover:border-gold-500"
            >
              <Icon name={copied ? "check" : "content_copy"} size={17} />
              {copied ? t.common.copied : t.common.copy}
            </button>
            <button
              type="button"
              onClick={() => run(() => disableCalendarExport(listingId))}
              disabled={pending}
              className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-surface p-3 text-[13px] font-bold text-muted transition hover:border-busy hover:text-busy disabled:opacity-50"
            >
              <Icon name="close" size={17} />
              {t.calendar.exportDisable}
            </button>
          </div>
          <p className="m-0 text-[12px] leading-relaxed text-off">{t.calendar.exportPrivacy}</p>
          {/* Booking.com's export defaults to "booked and closed dates", which
              re-advertises a block it imported from us — so our own booking
              comes back as an external hold and lingers for a refresh cycle
              after it is cancelled. Choosing "booked only" there avoids it. */}
          <p className="m-0 text-[12px] leading-relaxed text-off">
            {t.calendar.exportBookingTip}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => run(() => enableCalendarExport(listingId))}
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface p-3.5 text-[13px] font-bold text-ink transition hover:border-gold-500 disabled:opacity-50"
        >
          <Icon name="link" size={18} />
          {t.calendar.exportEnable}
        </button>
      )}

      {/* The delay is a property of iCal, not of this implementation, and an
          owner who assumes it is instant will eventually take a double booking
          and blame the platform. So it is stated on the screen rather than in
          documentation nobody opens. */}
      <p className="m-0 mt-4 flex items-start gap-2 rounded-2xl bg-gold-100 px-4 py-3 text-[12.5px] leading-relaxed text-bronze">
        <Icon name="info" size={18} className="mt-px shrink-0" />
        <span>{t.calendar.latencyWarning}</span>
      </p>
    </section>
  );
}

/** Last-sync state for one feed: green when it worked, red with the reason. */
function FeedStatus({ feed }: { feed: CalendarFeedView }) {
  const { t, locale } = useLocale();

  if (feed.lastError) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-busy"
        // The stored value is a code, translated here — never the raw fetch
        // error, which can contain the feed URL.
        title={
          feed.lastOkAt
            ? t.calendar.lastOkAt(formatDateTime(feed.lastOkAt, locale))
            : t.calendar.neverSynced
        }
      >
        <Icon name="error" size={15} />
        {t.calendar.fetchError(feed.lastError)}
      </span>
    );
  }

  if (!feed.lastOkAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-off">
        <Icon name="schedule" size={15} />
        {t.calendar.neverSynced}
      </span>
    );
  }

  return (
    <span
      className={clsx("inline-flex items-center gap-1.5 text-[11.5px] font-bold text-ok")}
      title={t.calendar.lastOkAt(formatDateTime(feed.lastOkAt, locale))}
    >
      <Icon name="check_circle" size={15} />
      {t.calendar.daysImported(String(feed.lastDayCount))}
    </span>
  );
}
