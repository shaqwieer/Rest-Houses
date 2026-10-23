import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { normalizePhone } from "./phone";
import { isOwnerActive } from "./owners";
import { bookingFilterWhere } from "./booking-view";
import type { MonthRange } from "./dates";

/**
 * Read queries for the admin dashboard.
 *
 * Kept out of the page components for two reasons: several pages need the same
 * shapes, and every one of these is a privileged read whose scoping deserves to
 * be reviewable in one file rather than scattered through JSX.
 *
 * ─── Pagination ──────────────────────────────────────────────────────────────
 * Everything here paginates in **SQL** (`skip`/`take`) and returns a total from
 * a matching `count()`. That is a real constraint on these particular tables:
 * unlike the public listings grid — which deliberately filters amenities in
 * memory, because they live in a JSON column, and therefore cannot page in SQL
 * without returning short pages (see the note in src/lib/listings.ts) — owners,
 * bookings and audit entries filter entirely on indexed scalar columns. So
 * paging them in the database is both correct and the only thing that stays
 * usable once the audit log has a hundred thousand rows.
 */

/** Standard page size across the admin tables. */
export const PAGE_SIZE = 25;

export type Page = { page: number; pageSize: number; skip: number };

/**
 * Turn a `?page=` query string into safe pagination.
 *
 * Clamped rather than validated-and-rejected: a bad page number in a URL should
 * show page 1, not an error screen.
 */
export function readPage(raw: unknown, pageSize = PAGE_SIZE): Page {
  const n = Number(String(raw ?? "1"));
  const page = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export type Paged<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

function paged<T>(rows: T[], total: number, p: Page): Paged<T> {
  return {
    rows,
    total,
    page: p.page,
    pageSize: p.pageSize,
    pageCount: Math.max(1, Math.ceil(total / p.pageSize)),
  };
}

/* -------------------------------------------------------------------------- */
/* Owners                                                                     */
/* -------------------------------------------------------------------------- */

export type OwnerRow = Awaited<ReturnType<typeof listOwners>>["rows"][number];

/**
 * Owners, with their account email and a listing count.
 *
 * `search` matches name, business name or email. `status` filters on the stored
 * status only — "expired" is derived, not stored, so it is applied after the
 * query rather than pretending to be a column.
 */
export async function listOwners(opts: {
  page: Page;
  search?: string;
  status?: string;
  sort?: "recent" | "name" | "expiry";
}) {
  const where: Prisma.OwnerProfileWhereInput = {};

  const term = (opts.search ?? "").trim();
  if (term) {
    where.OR = [
      { fullName: { contains: term } },
      { businessName: { contains: term } },
      { user: { email: { contains: term } } },
      // Searching by number is how an operator finds the owner who just phoned
      // them — and, now that the number is the username, how they answer "which
      // account is 0503322119?". Normalised first so a term typed in any shape
      // matches the one shape that is stored; `|| term` keeps a non-numeric
      // search (a name) working, since `normalizePhone` returns "" for it and a
      // bare "" would `contains`-match every row.
      { phone: { contains: normalizePhone(term) || term } },
      { whatsapp: { contains: normalizePhone(term) || term } },
    ];
  }
  if (opts.status && opts.status !== "all") {
    where.status = opts.status;
  }

  const orderBy: Prisma.OwnerProfileOrderByWithRelationInput =
    opts.sort === "name"
      ? { fullName: "asc" }
      : opts.sort === "expiry"
        ? { membershipExpiresAt: "asc" }
        : { createdAt: "desc" };

  const [rows, total] = await Promise.all([
    prisma.ownerProfile.findMany({
      where,
      orderBy,
      skip: opts.page.skip,
      take: opts.page.pageSize,
      select: {
        id: true,
        fullName: true,
        businessName: true,
        phone: true,
        whatsapp: true,
        city: true,
        // Read for the manage-account dialog, which pre-fills every field it
        // can save. A form that starts blank and overwrites on submit would
        // silently wipe an owner's ID number the first time an admin corrected
        // a typo in their name.
        idNumber: true,
        about: true,
        // The owner's negotiated commission rate, or null for the platform's.
        commissionPercent: true,
        status: true,
        rejectionReason: true,
        membershipExpiresAt: true,
        createdAt: true,
        user: { select: { email: true, username: true } },
        _count: { select: { listings: true } },
      },
    }),
    prisma.ownerProfile.count({ where }),
  ]);

  return paged(rows, total, opts.page);
}

/** Owners eligible to be assigned a listing, for the admin editor's dropdown. */
export async function listOwnerOptions(): Promise<{ id: string; name: string }[]> {
  const rows = await prisma.ownerProfile.findMany({
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, businessName: true, status: true },
    take: 500,
  });
  return rows.map((o) => ({
    id: o.id,
    // The status is appended to the label so an admin assigning a listing can
    // see they are about to attach it to a suspended owner — which would hide
    // it from the public the moment it saves.
    name: `${o.businessName || o.fullName}${o.status === "APPROVED" ? "" : ` (${o.status})`}`,
  }));
}

