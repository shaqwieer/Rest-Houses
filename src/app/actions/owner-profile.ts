"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApprovedOwner, AuthorizationError } from "@/lib/auth";
import { isValidWhatsapp, normalizeWhatsapp } from "@/lib/whatsapp";
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
    phone: z
      .string()
      .trim()
      .refine((v) => v.replace(/[^0-9]/g, "").length >= 9, t.validation.phoneIncomplete)
      .refine((v) => v.replace(/[^0-9]/g, "").length <= 15, t.validation.phoneInvalid),
    whatsapp: z.string().trim().refine(isValidWhatsapp, t.validation.whatsappInvalid),
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

  await prisma.ownerProfile.update({
    // Scoped to the session's own profile id — never an id from the form.
    where: { id: owner.id },
    data: {
      fullName: data.fullName,
      phone: data.phone,
      whatsapp: normalizeWhatsapp(data.whatsapp),
      businessName: data.businessName,
      city: data.city,
      about: data.about,
    },
  });

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
