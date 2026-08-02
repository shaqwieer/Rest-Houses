import {
  AdminFilterChips,
  AdminPagination,
  AdminTable,
  EmptyRow,
  Td,
  Th,
} from "@/components/admin/table-shell";
import { requireAdminPage } from "@/lib/auth";
import { listAuditLog, readPage } from "@/lib/admin-queries";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { parseAuditMetadata } from "@/lib/audit";
import { getI18n } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/dates";

/**
 * The activity log.
 *
 * Append-only and never edited from the UI — an audit trail an operator can
 * rewrite is not an audit trail. Rows are written inside the same transaction
 * as the change they describe (see src/lib/audit.ts), so an entry here always
 * corresponds to a change that actually committed.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();

  const sp = await searchParams;
  const { t, locale } = await getI18n();

  const page = readPage(sp.page);
  const action = typeof sp.action === "string" ? sp.action : "all";

  const result = await listAuditLog({ page, action });

  return (
    <div className="animate-fade-up">
      <div className="mb-4">
        <h1 className="m-0 font-display text-[20px] font-extrabold text-ink">
          {t.admin.auditTitle}
        </h1>
        <p className="m-0 text-[12.5px] text-muted">{t.admin.auditSubtitle}</p>
      </div>

      <div className="mb-3">
        <AdminFilterChips
          param="action"
          options={[
            { value: "all", label: t.common.all },
            ...AUDIT_ACTIONS.map((a) => ({ value: a, label: t.audit[a] })),
          ]}
        />
      </div>

      <AdminTable>
        <thead>
          <tr>
            <Th>{t.admin.auditWhen}</Th>
            <Th>{t.admin.auditActor}</Th>
            <Th>{t.admin.auditAction}</Th>
            <Th>{t.admin.auditEntity}</Th>
            <Th>{t.common.notes}</Th>
          </tr>
        </thead>
        <tbody>
          {result.rows.length === 0 ? (
            <EmptyRow colSpan={5} message={t.admin.noAudit} />
          ) : (
            result.rows.map((row) => {
              const meta = parseAuditMetadata(row.metadata);
              return (
                <tr key={row.id}>
                  <Td className="text-[12px] whitespace-nowrap text-muted">
                    {formatDateTime(row.createdAt, locale)}
                  </Td>
                  <Td className="text-[12px]">
                    <span dir="ltr" className="block">
                      {row.actorEmail || t.common.unknown}
                    </span>
                    <span className="block text-[11px] text-muted">{row.actorRole}</span>
                  </Td>
                  <Td className="font-bold">
                    {(t.audit as unknown as Record<string, string>)[row.action] ?? row.action}
                  </Td>
                  <Td>
                    <span className="block">{row.summary || "—"}</span>
                    <span className="block text-[11px] text-muted">{row.entityType}</span>
                  </Td>
                  <Td className="text-[11.5px] text-muted">
                    {/* Rendered as compact key=value pairs rather than raw JSON:
                        an operator needs to read "publishedTo=false" at a glance,
                        not parse braces. */}
                    {Object.keys(meta).length === 0
                      ? "—"
                      : Object.entries(meta)
                          .map(([k, v]) => `${k}=${v === null ? "—" : String(v)}`)
                          .join(" · ")}
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
