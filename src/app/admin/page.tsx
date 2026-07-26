import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { arNum, arPercent } from "@/lib/format";
import { addDays, arDayMonth, arFullDate, nightsInRange, todayISO } from "@/lib/dates";

/**
 * Dashboard overview.
 *
 * Answers the four questions an owner opens the app to ask: what needs a reply,
 * what's confirmed, how full am I, and what came in last. Everything is a real
 * query — the prototype's occupancy chart and revenue tile were hardcoded.
 */
export default async function AdminOverviewPage() {
  const session = await auth();
  const today = todayISO();
  const monthAhead = addDays(today, 30);

  const [newCount, confirmedCount, listingCount, recent, occupancy, revenue] =
    await Promise.all([
      prisma.bookingRequest.count({ where: { status: "NEW" } }),
      prisma.bookingRequest.count({ where: { status: "CONFIRMED" } }),
      prisma.listing.count(),
      prisma.bookingRequest.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { listing: { select: { name: true } } },
      }),
      // Occupancy = booked nights ÷ (listings × 30 nights) over the coming month.
      Promise.all([
        prisma.availability.count({
          where: { status: "BOOKED", date: { gte: today, lt: monthAhead } },
        }),
        prisma.listing.count({ where: { published: true } }),
      ]),
      // Confirmed revenue for stays starting in the next 30 days.
      prisma.bookingRequest.aggregate({
        where: { status: "CONFIRMED", checkIn: { gte: today, lt: monthAhead } },
        _sum: { total: true },
      }),
    ]);

  const [bookedNights, publishedCount] = occupancy;
  const capacityNights = publishedCount * 30;
  const occupancyPct =
    capacityNights > 0 ? Math.round((bookedNights / capacityNights) * 100) : 0;

  const revenueTotal = revenue._sum.total ?? 0;

  // Weekly occupancy bars for the next four weeks.
  const weeks = await Promise.all(
    [0, 1, 2, 3].map(async (w) => {
      const from = addDays(today, w * 7);
      const to = addDays(today, (w + 1) * 7);
      const booked = await prisma.availability.count({
        where: { status: "BOOKED", date: { gte: from, lt: to } },
      });
      const total = publishedCount * 7;
      const pct = total > 0 ? Math.round((booked / total) * 100) : 0;
      return { label: `الأسبوع ${arNum(w + 1)}`, pct };
    }),
  );

  const greeting = greetingFor(new Date());

  const stats: { label: string; value: string; sub: string; icon: IconName }[] = [
    {
      label: "طلبات جديدة",
      value: arNum(newCount),
      sub: "بانتظار الرد",
      icon: "mark_email_unread",
    },
    {
      label: "حجوزات مؤكدة",
      value: arNum(confirmedCount),
      sub: "الإجمالي",
      icon: "task_alt",
    },
    {
      label: "نسبة الإشغال",
      value: arPercent(occupancyPct),
      sub: "٣٠ يومًا القادمة",
      icon: "donut_large",
    },
    {
      label: "الإيراد المتوقّع",
      value: arNum(revenueTotal),
      sub: "درهم — حجوزات مؤكدة",
      icon: "payments",
    },
  ];

  return (
    <div className="animate-fade-up flex flex-col gap-4">
      <div>
        <h1 className="m-0 mb-1 font-display text-[20px] font-extrabold text-ink">
          {greeting}
          {session?.user?.name ? `، ${session.user.name}` : ""}
        </h1>
        <p className="m-0 text-[13.5px] text-muted">
          {arFullDate(today)}
          {newCount > 0 ? (
            <>
              {" · لديك "}
              <span className="font-bold text-busy">{arNum(newCount)}</span> طلبات بانتظار الرد
            </>
          ) : (
            " · لا طلبات معلّقة "
          )}
        </p>
      </div>

      {/* ---- stat tiles ---- */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-[20px] border border-line bg-surface p-4 shadow-e1"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-muted">{s.label}</span>
              <Icon name={s.icon} size={20} className="text-gold-600" />
            </div>
            <div className="font-display text-[26px] font-extrabold leading-none text-ink">
              {s.value}
            </div>
            <div className="mt-1 text-[11.5px] text-muted">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ---- occupancy ---- */}
      <div className="rounded-[20px] border border-line bg-surface p-4.5 shadow-e1">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="m-0 font-display text-[15.5px] font-extrabold text-ink">
            الإشغال الأسبوعي
          </h2>
          <span className="text-[11.5px] text-muted">الأسابيع الأربعة القادمة</span>
        </div>

        {publishedCount === 0 ? (
          <p className="m-0 text-[13px] text-muted">أضف استراحة أولًا لعرض الإشغال.</p>
        ) : (
          <div className="flex h-30 items-end gap-2">
            {weeks.map((w) => (
              <div
                key={w.label}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
              >
                <span className="text-[11px] font-bold text-bronze">{arPercent(w.pct)}</span>
                <div
                  className="w-full rounded-t-[10px] rounded-b bg-gold-500 transition-all"
                  // A zero-height bar reads as a rendering bug; keep a 3% stub so
                  // an empty week is visibly empty rather than missing.
                  style={{
                    height: `${Math.max(3, w.pct)}%`,
                    background: w.pct >= 70 ? "var(--gold-500)" : "var(--sand-300)",
                  }}
                />
                <span className="text-[11px] text-muted">{w.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- recent requests ---- */}
      <div className="rounded-[20px] border border-line bg-surface p-4.5 shadow-e1">
        <div className="mb-3.5 flex items-center justify-between">
          <h2 className="m-0 font-display text-[15.5px] font-extrabold text-ink">أحدث الطلبات</h2>
          <Link
            href="/admin/requests"
            className="text-[12.5px] font-bold text-bronze no-underline hover:no-underline"
          >
            عرض الكل
          </Link>
        </div>

        {recent.length === 0 ? (
          <p className="m-0 text-[13px] text-muted">لا توجد طلبات بعد.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {recent.map((r) => (
              <Link
                key={r.id}
                href="/admin/requests"
                className="flex items-center gap-3 rounded-2xl border border-line bg-sand-50 p-3 no-underline transition hover:border-gold-500 hover:no-underline"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sand-200 text-bronze">
                  <Icon name="person" size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold text-ink">{r.customerName}</span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {r.listing.name} · {arDayMonth(r.checkIn)} ·{" "}
                    {arNum(nightsInRange(r.checkIn, r.checkOut).length)} ليلة
                  </span>
                </span>
                <StatusBadge status={r.status} />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ---- quick actions ---- */}
      <div className="grid grid-cols-2 gap-2.5">
        <Link
          href="/admin/listings/new"
          className="flex items-center gap-3 rounded-[20px] bg-night-900 p-4 text-start text-sand-50 no-underline transition hover:bg-night-700 hover:no-underline"
        >
          <Icon name="add_home" size={23} className="text-gold-300" />
          <span className="text-[13.5px] font-bold">إضافة استراحة</span>
        </Link>
        <Link
          href="/admin/calendar"
          className="flex items-center gap-3 rounded-[20px] border border-line bg-surface p-4 text-start text-ink no-underline transition hover:border-gold-500 hover:no-underline"
        >
          <Icon name="event_busy" size={23} className="text-bronze" />
          <span className="text-[13.5px] font-bold">حظر تواريخ</span>
        </Link>
      </div>

      {listingCount === 0 && (
        <div className="rounded-[20px] border border-dashed border-sand-300 bg-surface p-5 text-center">
          <Icon name="holiday_village" size={40} className="mx-auto text-sand-400" />
          <h2 className="mt-3 mb-1.5 font-display text-[16px] font-bold text-ink">
            لا توجد استراحات بعد
          </h2>
          <p className="m-0 mb-3.5 text-[13.5px] text-muted">
            أضف أول استراحة لتظهر على الموقع، أو شغّل <code dir="ltr">npm run db:seed</code>{" "}
            لتحميل بيانات تجريبية.
          </p>
          <Link
            href="/admin/listings/new"
            className="inline-flex items-center gap-2 rounded-full bg-linear-[140deg,var(--gold-500),var(--gold-600)] px-5 py-3 text-[14px] font-extrabold text-night-900 no-underline shadow-gold hover:no-underline"
          >
            <Icon name="add" size={18} />
            إضافة استراحة
          </Link>
        </div>
      )}
    </div>
  );
}

/** Arabic greeting by hour, in Gulf time. */
function greetingFor(now: Date): string {
  const gulfHour = new Date(now.getTime() + 4 * 3600_000).getUTCHours();
  if (gulfHour < 5) return "ليلة هادئة";
  if (gulfHour < 12) return "صباح الخير";
  if (gulfHour < 17) return "طاب يومك";
  return "مساء الخير";
}
