import { Icon } from "@/components/ui/icon";
import {
  AdminPagination,
  AdminSearch,
  AdminTable,
  EmptyRow,
  Td,
  Th,
} from "@/components/admin/table-shell";
import { requireAdminPage } from "@/lib/auth";
import { listCustomers, readPage } from "@/lib/admin-queries";
import { getI18n } from "@/lib/i18n/server";
import { arNum } from "@/lib/format";
import { arFullDate, toISODate } from "@/lib/dates";
import { formatWhatsappDisplay, whatsappLink } from "@/lib/whatsapp";

/**
 * The customer directory.
 *
 * Customers are derived from booking requests rather than stored as accounts —
 * this platform deliberately has no customer sign-up, so a "customer" is every
 * booking that shares a phone number. See `listCustomers` for the reasoning and
 * for what happens if the booking table outgrows the in-memory grouping.
 */
export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();

  const sp = await searchParams;
  const { t, locale } = await getI18n();

  const page = readPage(sp.page);
  const search = typeof sp.q === "string" ? sp.q : "";

  const result = await listCustomers({ page, search });

  return (
    <div className="animate-fade-up">
      <div className="mb-4">
        <h1 className="m-0 font-display text-[20px] font-extrabold text-ink">
          {t.admin.customersTitle}
        </h1>
        <p className="m-0 text-[12.5px] text-muted">
          {t.admin.customersSubtitle(arNum(result.total, locale))}
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <AdminSearch />
      </div>

      <AdminTable>
        <thead>
          <tr>
            <Th>{t.booking.fullName}</Th>
            <Th>{t.booking.phone}</Th>
            <Th>{t.owner.email}</Th>
            <Th>{t.admin.customerBookings}</Th>
            <Th>{t.admin.customerTotalSpend}</Th>
            <Th>{t.admin.customerLastBooking}</Th>
          </tr>
        </thead>
        <tbody>
          {result.rows.length === 0 ? (
            <EmptyRow colSpan={6} message={t.admin.noCustomers} />
          ) : (
            result.rows.map((c) => {
              const waHref = whatsappLink(c.phone);
              return (
                <tr key={c.phone}>
                  <Td>
                    <span className="font-bold text-ink">{c.name}</span>
                  </Td>
                  <Td>
                    {waHref ? (
                      <a
                        href={waHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        dir="ltr"
                        className="text-[12px] font-semibold text-bronze no-underline hover:no-underline"
                      >
                        {formatWhatsappDisplay(c.phone)}
                      </a>
                    ) : (
                      <span dir="ltr" className="text-[12px]">
                        {c.phone}
                      </span>
                    )}
                  </Td>
                  <Td className="text-[12px]">
                    {c.email ? <span dir="ltr">{c.email}</span> : <span className="text-muted">—</span>}
                  </Td>
                  <Td className="font-bold">{arNum(c.bookings, locale)}</Td>
                  <Td className="font-bold">
                    {arNum(c.totalValue, locale)} {t.common.aed}
                  </Td>
                  <Td className="text-[12px] text-muted">
                    {arFullDate(toISODate(c.lastBookingAt), locale)}
                  </Td>
                </tr>
              );
            })
          )}
        </tbody>
      </AdminTable>

      <AdminPagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
      />

      {/* A silent cap reads as "that's everyone", which is worse than saying so. */}
      {result.truncated && (
        <p className="mt-3 flex items-center gap-2 text-[12.5px] text-muted">
          <Icon name="info" size={16} className="text-bronze" />
          {t.admin.customersTruncated(arNum(result.scanned, locale))}
        </p>
      )}
    </div>
  );
}
