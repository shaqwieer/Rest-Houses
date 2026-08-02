"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireApprovedOwner, AuthorizationError } from "@/lib/auth";
import { getTakenSlugs } from "@/lib/listings";
import { uniqueSlug } from "@/lib/slug";
import { stringifyIdList } from "@/lib/json-list";
import { auditData } from "@/lib/audit";
import {
  AMENITIES,
  CATEGORIES,
  CITIES,
  DEPOSIT_PERCENT_MAX,
  DEPOSIT_PERCENT_MIN,
} from "@/lib/constants";
import { deleteStoredAsset, getStorage, UploadError } from "@/lib/storage";
import { getI18n } from "@/lib/i18n/server";
import { normalizeDigits } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n";

/**
 * Listing CRUD.
 *
 * Two entry points, one implementation:
 *   • the admin actions operate on any listing
 *   • the `…OwnerListing` actions are scoped to the signed-in owner's own rows
 *
 * Every action begins with a guard. Server actions are reachable by anyone who
 * can guess their generated id — the middleware guard on /admin and /owner
 * protects *navigation*, not the action endpoints, so authorisation has to be
 * re-asserted here.
 *
 * The owner-scoped actions put `ownerId` in the **WHERE clause** rather than
 * checking ownership after reading. An owner asking for someone else's listing
 * gets "not found" — the same answer as for an id that doesn't exist, which is
 * both the correct authorisation outcome and the one that leaks nothing about
 * which other rows exist (IDOR).
 *
 * After a write we `revalidatePath` the public pages that embed the data, since
 * listing pages are cached. Without this an owner would edit a price and not see
 * it on the live site.
 */

export type ActionResult =
  | { ok: true; id?: string; slug?: string; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const VALID_CITY_IDS = CITIES.map((c) => c.id);
const VALID_AMENITY_IDS = new Set(AMENITIES.map((a) => a.id));
const VALID_CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

function listingSchema(t: Dictionary) {
  return z.object({
    name: z.string().trim().min(3, t.validation.nameTooShort).max(160),
    description: z.string().trim().max(5000).default(""),
    city: z.enum(VALID_CITY_IDS as [string, ...string[]], {
      message: t.validation.invalidCity,
    }),
    area: z.string().trim().max(160).default(""),
    pricePerNight: z.coerce
      .number()
      .int()
      .min(1, t.validation.priceRequired)
      .max(1_000_000),
    weekendPrice: z.coerce.number().int().min(0).max(1_000_000).default(0),
    capacity: z.coerce.number().int().min(1, t.validation.capacityRequired).max(5000),
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    /**
     * Deposit percentage.
     *
     * Nullable, and null is *not* the same as 0 — see `resolveDepositPercent`
     * in src/lib/pricing.ts. An empty field means "use the platform default";
     * an explicit 0 means "no deposit required". The `preprocess` maps blank
     * input to null before coercion, because `Number("")` is 0 and would
     * otherwise silently turn "I left it blank" into "I require no deposit".
     * Arabic-Indic digits are normalised first, so an owner typing ٢٥ on an
     * Arabic keyboard is understood rather than rejected.
     */
    depositPercent: z.preprocess(
      (v) => {
        if (v === null || v === undefined) return null;
        const s = normalizeDigits(String(v)).trim();
        if (s === "") return null;
        const n = Number(s);
        return Number.isNaN(n) ? s : n;
      },
      z
        .number({ message: t.validation.depositRange })
        .int(t.validation.depositRange)
        .min(DEPOSIT_PERCENT_MIN, t.validation.depositRange)
        .max(DEPOSIT_PERCENT_MAX, t.validation.depositRange)
        .nullable(),
    ),
    ownerName: z.string().trim().max(120).default(""),
    ownerWhatsapp: z.string().trim().max(40).default(""),
    verified: z.coerce.boolean().default(false),
    featured: z.coerce.boolean().default(false),
    published: z.coerce.boolean().default(true),
  });
}

type ListingInput = z.infer<ReturnType<typeof listingSchema>>;

/** Read the shared listing fields out of a FormData. */
function readListingForm(formData: FormData, t: Dictionary) {
  // Checkboxes are absent from FormData when unchecked, hence the `=== "on"`
  // rather than a truthiness check on a possibly-null value.
  return listingSchema(t).safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    city: formData.get("city"),
    area: formData.get("area") ?? "",
    pricePerNight: formData.get("pricePerNight"),
    weekendPrice: formData.get("weekendPrice") ?? 0,
    capacity: formData.get("capacity"),
    lat: formData.get("lat") || 24.7614,
    lng: formData.get("lng") || 55.334,
    depositPercent: formData.get("depositPercent"),
    ownerName: formData.get("ownerName") ?? "",
    ownerWhatsapp: formData.get("ownerWhatsapp") ?? "",
    verified: formData.get("verified") === "on",
    featured: formData.get("featured") === "on",
    published: formData.get("published") === "on",
  });
}