/** Counts for the owners dashboard tiles. */
export async function ownerCounts() {
  const [total, pending, approved, rejected, suspended, expired] = await Promise.all([
    prisma.ownerProfile.count(),
    prisma.ownerProfile.count({ where: { status: "PENDING" } }),
    prisma.ownerProfile.count({ where: { status: "APPROVED" } }),
    prisma.ownerProfile.count({ where: { status: "REJECTED" } }),
    prisma.ownerProfile.count({ where: { status: "SUSPENDED" } }),
    prisma.ownerProfile.count({
      where: { status: "APPROVED", membershipExpiresAt: { lte: new Date() } },
    }),
  ]);
  // "Active" is approved minus the expired subset — the tile should not claim
  // an owner is active when none of their listings are visible.
  return { total, pending, approved, rejected, suspended, expired, active: approved - expired };
}

/** How many listings are currently hidden purely because of owner state. */
export async function hiddenByOwnerStateCount(): Promise<number> {
  return prisma.listing.count({
    where: {
      published: true,
      ownerId: { not: null },
      NOT: {
        owner: {
          is: {
            status: "APPROVED",
            OR: [{ membershipExpiresAt: null }, { membershipExpiresAt: { gt: new Date() } }],
          },
        },
      },
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Listings                                                                   */
/* -------------------------------------------------------------------------- */

export async function listListingsForAdmin(opts: {
  page: Page;
  search?: string;
  ownerId?: string;
  published?: "all" | "yes" | "no";
  sort?: "recent" | "price" | "name";
}) {
  const where: Prisma.ListingWhereInput = {};

  const term = (opts.search ?? "").trim();
  if (term) {
    // Both languages, matching the public grid's search — an admin who knows a
    // listing only by its English name must be able to find it here.
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { nameEn: { contains: term, mode: "insensitive" } },
      { area: { contains: term, mode: "insensitive" } },
      { areaEn: { contains: term, mode: "insensitive" } },
    ];
  }
  if (opts.ownerId && opts.ownerId !== "all") {
    where.ownerId = opts.ownerId === "none" ? null : opts.ownerId;
  }
  if (opts.published === "yes") where.published = true;
  if (opts.published === "no") where.published = false;

  const orderBy: Prisma.ListingOrderByWithRelationInput =
    opts.sort === "price"
      ? { pricePerNight: "desc" }
      : opts.sort === "name"
        ? { name: "asc" }
        : { createdAt: "desc" };

  const [rows, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      orderBy,
      skip: opts.page.skip,
      take: opts.page.pageSize,
      include: {
        images: { orderBy: { sortOrder: "asc" }, take: 1 },
        owner: {
          select: {
            id: true,
            fullName: true,
            businessName: true,
            status: true,
            membershipExpiresAt: true,
          },
        },
      },
    }),
    prisma.listing.count({ where }),
  ]);

  // Whether each row is currently hidden from the public is computed here with
  // the same rule the SQL predicate uses, so the badge in the table and the
  // catalogue can't disagree.
  const decorated = rows.map((row) => ({
    ...row,
    hiddenByOwnerState: Boolean(row.owner) && !isOwnerActive(row.owner),
  }));

  return paged(decorated, total, opts.page);
}

/* -------------------------------------------------------------------------- */
/* Bookings                                                                   */
/* -------------------------------------------------------------------------- */

