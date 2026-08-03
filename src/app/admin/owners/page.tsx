import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { OwnerActions } from "@/components/admin/owner-actions";
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
import {
  hiddenByOwnerStateCount,
  listOwners,
  ownerCounts,
  readPage,
} from "@/lib/admin-queries";
import { ownerAccessState } from "@/lib/owners";
import { OWNER_STATUSES, cityLabel } from "@/lib/constants";
import { getI18n } from "@/lib/i18n/server";
import { arNum } from "@/lib/format";
import { arFullDate, toISODate } from "@/lib/dates";
import { formatWhatsappDisplay, whatsappLink } from "@/lib/whatsapp";

/**
 * All owners, with the full set of admin controls.
 *
 * Search, status filter and paging are all read from the query string and
 * applied in SQL — see the note at the top of src/lib/admin-queries.ts for why
 * these tables can page in the database while the public listings grid can't.
 */
export default async function AdminOwnersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();

  const sp = await searchParams;
  const { t, locale } = await getI18n();

  const page = readPage(sp.page);
  const search = typeof sp.q === "string" ? sp.q : "";
  const status = typeof sp.status === "string" ? sp.status : "all";
  const sort = typeof sp.sort === "string" ? sp.sort : "recent";

  const [result, counts, hiddenCount] = await Promise.all([
    listOwners({
      page,
      search,
      status,
      sort: sort === "name" || sort === "expiry" ? sort : "recent",
    }),
    ownerCounts(),
    hiddenByOwnerStateCount(),
  ]);

  return (
    <div className="animate-fade-up">
      <div className="mb-4">
        <h1 className="m-0 font-display text-[20px] font-extrabold text-ink">
          {t.admin.ownersTitle}
        </h1>
        <p className="m-0 text-[12.5px] text-muted">
          {t.admin.ownersSubtitle(arNum(counts.total, locale))}
        </p>
      </div>

      {/* Listings hidden purely because of owner state is the number an operator
          most needs to notice — it is revenue not being earned, and it is
          invisible everywhere else. */}
      {hiddenCount > 0 && (
        <p className="mb-3 flex items-center gap-2 rounded-xl bg-busy-bg px-3.5 py-2.5 text-[12.5px] font-semibold text-busy">
          <Icon name="visibility_off" size={16} />
          {t.admin.hiddenListingsNote(arNum(hiddenCount, locale))}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <AdminSearch />
      </div>

      <div className="mb-3">
        <AdminFilterChips
          param="status"
          options={[
            { value: "all", label: t.common.all, count: counts.total },
            ...OWNER_STATUSES.map((s) => ({
              value: s,
              label: t.status[s],
              count:
                s === "PENDING"
                  ? counts.pending
                  : s === "APPROVED"
                    ? counts.approved
                    : s === "REJECTED"
                      ? counts.rejected
                      : counts.suspended,
            })),
          ]}
        />
      </div>

      <AdminTable>
        <thead>
          <tr>
            <Th>{t.owner.fullName}</Th>
            <Th>{t.owner.email}</Th>
            <Th>{t.owner.whatsapp}</Th>
            <Th>{t.common.status}</Th>
            <Th>{t.admin.membershipExpiresAt}</Th>
            <Th>{t.admin.listingsOwned}</Th>
            <Th>{t.admin.registeredAt}</Th>
            <Th>{t.common.actions}</Th>
          </tr>
        </thead>
        <tbody>
          {result.rows.length === 0 ? (
            <EmptyRow colSpan={8} message={t.admin.noOwners} />
          ) : (
            result.rows.map((o) => {
              const state = ownerAccessState(o);
              const waHref = whatsappLink(o.whatsapp);
              return (
                <tr key={o.id}>
                  <Td>
                    <span className="block font-bold text-ink">
                      {o.businessName || o.fullName}
                    </span>
                    {o.businessName && (
                      <span className="block text-[11.5px] text-muted">{o.fullName}</span>
                    )}
                    {o.city && (
                      <span className="block text-[11.5px] text-muted">
                        {cityLabel(o.city, locale)}
                      </span>
                    )}
                  </Td>
                  <Td className="text-[12px]">
                    <span dir="ltr">{o.user.email}</span>
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
                        {formatWhatsappDisplay(o.whatsapp)}
                      </a>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td>
                    <StatusBadge status={state} />
                    {state === "REJECTED" && o.rejectionReason && (
                      <span className="mt-1 block max-w-40 text-[11px] leading-snug text-muted">
                        {o.rejectionReason}
                      </span>
                    )}
                  </Td>
                  <Td className="text-[12px]">
                    {o.membershipExpiresAt
                      ? arFullDate(toISODate(o.membershipExpiresAt), locale)
                      : t.common.never}
                  </Td>
                  <Td>
                    <Link
                      href={`/admin/listings?owner=${o.id}`}
                      className="font-bold text-bronze no-underline hover:no-underline"
                    >
                      {arNum(o._count.listings, locale)}
                    </Link>
                  </Td>
                  <Td className="text-[12px] text-muted">
                    {arFullDate(toISODate(o.createdAt), locale)}
                  </Td>
                  <Td>
                    <OwnerActions
                      ownerId={o.id}
                      state={state}
                      membershipExpiresAt={
                        o.membershipExpiresAt ? toISODate(o.membershipExpiresAt) : null
                      }
                      // Everything the manage dialog can edit, pre-filled from
                      // the row that is already on screen — no second query,
                      // and no field that starts blank and saves over a value.
                      account={{
                        fullName: o.fullName,
                        businessName: o.businessName,
                        email: o.user.email,
                        phone: o.phone,
                        whatsapp: o.whatsapp,
                        city: o.city,
                        idNumber: o.idNumber ?? "",
                        about: o.about,
                      }}
                    />
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
    </div>
  );
}
