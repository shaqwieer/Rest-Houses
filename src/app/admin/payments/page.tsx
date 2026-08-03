import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/badge";
import {
  AdminFilterChips,
  AdminPagination,
  AdminSearch,
  AdminTable,
  EmptyRow,
  Td,
  Th,
} from "@/components/admin/table-shell";
import { requireAdminPage } from "@/lib/auth";
import { listBookings, readPage, revenueTotals } from "@/lib/admin-queries";
import { BOOKING_STATUSES, isBookingStatus, stageNumber } from "@/lib/constants";
import { getSettings } from "@/lib/settings";
import { getI18n } from "@/lib/i18n/server";
import { arNum } from "@/lib/format";
import { arDayMonth } from "@/lib/dates";

/**
 * Revenue and commission.
 *
 * ─── What changed, and why ──────────────────────────────────────────────────
 * This page used to be "payments and deposits": four tiles, two of them
 * deposits, and two table columns for the deposit rate and the deposit due.
 * None of that was the platform's business. A deposit is money the OWNER
 * collects from the guest as part of the booking total — it is not revenue,
 * it is not owed to the platform, and putting it beside the total meant the
 * same dirhams were counted twice on one screen.
 *
 * What the operator actually needs to know is two numbers: the value flowing
 * through the platform, and the commission owed on it — split by whether it
 * has actually arrived. The deposit did not disappear; it moved to step 1 of
 * the booking workflow, where the person who collects it records it.
 */