export async function listBookings(opts: {
  page: Page;
  search?: string;
  status?: string;
  ownerId?: string;
}) {
  const where: Prisma.BookingRequestWhereInput = {};

  const term = (opts.search ?? "").trim();
  if (term) {
    where.OR = [
      { reference: { contains: term } },
      { customerName: { contains: term } },
      { customerPhone: { contains: term } },
      { listing: { name: { contains: term } } },
    ];
  }
  if (opts.status && opts.status !== "all") where.status = opts.status;
  if (opts.ownerId && opts.ownerId !== "all") {
    // Assigned rather than merged: the search above puts its listing condition
    // inside `where.OR`, so `where.listing` is always unset at this point.
    where.listing = { ownerId: opts.ownerId };
  }

  const [rows, total] = await Promise.all([
    prisma.bookingRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: opts.page.skip,
      take: opts.page.pageSize,
      include: {
        listing: {
          select: {
            name: true,
            slug: true,
            owner: { select: { id: true, fullName: true, businessName: true } },
          },
        },
      },
    }),
    prisma.bookingRequest.count({ where }),
  ]);

  return paged(rows, total, opts.page);
}

/**
 * Totals for the revenue view.
 *
 * ─── Why deposits are not here any more ─────────────────────────────────────
 * The page used to lead with two deposit tiles. A deposit is neither revenue
 * nor a receivable — it is part of the booking total, collected earlier — so
 * summing it alongside the total meant the same money appeared in two tiles
 * and the operator's eye added them together. What the platform actually needs
 * to see is the value it is handling and the commission it is owed on that
 * value. The deposit still matters to the *owner*, at step 1 of the booking
 * workflow, which is exactly where it now lives.
 *
 * `commissionCollected` counts only bookings an operator has confirmed the
 * transfer for — money that has genuinely arrived, never money that has merely
 * been declared sent, which is the whole reason step 6 has two halves.
 */
export async function revenueTotals() {
  const [all, confirmed, collected] = await Promise.all([
    prisma.bookingRequest.aggregate({ _sum: { commissionDue: true, total: true } }),
    prisma.bookingRequest.aggregate({
      where: { status: "CONFIRMED" },
      _sum: { commissionDue: true, total: true },
    }),
    prisma.bookingRequest.aggregate({
      where: { status: "CONFIRMED", commissionConfirmedAt: { not: null } },
      _sum: { commissionDue: true },
    }),
  ]);

  const commissionConfirmed = confirmed._sum.commissionDue ?? 0;
  const commissionCollected = collected._sum.commissionDue ?? 0;

  return {
    totalAll: all._sum.total ?? 0,
    commissionAll: all._sum.commissionDue ?? 0,
    totalConfirmed: confirmed._sum.total ?? 0,
    commissionConfirmed,
    commissionCollected,
    // What is owed but has not landed. Clamped at 0 so a confirmation recorded
    // against a booking that was later cancelled can never render a negative.
    commissionOutstanding: Math.max(0, commissionConfirmed - commissionCollected),
  };
}

/* -------------------------------------------------------------------------- */
/* The overview's booking figures — platform bookings only                    */
/* -------------------------------------------------------------------------- */

/**
 * Bookings made on this platform, as opposed to the ones an owner recorded by
 * hand — taken over WhatsApp, or on Airbnb or Booking.com, which the dashboard
 * calls «حجز خارجي». Those belong in that owner's own figures, and the owner
 * dashboard counts them. They are not business this platform did, and the
 * operator asked for every booking figure on the admin overview to leave them
 * out. One constant so the overview's tiles cannot disagree about it.
 */
const PLATFORM_BOOKINGS = { source: "RIHLA" } satisfies Prisma.BookingRequestWhereInput;

/**
 * Tiles 7 and 9 of the overview: every confirmed platform booking whatever
 * stage it has reached, and the subset still being worked.
 *
 * `inProgress` is the "مؤكد" chip's predicate narrowed to platform bookings, so
 * it is no longer the number that chip shows — the requests page lists
 * recorded bookings too. That is why the tile does not link there.
 */
