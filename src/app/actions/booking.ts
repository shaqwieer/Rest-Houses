"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { isRangeAvailable } from "@/lib/listings";
import { quote } from "@/lib/pricing";
import { isISODate, nightsBetween, todayISO } from "@/lib/dates";

/**
 * Create a booking request.
 *
 * Order of operations matters and is deliberate:
 *   1. validate the input
 *   2. re-read the listing and its availability **from the database**
 *   3. recompute the price server-side
 *   4. write the request
 *   5. hand back a reference the confirmation page turns into a WhatsApp link
 *
 * Nothing the browser sent about price or availability is trusted. The visitor's
 * calendar may be minutes stale — another guest could have taken the dates — and
 * the total in a form field is trivially editable, so both are derived here from
 * authoritative data. The stored `subtotal`/`serviceFee`/`total` are a snapshot,
 * so changing a listing's nightly rate later never rewrites what was quoted.
 */

const schema = z.object({
  listingId: z.string().min(1),
  checkIn: z.string().refine(isISODate, "تاريخ وصول غير صالح"),
  checkOut: z.string().refine(isISODate, "تاريخ مغادرة غير صالح"),
  guests: z.coerce.number().int().min(1, "عدد الضيوف غير صالح").max(1000),
  customerName: z
    .string()
    .trim()
    .min(3, "الرجاء إدخال الاسم الكامل")
    .max(120),
  customerPhone: z
    .string()
    .trim()
    // Deliberately permissive on formatting (spaces, dashes, +) but insists on
    // enough digits to be a real mobile number.
    .refine((v) => v.replace(/[^0-9]/g, "").length >= 9, "رقم الجوال غير مكتمل")
    .refine((v) => v.replace(/[^0-9]/g, "").length <= 15, "رقم الجوال غير صحيح"),
  customerEmail: z.string().trim().email("بريد إلكتروني غير صالح").optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type CreateBookingResult =
  | { ok: true; reference: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Human-friendly, sequential-ish reference: RQ-2419. */
async function nextReference(): Promise<string> {
  const count = await prisma.bookingRequest.count();
  // Start above the seeded sample references so demo data and real requests
  // never collide on a fresh install.
  let n = 2420 + count;
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
  const parsed = schema.safeParse({
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
    return { ok: false, error: "الرجاء التحقّق من البيانات المدخلة", fieldErrors };
  }

  const data = parsed.data;

  // --- date sanity -------------------------------------------------------
  const nights = nightsBetween(data.checkIn, data.checkOut);
  if (nights < 1) {
    return { ok: false, error: "يجب أن يكون تاريخ المغادرة بعد تاريخ الوصول" };
  }
  if (data.checkIn < todayISO()) {
    return { ok: false, error: "لا يمكن الحجز في تاريخ ماضٍ" };
  }
  if (nights > 60) {
    return { ok: false, error: "أقصى مدة للحجز ٦٠ ليلة — راسلنا للحجوزات الأطول" };
  }

  // --- listing -----------------------------------------------------------
  const listing = await prisma.listing.findFirst({
    where: { id: data.listingId, published: true },
    select: {
      id: true,
      name: true,
      slug: true,
      capacity: true,
      pricePerNight: true,
      weekendPrice: true,
    },
  });

  if (!listing) {
    return { ok: false, error: "الاستراحة غير متوفرة" };
  }

  if (data.guests > listing.capacity) {
    return {
      ok: false,
      error: `تتسع هذه الاستراحة لـ ${listing.capacity} ضيفًا كحد أقصى`,
      fieldErrors: { guests: "أكبر من السعة المتاحة" },
    };
  }

  // --- availability, re-checked against the database ----------------------
  const available = await isRangeAvailable(listing.id, data.checkIn, data.checkOut);
  if (!available) {
    return {
      ok: false,
      error: "لم تبقَ هذه التواريخ متاحة — الرجاء اختيار تواريخ أخرى من التقويم",
    };
  }

  // --- price, recomputed server-side --------------------------------------
  const settings = await getSettings();
  const q = quote({
    checkIn: data.checkIn,
    checkOut: data.checkOut,
    pricePerNight: listing.pricePerNight,
    weekendPrice: listing.weekendPrice,
    serviceFeePercent: settings.serviceFeePercent,
    depositPercent: settings.depositPercent,
  });

  // --- write --------------------------------------------------------------
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
      status: "NEW",
      // Stays "NONE" until an online deposit gateway is enabled — see
      // src/lib/payments/index.ts.
      paymentStatus: "NONE",
    },
  });

  // NOTE: the dates are NOT written into `Availability` here. A request is not a
  // reservation — the owner confirms it first, and blocking dates on submission
  // would let anyone close a calendar by spamming the form. The admin's
  // "تأكيد" action is what writes the nights as BOOKED.

  return { ok: true, reference };
}
