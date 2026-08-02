import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { PaymentBadge, StatusBadge } from "@/components/ui/badge";
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
import { depositTotals, listBookings, readPage } from "@/lib/admin-queries";
import { BOOKING_STATUSES, isBookingStatus } from "@/lib/constants";
import { getI18n } from "@/lib/i18n/server";
import { arNum } from "@/lib/format";
import { arDayMonth } from "@/lib/dates";

/**
 * Payments and deposits.
 *
 * Online payment is not enabled on this platform (see the disabled stub in
 * src/lib/payments/index.ts), so every `paymentStatus` is "NONE" and the deposit
 * is collected by the owner directly. This page is therefore a *ledger of what
 * is owed*, not of what has been taken — and it says so at the top rather than
 * letting an operator read the totals as money received.
 *
 * The deposit percentage shown per row is the one snapshotted on the booking,
 * not the listing's current setting: an owner changing their rate must not
 * retroactively relabel what an old customer was quoted.
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

  const [result, totals] = await Promise.all([
    listBookings({ page, search, status }),
    depositTotals(),
  ]);

  const tiles = [
    {
      label: t.admin.depositConfirmedTile,
      value: `${arNum(totals.depositConfirmed, locale)} ${t.common.aed}`,
      icon: "savings" as const,
    },
    {
      label: t.admin.revenueConfirmedTile,
      value: `${arNum(totals.totalConfirmed, locale)} ${t.common.aed}`,
      icon: "payments" as const,
    },
    {
      label: t.admin.depositAllTile,
      value: `${arNum(totals.depositAll, locale)} ${t.common.aed}`,
      icon: "receipt_long" as const,
    },
    {
      label: t.admin.revenueAllTile,
      value: `${arNum(totals.totalAll, locale)} ${t.common.aed}`,
      icon: "confirmation_number" as const,
    },
  ];

  return (
    <div className="animate-fade-up">
      <div className="mb-4">
        <h1 className="m-0 font-display text-[20px] font-extrabold text-ink">
          {t.admin.paymentsTitle}
        </h1>
        <p className="m-0 text-[12.5px] text-muted">{t.admin.paymentsSubtitle}</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-[20px] border border-line bg-surface p-4 shadow-e1"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-muted">{tile.label}</span>
              <Icon name={tile.icon} size={20} className="text-gold-600" />
            </div>
            <div className="font-display text-[19px] font-extrabold leading-tight text-ink">
              {tile.value}
            </div>
          </div>
        ))}
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
            <Th>{t.admin.depositPercentCol}</Th>
            <Th>{t.admin.depositDue}</Th>
            <Th>{t.common.status}</Th>
            <Th>{t.admin.paymentStatus}</Th>
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
                <Td className="font-bold whitespace-nowrap">
                  {arNum(b.total, locale)} {t.common.aed}
                </Td>
                <Td className="whitespace-nowrap">
                  {arNum(b.depositPercent, locale)}
                  {locale === "ar" ? "٪" : "%"}
                </Td>
                <Td className="font-bold whitespace-nowrap">
                  {arNum(b.depositDue, locale)} {t.common.aed}
                </Td>
                <Td>
                  <StatusBadge status={b.status} />
                </Td>
                <Td>
                  <PaymentBadge status={b.paymentStatus} />
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