export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();

  const sp = await searchParams;
  const { t, locale } = await getI18n();

  const page = readPage(sp.page);
  const search = typeof sp.q === "string" ? sp.q : "";
  const status = isBookingStatus(sp.status) ? sp.status : "all";

  const [result, totals, settings] = await Promise.all([
    listBookings({ page, search, status }),
    revenueTotals(),
    getSettings(),
  ]);

  const money = (n: number) => `${arNum(n, locale)} ${t.common.aed}`;
  const percent = (n: number) => `${arNum(n, locale)}${locale === "ar" ? "٪" : "%"}`;

  return (
    <div className="animate-fade-up">
      <div className="mb-4">
        <h1 className="m-0 font-display text-[20px] font-extrabold text-ink">
          {t.admin.paymentsTitle}
        </h1>
        <p className="m-0 text-[12.5px] text-muted">{t.admin.paymentsSubtitle}</p>
      </div>

      {/*
        Two figures, stated at two different weights.

        The booking value is the headline — it is the number that describes the
        business. The commission tiles sit beside it in the accent colour
        because they are the number that describes this platform's income, and
        splitting "owed" from "received" is the only way the outstanding column
        is ever chased.
      */}
      <div className="mb-3 grid gap-2.5 md:grid-cols-2">
        <HeadlineTile
          label={t.admin.confirmedValueTile}
          value={money(totals.totalConfirmed)}
          sub={`${t.admin.allValueTile}: ${money(totals.totalAll)}`}
          icon="payments"
        />
        <HeadlineTile
          label={t.admin.commissionConfirmedTile}
          value={money(totals.commissionConfirmed)}
          sub={t.admin.commissionRateNote(percent(settings.commissionPercent))}
          icon="receipt_long"
          accent
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5">
        <SmallTile
          label={t.admin.commissionCollectedTile}
          value={money(totals.commissionCollected)}
          tone="ok"
        />
        <SmallTile
          label={t.admin.commissionOutstandingTile}
          value={money(totals.commissionOutstanding)}
          tone={totals.commissionOutstanding > 0 ? "busy" : "muted"}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <AdminSearch />
      </div>

      <div className="mb-3">
        <AdminFilterChips
          param="status"
          options={[
            { value: "all", label: t.common.all },
            ...BOOKING_STATUSES.map((s) => ({ value: s, label: t.status[s] })),
          ]}
        />
      </div>

      <AdminTable>
        <thead>
          <tr>
            <Th>{t.booking.reference}</Th>
            <Th>{t.admin.listings}</Th>
            <Th>{t.booking.fullName}</Th>
            <Th>{t.listing.dates}</Th>
            <Th>{t.listing.total}</Th>
            <Th>{t.admin.commissionCol}</Th>
            <Th>{t.admin.commissionStateCol}</Th>
            <Th>{t.admin.stageCol}</Th>
            <Th>{t.common.status}</Th>
          </tr>
        </thead>
        <tbody>
          {result.rows.length === 0 ? (
            <EmptyRow colSpan={9} message={t.admin.noPayments} />
          ) : (
            result.rows.map((b) => (
              <tr key={b.id}>
                <Td className="text-[12px]">
                  <span dir="ltr" className="font-bold">
                    {b.reference}
                  </span>
                </Td>
                <Td>
                  <Link
                    href={`/listings/${encodeURIComponent(b.listing.slug)}`}
                    target="_blank"
                    className="text-ink no-underline hover:text-bronze hover:no-underline"
                  >
                    {b.listing.name}
                  </Link>
                  {b.listing.owner && (
                    <span className="block text-[11px] text-muted">
                      {b.listing.owner.businessName || b.listing.owner.fullName}
                    </span>
                  )}
                </Td>
                <Td>{b.customerName}</Td>
                <Td className="text-[12px] whitespace-nowrap">
                  {arDayMonth(b.checkIn, locale)} – {arDayMonth(b.checkOut, locale)}
                </Td>
                <Td className="font-bold whitespace-nowrap">{money(b.total)}</Td>
                <Td className="font-bold whitespace-nowrap text-bronze">
                  {money(b.commissionDue)}
                  <span className="block text-[10.5px] font-medium text-muted">
                    {percent(b.commissionPercent)}
                  </span>
                </Td>
                <Td>
                  <CommissionState booking={b} />
                </Td>
                <Td className="text-[11.5px] whitespace-nowrap text-muted">
                  {b.status === "CONFIRMED"
                    ? b.stage === "DONE"
                      ? t.workflow.completed
                      : t.workflow.stepOf(arNum(stageNumber(b.stage), locale), arNum(7, locale))
                    : "—"}
                </Td>
                <Td>
                  <StatusBadge status={b.status} />
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </AdminTable>

      <AdminPagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
      />
    </div>
  );
}

/**
 * Where one booking's commission has got to.
 *
 * Four states, not two, because "the owner says they sent it" and "we have it"
 * are genuinely different facts and the gap between them is the only thing on
 * this page worth chasing.
 */
async function CommissionState({
  booking,
}: {
  booking: {
    status: string;
    commissionSentAt: Date | null;
    commissionConfirmedAt: Date | null;
  };
}) {
  const { t } = await getI18n();

  if (booking.status !== "CONFIRMED") {
    return <span className="text-[11.5px] text-off">{t.admin.commissionNotDue}</span>;
  }
  if (booking.commissionConfirmedAt) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-ok-bg px-2.5 py-1 text-[11.5px] font-bold text-ok">
        <Icon name="check" size={13} />
        {t.admin.commissionReceived}
      </span>
    );
  }
  if (booking.commissionSentAt) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gold-100 px-2.5 py-1 text-[11.5px] font-bold text-bronze">
        <Icon name="schedule" size={13} />
        {t.admin.commissionSent}
      </span>
    );
  }
  return (
    <span className="text-[11.5px] font-semibold text-muted">{t.admin.commissionWaiting}</span>
  );
}

function HeadlineTile({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  icon: "payments" | "receipt_long";
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-[20px] border p-4 shadow-e1 ${
        accent ? "border-gold-500 bg-gold-100" : "border-line bg-surface"
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span
          className={`text-[12px] font-semibold ${accent ? "text-bronze" : "text-muted"}`}
        >
          {label}
        </span>
        <Icon name={icon} size={20} className={accent ? "text-bronze" : "text-gold-600"} />
      </div>
      <div
        className={`font-display text-[26px] font-extrabold leading-tight ${
          accent ? "text-bronze" : "text-ink"
        }`}
      >
        {value}
      </div>
      <p className={`m-0 mt-1 text-[11.5px] ${accent ? "text-bronze/80" : "text-muted"}`}>
        {sub}
      </p>
    </div>
  );
}

function SmallTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "busy" | "muted";
}) {
  const toneClass =
    tone === "ok" ? "text-ok" : tone === "busy" ? "text-busy" : "text-ink";

  return (
    <div className="rounded-[18px] border border-line bg-surface p-3.5 shadow-e1">
      <span className="mb-1 block text-[11.5px] font-semibold text-muted">{label}</span>
      <span className={`font-display text-[17px] font-extrabold ${toneClass}`}>{value}</span>
    </div>
  );
}
