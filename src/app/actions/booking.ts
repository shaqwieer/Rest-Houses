"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { isRangeAvailable, withPublicListingWhere } from "@/lib/listings";
import { platformCommission, quote, resolveDepositPercent } from "@/lib/pricing";
import { isISODate, nightsBetween, todayISO } from "@/lib/dates";
import { arNum } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import { guardSubmission } from "@/lib/security";
import type { Dictionary } from "@/lib/i18n";

/**
 * Create a booking request.
 *
 * Order of operations matters and is deliberate:
 *   1. validate the input
 *   2. clear the anti-abuse gate (honeypot, rate limit, human check)
 *   3. re-read the listing and its availability **from the database**
 *   4. recompute the price server-side
 *   5. write the request, snapshotting both the amounts and the deposit rate
 *   6. hand back a reference the confirmation page turns into a WhatsApp link
 *
 * Nothing the browser sent about price or availability is trusted. The visitor's
 * calendar may be minutes stale — another guest could have taken the dates — and
 * the total in a form field is trivially editable, so both are derived here from
 * authoritative data. The stored `subtotal`/`serviceFee`/`total`/`depositDue`/
 * `depositPercent` are a snapshot, so a later change to the listing's nightly
 * rate or deposit percentage never rewrites what was quoted.
 */

/**
 * The validation schema, built per request so its messages are in the visitor's
 * language. Zod bakes messages in at construction, so a module-level schema
 * could only ever speak one language.
 */
function bookingSchema(t: Dictionary) {
  return z.object({
    listingId: z.string().min(1),
    checkIn: z.string().refine(isISODate, t.validation.invalidCheckIn),
    checkOut: z.string().refine(isISODate, t.validation.invalidCheckOut),
    guests: z.coerce.number().int().min(1, t.validation.guestsInvalid).max(1000),
    customerName: z.string().trim().min(3, t.validation.fullNameRequired).max(120),
    customerPhone: z
      .string()
      .trim()
      // Deliberately permissive on formatting (spaces, dashes, +) but insists on
      // enough digits to be a real mobile number.
      .refine((v) => v.replace(/[^0-9]/g, "").length >= 9, t.validation.phoneIncomplete)
      .refine((v) => v.replace(/[^0-9]/g, "").length <= 15, t.validation.phoneInvalid),
    customerEmail: z
      .string()
      .trim()
      .email(t.validation.invalidEmail)
      .optional()
      .or(z.literal("")),
    notes: z.string().trim().max(2000).optional().or(z.literal("")),
  });
}

