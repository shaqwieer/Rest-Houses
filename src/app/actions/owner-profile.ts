"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApprovedOwner, AuthorizationError } from "@/lib/auth";
import { phoneField, whatsappField } from "@/lib/validation";
import { CITIES } from "@/lib/constants";
import { getI18n } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n";
import type { ActionResult } from "./listings";

/**
 * The owner's own profile.
 *
 * The WhatsApp number here is the single source of truth for every one of this
 * owner's listings — `resolveListingWhatsapp()` reads it through the relation
 * rather than from a copy on each listing, so saving it once updates every
 * contact button they have. That is the whole reason the number is not
 * duplicated onto the listing rows.
 *
 * Deliberately NOT editable here: `status`, `membershipExpiresAt`,
 * `rejectionReason`. Those are the admin's decisions about this owner, and
 * accepting them from a form the owner controls would let an owner approve
 * themselves or extend their own membership. The update below names its columns
 * explicitly rather than spreading parsed input, so a field added to the form
 * later cannot become a mass-assignment hole by default.
 */

const VALID_CITY_IDS = CITIES.map((c) => c.id);

function profileSchema(t: Dictionary) {
  return z.object({
    fullName: z.string().trim().min(3, t.validation.nameTooShort).max(120),
    phone: phoneField(t),
    whatsapp: whatsappField(t),
    businessName: z.string().trim().max(160).default(""),
    city: z
      .string()
      .trim()
      .default("")
      .refine((v) => v === "" || VALID_CITY_IDS.includes(v), t.validation.invalidCity),
    about: z.string().trim().max(2000).default(""),
  });
}

export async function saveOwnerProfile(formData: FormData): Promise<ActionResult> {
  const { t } = await getI18n();

  let owner;
  try {
    ({ owner } = await requireApprovedOwner());
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        ok: false,
        error:
          error.code === "OWNER_INACTIVE"
            ? t.validation.ownerInactive
            : t.validation.unauthorized,
      };
    }
    throw error;
  }

  const parsed = profileSchema(t).safeParse({
    fullName: formData.get("fullName"),
    phone: formData.get("phone"),
    whatsapp: formData.get("whatsapp"),
    businessName: formData.get("businessName") ?? "",
    city: formData.get("city") ?? "",
    about: formData.get("about") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: t.validation.checkFields, fieldErrors };
  }

  const data = parsed.data;

  // ─── Changing the phone number changes the login ──────────────────────────
  //
  // `User.username` is this owner's phone number, so saving a new one here has
  // to move their sign-in with it — otherwise an owner updates their mobile,
  // signs out, and can never get back in: the number on their profile is not
  // the number that authenticates, and no screen shows the one that does.
  //
  // Checked before writing, and reported on the `phone` field, for the same
  // reason as everywhere else: a P2002 from the unique index would reach the
  // owner as "couldn't save" with nothing saying why.
  if (data.phone !== owner.phone) {
    const clash = await prisma.user.findFirst({
      where: { username: data.phone, id: { not: owner.userId } },
      select: { id: true },
    });
    if (clash) {
      return {
        ok: false,
        error: t.validation.phoneTaken,
        fieldErrors: { phone: t.validation.phoneTaken },
      };
    }
  }

  // One transaction, because the profile's number and the account's username
  // are the same fact stored twice and must not be able to disagree.
  await prisma.$transaction([
    prisma.ownerProfile.update({
      // Scoped to the session's own profile id — never an id from the form.
      where: { id: owner.id },
      data: {
        fullName: data.fullName,
        phone: data.phone,
        whatsapp: data.whatsapp,
        businessName: data.businessName,
        city: data.city,
        about: data.about,
      },
    }),
    prisma.user.update({
      where: { id: owner.userId },
      data: { username: data.phone, name: data.fullName },
    }),
  ]);

  // The owner's name and number appear on their public listing pages, so those
  // have to be revalidated too — not just the dashboard.
  revalidatePath("/owner/profile");
  revalidatePath("/owner");
  revalidatePath("/listings");
  revalidatePath("/");

  const listings = await prisma.listing.findMany({
    where: { ownerId: owner.id },
    select: { slug: true },
  });
  for (const l of listings) revalidatePath(`/listings/${l.slug}`);

  return { ok: true, message: t.owner.profileSaved };
}