export async function confirmedBookingCounts(): Promise<{ all: number; inProgress: number }> {
  const [all, inProgress] = await Promise.all([
    prisma.bookingRequest.count({ where: { status: "CONFIRMED", ...PLATFORM_BOOKINGS } }),
    prisma.bookingRequest.count({
      where: { ...bookingFilterWhere("CONFIRMED"), ...PLATFORM_BOOKINGS },
    }),
  ]);
  return { all, inProgress };
}

/* -------------------------------------------------------------------------- */
/* One calendar month, across the whole platform                              */
/* -------------------------------------------------------------------------- */

export type TopListing = {
  id: string;
  name: string;
  nameEn: string | null;
  /** Gross booking value, or a booking count — whichever list this topped. */
  value: number;
};

export type MonthPerformance = {
  range: MonthRange;
  /** Gross value of confirmed platform bookings *starting* in this month. */
  revenue: number;
  /** How many of those bookings there are. */
  bookings: number;
  topByRevenue: TopListing | null;
  topByBookings: TopListing | null;
};

/**
 * How one calendar month looks across the whole platform: how many bookings it
 * holds, what they are worth, and which rest house is carrying it.
 *
 * ─── Only bookings made on this platform ─────────────────────────────────────
 * `PLATFORM_BOOKINGS` above. Days an imported iCal feed closed are further out
 * still: they carry no booking at all. That is also why occupancy is no longer
 * reported here — it counted those days as sold, and they re-sync every fifteen
 * minutes, so the figure moved with no booking on the platform changing.
 *
 * ─── A figure that only moves when a booking does ────────────────────────────
 * Every condition below is a fact about the booking itself: its status, its
 * source, and the month its stay starts in. Nothing reads today's date or the
 * state of a listing, so a month's figure does not shrink as its days go by,
 * and does not move because a rest house was unpublished or its owner's
 * membership lapsed — which is why there is deliberately no
 * `listing: { published: true }` here. It changes when a booking is confirmed,
 * cancelled or deleted. A finished stay stays CONFIRMED (its *stage* moves, not
 * its status), so the stays already behind us keep counting.
 *
 * ─── "Revenue" here is gross booking value ───────────────────────────────────
 * `total` — what the guest pays, the value the platform is handling — matching
 * /admin/payments beside it. NOT the platform's own income, which is
 * `commissionDue` and has its own page. And a month is the month a stay
 * *starts* in, the same convention the owner dashboard uses.
 */
export async function monthPerformance(range: MonthRange): Promise<MonthPerformance> {
  // Grouped in SQL rather than read and summed: unlike the owner dashboard —
  // which needs one window of rows for a dozen different slices — this wants
  // two aggregates and a maximum, and the platform's whole booking table is the
  // input rather than one owner's slice of it.
  const byListing = await prisma.bookingRequest.groupBy({
    by: ["listingId"],
    where: {
      status: "CONFIRMED",
      ...PLATFORM_BOOKINGS,
      checkIn: { gte: range.from, lt: range.to },
    },
    _sum: { total: true },
    _count: { _all: true },
  });

  const revenue = byListing.reduce((sum, row) => sum + (row._sum.total ?? 0), 0);
  const bookings = byListing.reduce((sum, row) => sum + row._count._all, 0);

  const bestRevenue = pickTop(byListing, (row) => row._sum.total ?? 0);
  const bestBookings = pickTop(byListing, (row) => row._count._all);

  // One read for both winners, and often for the same listing twice — which is
  // the common case on a platform this size, not an edge case worth a branch.
  const ids = [...new Set([bestRevenue?.listingId, bestBookings?.listingId])].filter(
    (id): id is string => Boolean(id),
  );
  const names =
    ids.length === 0
      ? []
      : await prisma.listing.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, nameEn: true },
        });
  const nameById = new Map(names.map((l) => [l.id, l]));

  const decorate = (
    row: (typeof byListing)[number] | null,
    value: (row: (typeof byListing)[number]) => number,
  ): TopListing | null => {
    if (!row) return null;
    const listing = nameById.get(row.listingId);
    if (!listing) return null; // deleted between the two reads
    return { id: listing.id, name: listing.name, nameEn: listing.nameEn, value: value(row) };
  };

  return {
    range,
    revenue,
    bookings,
    topByRevenue: decorate(bestRevenue, (row) => row._sum.total ?? 0),
    topByBookings: decorate(bestBookings, (row) => row._count._all),
  };
}

