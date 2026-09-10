"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { SETTINGS_ID } from "@/lib/settings";
import {
  GA4_MEASUREMENT_RE,
  GTM_CONTAINER_RE,
  META_PIXEL_RE,
  SNAPCHAT_PIXEL_RE,
  TIKTOK_PIXEL_RE,
} from "@/lib/tracking";
import type { ActionResult } from "./listings";
import { getI18n } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n";

/**
 * Tracking configuration — its own action, and that is the whole point.
 *
 * ─── Why this is not part of `saveSettings` ──────────────────────────────────
 * These identifiers used to be two fields on the settings form. Splitting them
 * onto their own page meant the settings form stopped rendering them — and
 * `saveSettings` reads every field as `formData.get(name) ?? ""`, so the next
 * time anybody changed the site's tagline, the operator's Google tag would have
 * been silently overwritten with "". No error, no warning, and the symptom is a
 * number that stops arriving in an advertising account nobody checks for a
 * fortnight.
 *
 * The repo already carries a workaround for exactly that shape — the
 * `checkInTime` carry-through in actions/settings.ts. The fix here is better
 * than a carry-through: the fields are gone from that schema entirely, so no
 * form post exists that can reach them, and only this action can write them.
 *
 * ─── Identifiers, never code ─────────────────────────────────────────────────
 * Every value below is checked against the shape its platform issues, and
 * `src/components/site/tracking-scripts.tsx` writes the actual snippet. See the
 * note at the top of src/lib/tracking.ts for why a paste-the-script box would
 * be the single most dangerous field in the product.
 *
 * "" is always accepted on every field, and is how a platform is switched off.
 */

function trackingSchema(t: Dictionary) {
  /** Trim, allow blank, and check the shape — in that order, everywhere. */
  const shaped = (re: RegExp, message: string, upper = false) =>
    z
      .string()
      .trim()
      .transform((v) => (upper ? v.toUpperCase() : v))
      .refine((v) => v === "" || re.test(v), message);

  return z.object({
    // ---- Google -----------------------------------------------------------
    //
    // Google prints its ids upper-case, so normalising a lower-case paste is
    // friendlier than refusing it. Safe because every one of these is [A-Z0-9]
    // throughout — unlike the conversion label below, which is case-sensitive
    // and must never be touched.
    googleTagId: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      // The four prefixes gtag.js accepts as a tag ID: Ads, GA4, a Google Tag,
      // and Campaign Manager. Deliberately NOT "GTM-": a Tag Manager container
      // is loaded by gtm.js, not by gtag/js?id=, so accepting one here would
      // render a script that quietly does nothing. It has its own field.
      .refine(
        (v) => v === "" || /^(?:AW|G|GT|DC)-[A-Z0-9]+$/.test(v),
        t.validation.invalidGoogleTagId,
      ),

    googleAdsConversionLabel: z
      .string()
      .trim()
      // Google shows the conversion as "AW-950802645/dVoECJ30sOQcENWxsMUD" and
      // an operator will reasonably paste the whole thing. Keep only the half
      // after the slash: the id is already stored in its own field, and holding
      // it twice is how the two drift apart.
      .transform((v) => (v.includes("/") ? v.slice(v.lastIndexOf("/") + 1).trim() : v))
      .refine(
        (v) => v === "" || /^[A-Za-z0-9_-]{4,64}$/.test(v),
        t.validation.invalidConversionLabel,
      ),

    googleAnalyticsId: shaped(GA4_MEASUREMENT_RE, t.validation.invalidGa4Id, true),
    gtmContainerId: shaped(GTM_CONTAINER_RE, t.validation.invalidGtmId, true),

    // ---- the advertising pixels -------------------------------------------
    metaPixelId: shaped(META_PIXEL_RE, t.validation.invalidMetaPixel),
    tiktokPixelId: shaped(TIKTOK_PIXEL_RE, t.validation.invalidTiktokPixel, true),
    // Snapchat prints the pixel id as a lower-case UUID; an operator who pastes
    // it out of a document that upper-cased it should not be turned away.
    snapchatPixelId: z
      .string()
      .trim()
      .transform((v) => v.toLowerCase())
      .refine((v) => v === "" || SNAPCHAT_PIXEL_RE.test(v), t.validation.invalidSnapPixel),

    ownerAreaTracking: z.coerce.boolean().default(false),
  });
}

export async function saveTracking(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const { t } = await getI18n();

  const parsed = trackingSchema(t).safeParse({
    googleTagId: formData.get("googleTagId") ?? "",
    googleAdsConversionLabel: formData.get("googleAdsConversionLabel") ?? "",
    googleAnalyticsId: formData.get("googleAnalyticsId") ?? "",
    gtmContainerId: formData.get("gtmContainerId") ?? "",
    metaPixelId: formData.get("metaPixelId") ?? "",
    tiktokPixelId: formData.get("tiktokPixelId") ?? "",
    snapchatPixelId: formData.get("snapchatPixelId") ?? "",
    ownerAreaTracking: formData.get("ownerAreaTracking") === "on",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: t.validation.checkTheFields, fieldErrors };
  }

  try {
    await prisma.siteSettings.upsert({
      where: { id: SETTINGS_ID },
      update: parsed.data,
      create: { id: SETTINGS_ID, ...parsed.data },
    });
  } catch (error) {
    console.error("saveTracking failed:", error);
    return { ok: false, error: t.validation.settingsSaveFailed };
  }

  // "layout" scope: the snippets are mounted in the public shell's layout, so
  // this is what makes a newly connected — or newly disconnected — pixel take
  // effect across every page at once rather than as pages happen to be rebuilt.
  revalidatePath("/", "layout");

  return { ok: true, message: t.validation.settingsSaved };
}