/** Amenity/category ids arrive as repeated form fields; keep only known ids. */
function readIdList(formData: FormData, field: string, allowed: Set<string>): string[] {
  return formData
    .getAll(field)
    .map(String)
    .filter((id) => allowed.has(id));
}

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Revalidate everything a listing change can appear on. */
function revalidateListing(slug?: string) {
  revalidatePath("/");
  revalidatePath("/listings");
  revalidatePath("/favorites");
  if (slug) revalidatePath(`/listings/${slug}`);
}

/** Turn a guard failure into a translated result rather than a 500. */
function guardResult(error: unknown, t: Dictionary): ActionResult {
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

/**
 * The columns a listing write may set, built explicitly from validated input.
 *
 * Named field by field rather than spread from the parsed object: `ownerId`,
 * `rating`, `reviewsCount` and `bookingsCount` must never be settable from a
 * form, and an allow-list a reader can see in full is what stops a field added
 * later from becoming a mass-assignment hole by default.
 */
function listingColumns(
  data: ListingInput,
  amenities: string[],
  categories: string[],
  opts: { allowEditorialFlags: boolean },
) {
  const common = {
    name: data.name,
    description: data.description,
    city: data.city,
    area: data.area,
    pricePerNight: data.pricePerNight,
    weekendPrice: data.weekendPrice,
    capacity: data.capacity,
    lat: data.lat,
    lng: data.lng,
    depositPercent: data.depositPercent,
    amenities: stringifyIdList(amenities),
    categories: stringifyIdList(categories),
    published: data.published,
  };

  // `verified` and `featured` are editorial badges the *platform* grants. An
  // owner marking their own listing "verified" would defeat the point of the
  // badge, and self-featuring would let owners promote themselves onto the home
  // page. Only the admin path may set them — and only the admin path may write
  // the legacy per-listing contact fields, which for an owned listing are not
  // the source of truth anyway (see resolveListingWhatsapp).
  if (!opts.allowEditorialFlags) return common;

  return {
    ...common,
    verified: data.verified,
    featured: data.featured,
    ownerName: data.ownerName || "المالك",
    ownerWhatsapp: data.ownerWhatsapp || null,
  };
}

/* -------------------------------------------------------------------------- */
/* create / update — admin                                                    */
/* -------------------------------------------------------------------------- */

export async function saveListing(formData: FormData): Promise<ActionResult> {
  const { t } = await getI18n();

  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return guardResult(error, t);
  }

  const id = String(formData.get("id") ?? "").trim() || null;
  const parsed = readListingForm(formData, t);

  if (!parsed.success) {
    return {
      ok: false,
      error: t.validation.checkFields,
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const data = parsed.data;
  const amenities = readIdList(formData, "amenities", VALID_AMENITY_IDS);
  const categories = readIdList(formData, "categories", VALID_CATEGORY_IDS);

  // Weekend rate below the weekday rate is almost always a typo; treat 0/blank
  // as "same as weekday" and reject an actual lower number.
  if (data.weekendPrice > 0 && data.weekendPrice < data.pricePerNight) {
    return {
      ok: false,
      error: t.validation.weekendBelowWeekday,
      fieldErrors: { weekendPrice: t.validation.weekendBelowWeekdayShort },
    };
  }

  const common = listingColumns(data, amenities, categories, {
    allowEditorialFlags: true,
  });

  // An admin may assign a listing to an owner. Only ids that actually exist are
  // accepted — a bad id silently becoming null would quietly turn an owned
  // listing into a platform-owned one that ignores the owner's membership.
  let ownerId: string | null | undefined;
  if (formData.has("ownerId")) {
    const rawOwnerId = String(formData.get("ownerId") ?? "").trim();
    if (!rawOwnerId) {
      ownerId = null;
    } else {
      const owner = await prisma.ownerProfile.findUnique({
        where: { id: rawOwnerId },
        select: { id: true },
      });
      if (!owner) return { ok: false, error: t.validation.ownerNotFound };
      ownerId = owner.id;
    }
  }

  try {
    if (id) {
      const existing = await prisma.listing.findUnique({
        where: { id },
        select: { slug: true, name: true, published: true },
      });
      if (!existing) return { ok: false, error: t.validation.listingNotFound };

      // Only re-slug on a rename, so existing links and search rankings survive
      // an ordinary price or description edit.
      const slug =
        existing.name === data.name
          ? existing.slug
          : uniqueSlug(data.name, await getTakenSlugs(id));

      const updated = await prisma.listing.update({
        where: { id },
        data: { ...common, slug, ...(ownerId !== undefined ? { ownerId } : {}) },
      });

      await prisma.auditLog.create({
        data: auditData({
          actor: { id: admin.id, email: admin.email, role: admin.role },
          action:
            existing.published !== data.published
              ? "LISTING_VISIBILITY_CHANGED"
              : "LISTING_UPDATED",
          entityType: "Listing",
          entityId: updated.id,
          summary: updated.name,
          metadata: {
            publishedFrom: existing.published,
            publishedTo: data.published,
            depositPercent: data.depositPercent,
          },
        }),
      });

      revalidateListing(existing.slug);
      if (slug !== existing.slug) revalidateListing(slug);
      revalidatePath("/admin/listings");

      return { ok: true, id: updated.id, slug: updated.slug, message: t.common.saved };
    }

    const slug = uniqueSlug(data.name, await getTakenSlugs());
    const created = await prisma.listing.create({
      data: { ...common, slug, ...(ownerId !== undefined ? { ownerId } : {}) },
    });

    await prisma.auditLog.create({
      data: auditData({
        actor: { id: admin.id, email: admin.email, role: admin.role },
        action: "LISTING_CREATED",
        entityType: "Listing",
        entityId: created.id,
        summary: created.name,
        metadata: { ownerId: ownerId ?? null },
      }),
    });

    revalidateListing(slug);
    revalidatePath("/admin/listings");

    return { ok: true, id: created.id, slug: created.slug, message: t.common.created };
  } catch (error) {
    console.error("saveListing failed:", error);
    return { ok: false, error: t.validation.saveFailed };
  }
}

/* -------------------------------------------------------------------------- */
/* create / update — owner                                                    */
/* -------------------------------------------------------------------------- */

/**
 * An owner creating or editing one of their own listings.
 *
 * `requireApprovedOwner()` re-reads status and membership from the database, so
 * a pending, rejected, suspended or expired owner is refused here even though
 * their 30-day session cookie is still perfectly valid. Hiding the form is a UX
 * courtesy; this is the enforcement.
 */
export async function saveOwnerListing(formData: FormData): Promise<ActionResult> {
  const { t } = await getI18n();

  let owner, user;
  try {
    ({ owner, user } = await requireApprovedOwner());
  } catch (error) {
    return guardResult(error, t);
  }

  const id = String(formData.get("id") ?? "").trim() || null;
  const parsed = readListingForm(formData, t);

  if (!parsed.success) {
    return {
      ok: false,
      error: t.validation.checkFields,
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const data = parsed.data;
  const amenities = readIdList(formData, "amenities", VALID_AMENITY_IDS);
  const categories = readIdList(formData, "categories", VALID_CATEGORY_IDS);

  if (data.weekendPrice > 0 && data.weekendPrice < data.pricePerNight) {
    return {
      ok: false,
      error: t.validation.weekendBelowWeekday,
      fieldErrors: { weekendPrice: t.validation.weekendBelowWeekdayShort },
    };
  }

  const common = listingColumns(data, amenities, categories, {
    allowEditorialFlags: false,
  });

  try {
    if (id) {
      // `ownerId` in the WHERE clause, not a check after the read.
      const existing = await prisma.listing.findFirst({
        where: { id, ownerId: owner.id },
        select: { id: true, slug: true, name: true, published: true },
      });
      if (!existing) return { ok: false, error: t.validation.listingNotFound };

      const slug =
        existing.name === data.name
          ? existing.slug
          : uniqueSlug(data.name, await getTakenSlugs(id));

      const updated = await prisma.listing.update({
        where: { id: existing.id },
        data: { ...common, slug },
      });

      await prisma.auditLog.create({
        data: auditData({
          actor: { id: user.id, email: user.email, role: user.role },
          action:
            existing.published !== data.published
              ? "LISTING_VISIBILITY_CHANGED"
              : "LISTING_UPDATED",
          entityType: "Listing",
          entityId: updated.id,
          summary: updated.name,
          metadata: {
            ownerId: owner.id,
            publishedFrom: existing.published,
            publishedTo: data.published,
            depositPercent: data.depositPercent,
          },
        }),
      });

      revalidateListing(existing.slug);
      if (slug !== existing.slug) revalidateListing(slug);
      revalidatePath("/owner/listings");

      return { ok: true, id: updated.id, slug: updated.slug, message: t.common.saved };
    }

    const slug = uniqueSlug(data.name, await getTakenSlugs());
    const created = await prisma.listing.create({
      // ownerId comes from the session, never the form.
      data: { ...common, slug, ownerId: owner.id },
    });

    await prisma.auditLog.create({
      data: auditData({
        actor: { id: user.id, email: user.email, role: user.role },
        action: "LISTING_CREATED",
        entityType: "Listing",
        entityId: created.id,
        summary: created.name,
        metadata: { ownerId: owner.id },
      }),
    });

    revalidateListing(slug);
    revalidatePath("/owner/listings");

    return { ok: true, id: created.id, slug: created.slug, message: t.common.created };
  } catch (error) {
    console.error("saveOwnerListing failed:", error);
    return { ok: false, error: t.validation.saveFailed };
  }
}

/* -------------------------------------------------------------------------- */
/* delete                                                                     */
/* -------------------------------------------------------------------------- */

export async function deleteListing(id: string): Promise<ActionResult> {
  const { t } = await getI18n();

  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return guardResult(error, t);
  }

  return deleteListingScoped({ id }, t, {
    id: admin.id,
    email: admin.email,
    role: admin.role,
  });
}

/** An owner deleting one of their own listings. */
export async function deleteOwnerListing(id: string): Promise<ActionResult> {
  const { t } = await getI18n();

  let owner, user;
  try {
    ({ owner, user } = await requireApprovedOwner());
  } catch (error) {
    return guardResult(error, t);
  }

  return deleteListingScoped({ id, ownerId: owner.id }, t, {
    id: user.id,
    email: user.email,
    role: user.role,
  });
}

async function deleteListingScoped(
  where: Prisma.ListingWhereInput,
  t: Dictionary,
  actor: { id: string; email: string; role: string },
): Promise<ActionResult> {
  try {
    const listing = await prisma.listing.findFirst({
      where,
      select: { id: true, name: true, slug: true, images: { select: { url: true } } },
    });
    if (!listing) return { ok: false, error: t.validation.listingNotFound };

    // Image rows cascade at the database level (onDelete: Cascade), but the
    // stored *bytes* don't — a file on disk or a StoredImage blob outlives the
    // row that referenced it. Clean them up first so deleting a listing doesn't
    // leak orphaned uploads. `deleteStoredAsset` routes on the URL's shape, so a
    // gallery mixing local files, database blobs and seed URLs is handled
    // correctly in one pass.
    await Promise.all(listing.images.map((img) => deleteStoredAsset(img.url)));

    await prisma.$transaction([
      prisma.listing.delete({ where: { id: listing.id } }),
      prisma.auditLog.create({
        data: auditData({
          actor,
          action: "LISTING_DELETED",
          entityType: "Listing",
          entityId: listing.id,
          summary: listing.name,
        }),
      }),
    ]);

    revalidateListing(listing.slug);
    revalidatePath("/admin/listings");
    revalidatePath("/owner/listings");

    return { ok: true, message: t.common.deleted };
  } catch (error) {
    console.error("deleteListing failed:", error);
    return { ok: false, error: t.validation.deleteFailed };
  }
}

/* -------------------------------------------------------------------------- */
/* publish toggle                                                             */
/* -------------------------------------------------------------------------- */

/** Quick publish/unpublish from the listings grid. */
export async function toggleListingPublished(id: string): Promise<ActionResult> {
  const { t } = await getI18n();

  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return guardResult(error, t);
  }

  return togglePublishedScoped({ id }, t, {
    id: admin.id,
    email: admin.email,
    role: admin.role,
  });
}

export async function toggleOwnerListingPublished(id: string): Promise<ActionResult> {
  const { t } = await getI18n();

  let owner, user;
  try {
    ({ owner, user } = await requireApprovedOwner());
  } catch (error) {
    return guardResult(error, t);
  }

  return togglePublishedScoped({ id, ownerId: owner.id }, t, {
    id: user.id,
    email: user.email,
    role: user.role,
  });
}

async function togglePublishedScoped(
  where: Prisma.ListingWhereInput,
  t: Dictionary,
  actor: { id: string; email: string; role: string },
): Promise<ActionResult> {
  const listing = await prisma.listing.findFirst({
    where,
    select: { id: true, name: true, published: true, slug: true },
  });
  if (!listing) return { ok: false, error: t.validation.listingNotFound };

  await prisma.$transaction([
    prisma.listing.update({
      where: { id: listing.id },
      data: { published: !listing.published },
    }),
    prisma.auditLog.create({
      data: auditData({
        actor,
        action: "LISTING_VISIBILITY_CHANGED",
        entityType: "Listing",
        entityId: listing.id,
        summary: listing.name,
        metadata: { publishedFrom: listing.published, publishedTo: !listing.published },
      }),
    }),
  ]);

  revalidateListing(listing.slug);
  revalidatePath("/admin/listings");
  revalidatePath("/owner/listings");

  return { ok: true, message: t.common.saved };
}

/* -------------------------------------------------------------------------- */
/* images                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Attach uploaded images to a listing.
 *
 * Bytes go through the storage adapter (src/lib/storage), so this same action
 * works unchanged whether files land on local disk, Cloudinary or S3.
 */
export async function addListingImages(
  listingId: string,
  files: File[],
): Promise<ActionResult> {
  const { t } = await getI18n();

  try {
    await requireAdmin();
  } catch (error) {
    return guardResult(error, t);
  }

  return addImagesScoped({ id: listingId }, files, t);
}

export async function addOwnerListingImages(
  listingId: string,
  files: File[],
): Promise<ActionResult> {
  const { t } = await getI18n();

  let owner;
  try {
    ({ owner } = await requireApprovedOwner());
  } catch (error) {
    return guardResult(error, t);
  }

  return addImagesScoped({ id: listingId, ownerId: owner.id }, files, t);
}

/** Maximum gallery size per listing. */
const MAX_IMAGES = 30;

async function addImagesScoped(
  where: Prisma.ListingWhereInput,
  files: File[],
  t: Dictionary,
): Promise<ActionResult> {
  const listing = await prisma.listing.findFirst({
    where,
    select: { id: true, slug: true, name: true, _count: { select: { images: true } } },
  });
  if (!listing) return { ok: false, error: t.validation.listingNotFound };

  if (listing._count.images + files.length > MAX_IMAGES) {
    return { ok: false, error: t.listing.tooManyImages(String(MAX_IMAGES)) };
  }

  const storage = getStorage();
  let sortOrder = listing._count.images;

  try {
    for (const file of files) {
      if (!file || file.size === 0) continue;
      const stored = await storage.save(file, { folder: "listings" });
      await prisma.listingImage.create({
        data: {
          listingId: listing.id,
          url: stored.url,
          alt: `${listing.name} — ${sortOrder + 1}`,
          sortOrder: sortOrder++,
        },
      });
    }
  } catch (error) {
    // The adapter refused the file. It carries a stable `code` rather than a
    // translated string, because the storage layer is provider-agnostic
    // plumbing with no request scope — so the message is resolved here, where
    // the visitor's locale is known.
    if (error instanceof UploadError) {
      const byCode: Record<string, string> = {
        NO_FILE: t.validation.uploadNoFile,
        EMPTY: t.validation.uploadEmpty,
        TOO_LARGE: t.validation.uploadTooLarge,
        BAD_FORMAT: t.validation.uploadBadFormat,
      };
      return { ok: false, error: byCode[error.code] ?? t.validation.saveFailed };
    }
    console.error("addListingImages failed:", error);
    return { ok: false, error: t.validation.saveFailed };
  }

  revalidateListing(listing.slug);
  revalidatePath(`/admin/listings/${listing.id}`);
  revalidatePath(`/owner/listings/${listing.id}`);

  return { ok: true, message: t.common.saved };
}

export async function deleteListingImage(imageId: string): Promise<ActionResult> {
  const { t } = await getI18n();

  try {
    await requireAdmin();
  } catch (error) {
    return guardResult(error, t);
  }

  return deleteImageScoped(imageId, undefined, t);
}

export async function deleteOwnerListingImage(imageId: string): Promise<ActionResult> {
  const { t } = await getI18n();

  let owner;
  try {
    ({ owner } = await requireApprovedOwner());
  } catch (error) {
    return guardResult(error, t);
  }

  return deleteImageScoped(imageId, owner.id, t);
}

async function deleteImageScoped(
  imageId: string,
  ownerId: string | undefined,
  t: Dictionary,
): Promise<ActionResult> {
  const image = await prisma.listingImage.findFirst({
    // The ownership constraint is expressed through the parent listing, so an
    // owner passing another owner's image id gets "not found".
    where: { id: imageId, ...(ownerId ? { listing: { ownerId } } : {}) },
    select: { id: true, url: true, listingId: true, listing: { select: { slug: true } } },
  });
  if (!image) return { ok: false, error: t.validation.listingNotFound };

  await prisma.listingImage.delete({ where: { id: image.id } });
  await deleteStoredAsset(image.url);

  revalidateListing(image.listing.slug);
  revalidatePath(`/admin/listings/${image.listingId}`);
  revalidatePath(`/owner/listings/${image.listingId}`);

  return { ok: true, message: t.common.deleted };
}

/** Move an image to the front of the gallery — it becomes the card cover. */
export async function makeImageCover(imageId: string): Promise<ActionResult> {
  const { t } = await getI18n();

  try {
    await requireAdmin();
  } catch (error) {
    return guardResult(error, t);
  }

  return makeCoverScoped(imageId, undefined, t);
}

export async function makeOwnerImageCover(imageId: string): Promise<ActionResult> {
  const { t } = await getI18n();

  let owner;
  try {
    ({ owner } = await requireApprovedOwner());
  } catch (error) {
    return guardResult(error, t);
  }

  return makeCoverScoped(imageId, owner.id, t);
}

async function makeCoverScoped(
  imageId: string,
  ownerId: string | undefined,
  t: Dictionary,
): Promise<ActionResult> {
  const image = await prisma.listingImage.findFirst({
    where: { id: imageId, ...(ownerId ? { listing: { ownerId } } : {}) },
    select: { id: true, listingId: true, listing: { select: { slug: true } } },
  });
  if (!image) return { ok: false, error: t.validation.listingNotFound };

  const siblings = await prisma.listingImage.findMany({
    where: { listingId: image.listingId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });

  // Rewrite the whole order rather than juggling two rows — with ≤30 images it
  // costs nothing and can't leave a duplicate sortOrder behind.
  const reordered = [
    image.id,
    ...siblings.map((s) => s.id).filter((sid) => sid !== image.id),
  ];
  await prisma.$transaction(
    reordered.map((sid, index) =>
      prisma.listingImage.update({ where: { id: sid }, data: { sortOrder: index } }),
    ),
  );

  revalidateListing(image.listing.slug);
  revalidatePath(`/admin/listings/${image.listingId}`);
  revalidatePath(`/owner/listings/${image.listingId}`);

  return { ok: true, message: t.common.saved };
}
