import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import { requireAdminPage } from "@/lib/auth";
import { monthlyRecord } from "@/lib/admin-queries";
import { getI18n } from "@/lib/i18n/server";
import { arNum } from "@/lib/format";
import { arMonthLabel, monthRange, todayISO } from "@/lib/dates";

/**
 * «السجل الشهري» — every month's bookings and revenue.
 *
 * The overview shows this month and the next, and moves on when the month
 * does. The operator asked for the figures it leaves behind to stay on record,
 * so this page lists every month, newest first, with the same two figures
 * tiles 10–13 show for the same month. `monthlyRecord` explains why some rows
 * are stored and the rest are counted.
 *
 * A plain three-column table without `AdminTable`'s minimum width: it is read
 * on a phone, and three short columns fit one without scrolling sideways.
 */
export default async function AdminMonthlyPage() {
  await requireAdminPage();

  const { t, locale } = await getI18n();

  const today = todayISO();
  const records = await monthlyRecord(today);
  const currentFrom = monthRange(today).from;

  return (
    <div className="animate-fade-up">
      <div className="mb-4">
        <h1 className="m-0 font-display text-[20px] font-extrabold text-ink">
          {t.admin.monthlyRecord}
        </h1>
        <p className="m-0 text-[12.5px] text-muted">{t.admin.monthlyRecordSubtitle}</p>
      </div>

      <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-e1">
        <table className="w-full border-collapse text-start">
          <thead>
            <tr>
              <th className="border-b border-line px-3.5 py-3 text-start text-[12px] font-bold text-bronze">
                {t.admin.monthCol}
              </th>
              <th className="border-b border-line px-3.5 py-3 text-end text-[12px] font-bold text-bronze">
                {t.admin.monthBookingsCol}
              </th>
              <th className="border-b border-line px-3.5 py-3 text-end text-[12px] font-bold text-bronze">
                {t.admin.monthRevenueCol}
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr
                key={record.range.from}
                className={clsx(record.range.from === currentFrom && "bg-sand-50")}
              >
                <td className="border-b border-line px-3.5 py-3 text-[13px] text-ink">
                  <span className="font-bold">
                    {arMonthLabel(record.range.year, record.range.month, locale)}
                  </span>
                  {!record.frozen && (
                    <span className="ms-2 inline-block rounded-full bg-sand-200 px-2 py-0.5 text-[10.5px] font-bold text-bronze">
                      {t.admin.monthStillOpen}
                    </span>
                  )}
                </td>
                <td className="border-b border-line px-3.5 py-3 text-end text-[13px] font-bold text-ink">
                  {arNum(record.bookings, locale)}
                </td>
                <td className="border-b border-line px-3.5 py-3 text-end text-[13px] font-bold text-ink">
                  {arNum(record.revenue, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[12px] text-muted">
        <Icon name="info" size={15} className="mt-0.5 shrink-0" />
        <span>{t.admin.monthlyRecordNote}</span>
      </p>
    </div>
  );
}
