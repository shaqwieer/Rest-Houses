"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, AuthorizationError } from "@/lib/auth";
import { auditData } from "@/lib/audit";
import { isISODate, todayISO, type ISODate } from "@/lib/dates";
import { fanOutPublicHoliday } from "@/lib/public-holidays";
import { getI18n } from "@/lib/i18n/server";
import { arNum } from "@/lib/format";
import type { ActionResult } from "./listings";

/**
 * «التقويم الشامل» — the operator marks a public holiday once and every rest
 * house charges its occasion rate on it. See src/lib/public-holidays.ts for why
 * this copies `SpecialDay` rows instead of being read by pricing directly.
 *
 * Admin only. Owners never call this: their calendar edits the copies.
 */

/**
 * Mark or unmark one date for the whole platform.
 *
 * Marking copies the day into every listing that has nothing on that date.
 * Unmarking deletes the holiday, and the foreign-key cascade removes exactly
 * the copies it made — an owner's own mark on the same date survives, and so
 * does an owner's earlier decision to unmark their copy (it is simply gone).
 */
export async function togglePublicHoliday(
  date: ISODate,
  label = "",
): Promise<ActionResult> {
  const { t, locale } = await getI18n();

  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, error: t.validation.unauthorized };
    }
    throw error;
  }

  if (!isISODate(date)) return { ok: false, error: t.validation.invalidDate };
  if (date < todayISO()) return { ok: false, error: t.validation.dateNotEditable };

  const actor = { id: admin.id, email: admin.email, role: admin.role };
  const existing = await prisma.publicHoliday.findUnique({ where: { date } });

  let message: string;
  if (existing) {
    await prisma.$transaction([
      prisma.publicHoliday.delete({ where: { id: existing.id } }),
      prisma.auditLog.create({
        data: auditData({
          actor,
          action: "PUBLIC_HOLIDAY_REMOVED",
          entityType: "PublicHoliday",
          entityId: existing.id,
          summary: existing.label || date,
          metadata: { date, label: existing.label },
        }),
      }),
    ]);
    message = t.holidays.removed;
  } else {
    const clean = label.trim().slice(0, 60);
    const copied = await prisma.$transaction(async (tx) => {
      const holiday = await tx.publicHoliday.create({ data: { date, label: clean } });
      const count = await fanOutPublicHoliday(tx, holiday);
      await tx.auditLog.create({
        data: auditData({
          actor,
          action: "PUBLIC_HOLIDAY_ADDED",
          entityType: "PublicHoliday",
          entityId: holiday.id,
          summary: clean || date,
          metadata: { date, label: clean, listings: count },
        }),
      });
      return count;
    });
    message = t.holidays.added(arNum(copied, locale));
  }

  // Every listing page can now quote a different price for this night.
  revalidatePath("/listings/[slug]", "page");
  revalidatePath("/listings");
  revalidatePath("/");
  revalidatePath("/admin/holidays");
  revalidatePath("/admin/calendar");
  revalidatePath("/owner/calendar");

  return { ok: true, message };
}
