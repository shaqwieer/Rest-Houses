import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { AdminFilterChips } from "@/components/admin/table-shell";
import { ReviewActions } from "@/components/admin/review-row";
import { requireAdminPage } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isReviewStatus, REVIEW_STATUSES } from "@/lib/constants";
import { formatInstant } from "@/lib/dates";
import { arNum } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

/**
 * Guest review moderation.
 *
 * Cards rather than a table: a review is a paragraph of prose, and a paragraph
 * in a table cell either wraps into an unreadable column or gets truncated to
 * the point where an operator is approving text they have not read.
 *
 * Pending first and uncapped, for the same reason the requests queue splits its
 * two queries — this page exists to drain that list, and a single capped query
 * ordered by date would eventually push the oldest unanswered review off the
 * end.
 */
export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();

  const sp = await searchParams;
  const { t, locale } = await getI18n();
  const filter = isReviewStatus(sp.status) ? sp.status : null;

  const [pending, decided, counts] = await Promise.all([
    filter && filter !== "PENDING"
      ? Promise.resolve([])
      : prisma.review.findMany({
          where: { status: "PENDING" },
          orderBy: { createdAt: "asc" },
          include: { listing: { select: { name: true, slug: true } } },
        }),
    filter === "PENDING"
      ? Promise.resolve([])
      : prisma.review.findMany({
          where: filter ? { status: filter } : { status: { not: "PENDING" } },
          orderBy: { createdAt: "desc" },
          include: { listing: { select: { name: true, slug: true } } },
          take: 100,
        }),
    prisma.review.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const countFor = (status: string) =>
    counts.find((c) => c.status === status)?._count._all ?? 0;
  const total = counts.reduce((sum, c) => sum + c._count._all, 0);
  const pendingCount = countFor("PENDING");

  const rows = [...pending, ...decided];

  return (
    <div className="animate-fade-up">
      <h1 className="m-0 mb-1 font-display text-[20px] font-extrabold text-ink">
        {t.admin.reviewsTitle}
      </h1>
      <p className="m-0 mb-3.5 text-[12.5px] text-muted">
        {pendingCount > 0
          ? t.admin.reviewPendingCount(arNum(pendingCount, locale))
          : t.admin.reviewsSubtitle}
      </p>

      <div className="mb-4">
        <AdminFilterChips
          param="status"
          options={[
            { value: "all", label: `${t.common.all} (${arNum(total, locale)})` },
            // The three review states share their names with the owner
            // lifecycle, so `t.status` already has the words for them.
            ...REVIEW_STATUSES.map((s) => ({
              value: s,
              label: `${t.status[s]} (${arNum(countFor(s), locale)})`,
            })),
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-sand-300 bg-surface p-8 text-center">
          <Icon name="rate_review" size={44} className="mx-auto text-sand-400" />
          <h2 className="mt-3.5 mb-0 font-display text-[17px] font-bold text-ink">
            {t.admin.noReviews}
          </h2>
        </div>
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {rows.map((review) => (
            <article
              key={review.id}
              className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-surface p-4 shadow-e1"
            >
              <div className="flex items-start justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="font-display text-[14.5px] font-bold text-ink">
                    {review.authorName}
                  </div>
                  <Link
                    href={`/listings/${encodeURIComponent(review.listing.slug)}`}
                    target="_blank"
                    className="text-[12px] text-muted no-underline hover:text-bronze hover:no-underline"
                  >
                    {review.listing.name}
                  </Link>
                </div>
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-gold-100 px-2.5 py-1 text-[12px] font-extrabold text-bronze">
                  <Icon name="star" size={14} />
                  {arNum(review.rating, locale)}
                </span>
              </div>

              <p className="m-0 rounded-xl bg-sand-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink">
                {review.body}
              </p>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11.5px] text-muted">
                  {/* An instant, not a day — a review submitted at 01:00 in
                      Dubai must not be filed under the previous date. */}
                  {formatInstant(review.createdAt, locale)}
                </span>
                {review.status === "PENDING" ? (
                  <ReviewActions reviewId={review.id} />
                ) : (
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
                      review.status === "APPROVED"
                        ? "bg-ok-bg text-ok"
                        : "bg-busy-bg text-busy"
                    }`}
                  >
                    {review.status === "APPROVED"
                      ? t.validation.reviewApproved
                      : t.validation.reviewRejected}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