/**
 * The highest-scoring row, or null when there are none or every score is zero.
 *
 * Zero is excluded deliberately: "the top rest house earned 0 د.إ" is not a
 * fact worth a tile, and picking an arbitrary listing out of a dozen tied at
 * nothing would name one of them for no reason.
 */
function pickTop<T>(rows: T[], score: (row: T) => number): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (score(row) <= 0) continue;
    if (best === null || score(row) > score(best)) best = row;
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Customers                                                                  */
/* -------------------------------------------------------------------------- */

export type CustomerRow = {
  phone: string;
  name: string;
  email: string | null;
  bookings: number;
  totalValue: number;
  lastBookingAt: Date;
};

/**
 * The customer directory.
 *
 * ─── Why customers are derived, not a table ──────────────────────────────────
 * This platform has no customer *accounts*: a guest books by filling in a name
 * and a WhatsApp number, with no sign-up — which is deliberate, and is what the
 * booking flow promises. So "all customers" is an aggregate over booking
 * requests, keyed by phone number (the one field every booking has and the one
 * the owner actually contacts them on).
 *
 * The grouping is done in JS rather than SQL because the display needs the most
 * recent *name* and *email* per phone number, and `groupBy` cannot carry a
 * non-aggregated column alongside its keys on both SQLite and PostgreSQL. The
 * read is bounded by `take` and the result is sorted and paged in memory; at
 * this catalogue's scale that is a few thousand rows at worst. If the booking
 * table ever outgrows that, this becomes a materialised `Customer` table
 * written on booking create — a change contained entirely within this function
 * and its callers.
 */
export async function listCustomers(opts: {
  page: Page;
  search?: string;
  scanLimit?: number;
}): Promise<Paged<CustomerRow> & { scanned: number; truncated: boolean }> {
  const where: Prisma.BookingRequestWhereInput = {};
  const term = (opts.search ?? "").trim();
  if (term) {
    where.OR = [
      { customerName: { contains: term } },
      { customerPhone: { contains: term } },
      { customerEmail: { contains: term } },
    ];
  }

  const scanLimit = opts.scanLimit ?? 5000;

  const bookings = await prisma.bookingRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: scanLimit,
    select: {
      customerName: true,
      customerPhone: true,
      customerEmail: true,
      total: true,
      createdAt: true,
    },
  });

  const byPhone = new Map<string, CustomerRow>();
  for (const b of bookings) {
    // Normalised to digits so "+971 50 …" and "0050…" don't split one person
    // into two rows.
    const key = b.customerPhone.replace(/[^0-9]/g, "") || b.customerPhone;
    const existing = byPhone.get(key);
    if (existing) {
      existing.bookings += 1;
      existing.totalValue += b.total;
      // Rows arrive newest-first, so the first one seen already holds the most
      // recent name/email — only fill gaps.
      if (!existing.email && b.customerEmail) existing.email = b.customerEmail;
    } else {
      byPhone.set(key, {
        phone: b.customerPhone,
        name: b.customerName,
        email: b.customerEmail,
        bookings: 1,
        totalValue: b.total,
        lastBookingAt: b.createdAt,
      });
    }
  }

  const all = [...byPhone.values()].sort(
    (a, b) => b.lastBookingAt.getTime() - a.lastBookingAt.getTime(),
  );

  const slice = all.slice(opts.page.skip, opts.page.skip + opts.page.pageSize);

  return {
    ...paged(slice, all.length, opts.page),
    scanned: bookings.length,
    // Surfaced so the page can say so out loud. A silent cap reads as
    // "that's everyone", which is worse than an explicit note.
    truncated: bookings.length === scanLimit,
  };
}

/* -------------------------------------------------------------------------- */
/* Audit log                                                                  */
/* -------------------------------------------------------------------------- */

export async function listAuditLog(opts: {
  page: Page;
  action?: string;
  entityType?: string;
}) {
  const where: Prisma.AuditLogWhereInput = {};
  if (opts.action && opts.action !== "all") where.action = opts.action;
  if (opts.entityType && opts.entityType !== "all") where.entityType = opts.entityType;

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: opts.page.skip,
      take: opts.page.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return paged(rows, total, opts.page);
}