export type CreateBookingResult =
  | { ok: true; reference: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Human-friendly, sequential-ish reference: RQ-2419. */
async function nextReference(): Promise<string> {
  const count = await prisma.bookingRequest.count();
  // Start above the seeded sample references so demo data and real requests
  // never collide on a fresh install.
  const n = 2420 + count;
  // Guard against the (rare) race where two submissions land on the same number.
  for (let attempt = 0; attempt < 25; attempt++) {
    const reference = `RQ-${n + attempt}`;
    const exists = await prisma.bookingRequest.findUnique({
      where: { reference },
      select: { id: true },
    });
    if (!exists) return reference;
  }
  // Fall back to something guaranteed unique rather than failing the booking.
  return `RQ-${Date.now().toString().slice(-8)}`;
}

export async function createBookingRequest(
  formData: FormData,
): Promise<CreateBookingResult> {
  const { t, locale } = await getI18n();

  const parsed = bookingSchema(t).safeParse({
    listingId: formData.get("listingId"),
    checkIn: formData.get("checkIn"),
    checkOut: formData.get("checkOut"),
    guests: formData.get("guests"),
    customerName: formData.get("customerName"),
    customerPhone: formData.get("customerPhone"),
    customerEmail: formData.get("customerEmail") ?? "",
    notes: formData.get("notes") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: t.validation.checkInput, fieldErrors };
  }

  const data = parsed.data;

  // --- anti-abuse gate ----------------------------------------------------
  //
  // Placed after validation so a guest who mistypes their phone number gets the
  // field error rather than a security message, and before every database read
  // below so a spam run costs this server one HMAC rather than four queries.
  // The phone number is passed as a second rate-limit subject: a whole
  // neighbourhood can share one mobile IP, but nobody legitimately submits the
  // same number five times in an hour. See src/lib/security.
  const guard = await guardSubmission({
    purpose: "booking",
    formData,
    identity: data.customerPhone,
    t,
  });
  if (!guard.ok) {
    return { ok: false, error: guard.error };
  }

  // --- date sanity -------------------------------------------------------
  const nights = nightsBetween(data.checkIn, data.checkOut);
  if (nights < 1) {
    return { ok: false, error: t.validation.checkOutBeforeCheckIn };
  }
  if (data.checkIn < todayISO()) {
    return { ok: false, error: t.validation.pastDate };
  }
  if (nights > 60) {
    return { ok: false, error: t.validation.tooManyNights };
  }

  // --- listing -----------------------------------------------------------
  //
  // `withPublicListingWhere` rather than a local `{ published: true }`: a
  // listing hidden because its owner is suspended, rejected or out of
  // membership must not be bookable by anyone who still has its id — from a
  // stale tab, a shared link, or a crafted POST straight at this action. The
  // grid hiding it is a UI courtesy; this is what actually enforces it.
  const listing = await prisma.listing.findFirst({
    where: withPublicListingWhere({ id: data.listingId }),
    select: {
      id: true,
      name: true,
      slug: true,
      capacity: true,
      pricePerNight: true,
      weekendPrice: true,
      depositPercent: true,
      securityDeposit: true,
    },
  });

  if (!listing) {
    return { ok: false, error: t.validation.listingUnavailable };
  }

  if (data.guests > listing.capacity) {
    return {
      ok: false,
      error: t.validation.overCapacity(arNum(listing.capacity, locale)),
      fieldErrors: { guests: t.validation.overCapacityShort },
    };
  }

  // --- availability, re-checked against the database ----------------------
  const available = await isRangeAvailable(listing.id, data.checkIn, data.checkOut);
  if (!available) {
    return { ok: false, error: t.validation.datesTaken };
  }

  // --- duplicate request ---------------------------------------------------
  //
  // A double-tapped submit button, a browser back-and-resend, or a script
  // repeating one payload all land here as a second identical request. The owner
  // reading their inbox should see one, not three.
  //
  // Matched on the phone number exactly as typed rather than on its digits:
  // Prisma cannot strip punctuation inside a WHERE clause without dropping to
  // raw SQL, and someone who re-types the same number differently is describing
  // a different attempt, not a duplicate. Only NEW requests count — a guest whose
  // request was rejected must be able to ask again.
  const duplicate = await prisma.bookingRequest.findFirst({
    where: {
      listingId: listing.id,
      customerPhone: data.customerPhone,
      checkIn: data.checkIn,
      checkOut: data.checkOut,
      status: "NEW",
    },
    select: { id: true },
  });
  if (duplicate) {
    return { ok: false, error: t.validation.duplicateRequest };
  }

  // --- price, recomputed server-side --------------------------------------
  //
  // The deposit rate is resolved here, from the listing row and the platform
  // default — never from the form. A percentage posted by the browser would let
  // anyone book at a 0% deposit simply by editing a hidden field.
  const settings = await getSettings();
  const depositPercent = resolveDepositPercent(
    listing.depositPercent,
    settings.depositPercent,
  );

  const q = quote({
    checkIn: data.checkIn,
    checkOut: data.checkOut,
    pricePerNight: listing.pricePerNight,
    weekendPrice: listing.weekendPrice,
    serviceFeePercent: settings.serviceFeePercent,
    depositPercent,
  });

  const commission = platformCommission(q.total, settings.commissionPercent);

  // --- write --------------------------------------------------------------
  //
  // The challenge is spent here and not at the gate above: everything between
  // the two can still legitimately fail (dates taken, over capacity), and a
  // guest who has to correct one field must be able to press send again with the
  // token they already hold. A false return means a second submission raced this
  // one on the same token — the first is the real request.
  if (!guard.spend()) {
    return { ok: false, error: t.security.challengeExpired };
  }

  const reference = await nextReference();

  await prisma.bookingRequest.create({
    data: {
      reference,
      listingId: listing.id,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerEmail: data.customerEmail || null,
      notes: data.notes || null,
      checkIn: data.checkIn,
      checkOut: data.checkOut,
      nights: q.nights,
      guests: data.guests,
      subtotal: q.subtotal,
      serviceFee: q.serviceFee,
      total: q.total,
      depositDue: q.depositDue,
      // The rate is stored beside the amount it produced. Without it, an owner
      // moving from 25% to 50% would retroactively relabel every past booking —
      // the stored amount saying one thing and the displayed rate another.
      depositPercent: q.depositPercent,
      // Read from the listing here, once, and snapshotted — the confirmation
      // page and the WhatsApp message then read this column rather than the
      // listing, so an owner who changes the figure tomorrow cannot rewrite
      // what an existing request was told. Refundable, so it is deliberately
      // absent from `total`.
      securityDeposit: listing.securityDeposit,
      // The platform's cut, snapshotted for the same reason as everything above
      // it. This is what the owner remits at step 6 of the handover workflow —
      // taken OUT of what they collected, never added to `total`, and never
      // shown to the guest, who has already paid it inside the nightly rate.
      commissionPercent: commission.percent,
      commissionDue: commission.due,
      status: "NEW",
      // Stays "NONE" until an online deposit gateway is enabled — see
      // src/lib/payments/index.ts.
      paymentStatus: "NONE",
    },
  });

  // NOTE: the dates are NOT written into `Availability` here. A request is not a
  // reservation — the owner confirms it first, and blocking dates on submission
  // would let anyone close a calendar by spamming the form. The admin's
  // "confirm" action is what writes the nights as BOOKED.

  return { ok: true, reference };
}
