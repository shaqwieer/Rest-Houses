import { getSettings } from "@/lib/settings";
import { Icon } from "@/components/ui/icon";
import { OwnerActions } from "@/components/admin/owner-actions";
import { AdminPagination } from "@/components/admin/table-shell";
import { requireAdminPage } from "@/lib/auth";
import { listOwners, ownerCounts, readPage } from "@/lib/admin-queries";
import { cityLabel } from "@/lib/constants";
import { getI18n } from "@/lib/i18n/server";
import { arNum } from "@/lib/format";
import { formatInstant } from "@/lib/dates";
import { formatWhatsappDisplay, whatsappLink } from "@/lib/whatsapp";

/**
 * The owner registration review queue.
 *
 * A dedicated page rather than a filter on /admin/owners because this is a work
 * queue an operator drains, not a directory they browse: it shows the full
 * submission — business details, ID number, the lot — which the owners table
 * has no room for and no reason to display for accounts already decided.
 *
 * Oldest first: the applicant who has waited longest is the one to answer next.
 */
export default async function AdminOwnerRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();

  const sp = await searchParams;
  const { t, locale } = await getI18n();
  const page = readPage(sp.page);

  const [result, counts, settings] = await Promise.all([
    listOwners({ page, status: "PENDING", sort: "expiry" }),
    ownerCounts(),
    // What a blank commission field on the manage dialog falls back to.
    getSettings(),
  ]);

  // `sort: "expiry"` orders by membershipExpiresAt, which is null for every
  // pending owner — so re-sort by submission date, oldest first.
  const rows = [...result.rows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  return (
    <div className="animate-fade-up">
      <div className="mb-4">
        <h1 className="m-0 font-display text-[20px] font-extrabold text-ink">
          {t.admin.ownerRequestsTitle}
        </h1>
        <p className="m-0 text-[12.5px] text-muted">
          {t.admin.ownerRequestsSubtitle(arNum(counts.pending, locale))}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-sand-300 bg-surface p-8 text-center">
          <Icon name="task_alt" size={46} className="mx-auto text-ok" />
          <h2 className="mt-3.5 mb-2 font-display text-[17px] font-bold text-ink">
            {t.admin.noOwnerRequests}
          </h2>
        </div>
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {rows.map((o) => {
            const waHref = whatsappLink(o.whatsapp);
            return (
              <div
                key={o.id}
                className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-4 shadow-e1"
              >
                <div>
                  <div className="font-display text-[15.5px] font-bold text-ink">
                    {o.businessName || o.fullName}
                  </div>
                  {o.businessName && (
                    <div className="text-[12px] text-muted">{o.fullName}</div>
                  )}
                  <div className="mt-0.5 text-[11.5px] text-muted">
                    {t.admin.registeredAt}: {formatInstant(o.createdAt, locale)}
                    {o.city ? ` · ${cityLabel(o.city, locale)}` : ""}
                  </div>
                </div>

                <div className="grid gap-1.5 text-[12.5px]">
                  <a
                    href={`mailto:${o.user.email}`}
                    dir="ltr"
                    className="flex items-center gap-1.5 text-muted no-underline hover:text-bronze hover:no-underline"
                  >
                    <Icon name="mail" size={15} />
                    {o.user.email}
                  </a>
                  <a
                    href={`tel:${o.phone}`}
                    dir="ltr"
                    className="flex items-center gap-1.5 text-muted no-underline hover:text-bronze hover:no-underline"
                  >
                    <Icon name="call" size={15} />
                    {o.phone}
                  </a>
                  {waHref && (
                    <a
                      href={waHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      dir="ltr"
                      className="flex items-center gap-1.5 font-semibold text-wa no-underline hover:no-underline"
                    >
                      <Icon name="chat" size={15} />
                      {formatWhatsappDisplay(o.whatsapp)}
                    </a>
                  )}
                </div>

                {/* The same controls as the owners table, so a reviewer can
                    correct a mistyped email or number without leaving the
                    approval queue — often exactly why an application is
                    sitting here unanswered. */}
                <OwnerActions
                  ownerId={o.id}
                  state="PENDING"
                  membershipExpiresAt={null}
                  account={{
                    fullName: o.fullName,
                    businessName: o.businessName,
                    email: o.user.email,
                    phone: o.phone,
                    whatsapp: o.whatsapp,
                    city: o.city,
                    idNumber: o.idNumber ?? "",
                    about: o.about,
                    commissionPercent: o.commissionPercent,
                  }}
                  platformCommissionPercent={settings.commissionPercent}
                />
              </div>
            );
          })}
        </div>
      )}

      <AdminPagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
      />
    </div>
  );
}
