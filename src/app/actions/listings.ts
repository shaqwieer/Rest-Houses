"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { getTakenSlugs } from "@/lib/listings";
import { uniqueSlug } from "@/lib/slug";
import { stringifyIdList } from "@/lib/json-list";
import { AMENITIES, CATEGORIES, CITIES } from "@/lib/constants";
import { deleteStoredAsset, getStorage, UploadError } from "@/lib/storage";

/**
 * Listing CRUD for the admin dashboard.
 *
 * Every action begins with `requireAdmin()`. Server actions are reachable by
 * anyone who can guess their generated id — the middleware guard on /admin
 * protects *navigation*, not the action endpoints, so authorisation has to be
 * re-asserted here.
 *
 * After a write we `revalidatePath` the public pages that embed the data, since
 * listing pages are statically generated (see `revalidate` in the detail page).
 * Without this the owner would edit a price and not see it on the live site.
 */

export type ActionResult =
  | { ok: true; id?: string; slug?: string; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const VALID_CITY_IDS = CITIES.map((c) => c.id);
const VALID_AMENITY_IDS = new Set(AMENITIES.map((a) => a.id));
const VALID_CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

const listingSchema = z.object({
  name: z.string().trim().min(3, "الاسم قصير جدًا").max(160),
  description: z.string().trim().max(5000).default(""),
  city: z.enum(VALID_CITY_IDS as [string, ...string[]], { message: "اختر مدينة صحيحة" }),
  area: z.string().trim().max(160).default(""),
  pricePerNight: z.coerce.number().int().min(1, "السعر مطلوب").max(1_000_000),
  weekendPrice: z.coerce.number().int().min(0).max(1_000_000).default(0),
  capacity: z.coerce.number().int().min(1, "السعة مطلوبة").max(5000),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  ownerName: z.string().trim().max(120).default(""),
  ownerWhatsapp: z.string().trim().max(40).default(""),
  verified: z.coerce.boolean().default(false),
  featured: z.coerce.boolean().default(false),
  published: z.coerce.boolean().default(true),
});

/** Read the shared listing fields out of a FormData. */
function readListingForm(formData: FormData) {
  // Checkboxes are absent from FormData when unchecked, hence the `=== "on"`
  // rather than a truthiness check on a possibly-null value.
  return listingSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    city: formData.get("city"),
    area: formData.get("area") ?? "",
    pricePerNight: formData.get("pricePerNight"),
    weekendPrice: formData.get("weekendPrice") ?? 0,
    capacity: formData.get("capacity"),
    lat: formData.get("lat") || 24.7614,
    lng: formData.get("lng") || 55.334,
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

/* -------------------------------------------------------------------------- */
/* create / update                                                            */
/* -------------------------------------------------------------------------- */

export async function saveListing(formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const id = String(formData.get("id") ?? "").trim() || null;
  const parsed = readListingForm(formData);

  if (!parsed.success) {
    return {
      ok: false,
      error: "الرجاء التحقّق من الحقول المطلوبة",
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
      error: "سعر نهاية الأسبوع لا يمكن أن يكون أقل من سعر الليلة العادية",
      fieldErrors: { weekendPrice: "أقل من السعر العادي" },
    };
  }

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
    amenities: stringifyIdList(amenities),
    categories: stringifyIdList(categories),
    verified: data.verified,
    featured: data.featured,
    published: data.published,
    ownerName: data.ownerName || "المالك",
    ownerWhatsapp: data.ownerWhatsapp || null,
  };

  try {
    if (id) {
      const existing = await prisma.listing.findUnique({
        where: { id },
        select: { slug: true, name: true },
      });
      if (!existing) return { ok: false, error: "الاستراحة غير موجودة" };

      // Only re-slug on a rename, so existing links and search rankings survive
      // an ordinary price or description edit.
      const slug =
        existing.name === data.name
          ? existing.slug
          : uniqueSlug(data.name, await getTakenSlugs(id));

      const updated = await prisma.listing.update({
        where: { id },
        data: { ...common, slug },
      });

      revalidateListing(existing.slug);
      if (slug !== existing.slug) revalidateListing(slug);
      revalidatePath("/admin/listings");

      return { ok: true, id: updated.id, slug: updated.slug, message: "تم حفظ التعديلات" };
    }

    const slug = uniqueSlug(data.name, await getTakenSlugs());
    const created = await prisma.listing.create({ data: { ...common, slug } });

    revalidateListing(slug);
    revalidatePath("/admin/listings");

    return { ok: true, id: created.id, slug: created.slug, message: "تمت إضافة الاستراحة" };
  } catch (error) {
    console.error("saveListing failed:", error);
    return { ok: false, error: "تعذّر الحفظ — حاول مرة أخرى" };
  }
}

/* -------------------------------------------------------------------------- */
/* delete                                                                     */
/* -------------------------------------------------------------------------- */

export async function deleteListing(id: string): Promise<ActionResult> {
  await requireAdmin();

  try {
    const listing = await prisma.listing.findUnique({
      where: { id },
      select: { slug: true, images: { select: { url: true } } },
    });
    if (!listing) return { ok: false, error: "الاستراحة غير موجودة" };

    // Image rows cascade at the database level (onDelete: Cascade), but the
    // stored *bytes* don't — a file on disk or a StoredImage blob outlives the
    // row that referenced it. Clean them up first so deleting a listing doesn't
    // leak orphaned uploads. `deleteStoredAsset` routes on the URL's shape, so a
    // gallery mixing local files, database blobs and seed URLs is handled
    // correctly in one pass.
    await Promise.all(listing.images.map((img) => deleteStoredAsset(img.url)));

    await prisma.listing.delete({ where: { id } });

    revalidateListing(listing.slug);
    revalidatePath("/admin/listings");

    return { ok: true, message: "تم حذف الاستراحة" };
  } catch (error) {
    console.error("deleteListing failed:", error);
    return { ok: false, error: "تعذّر الحذف — حاول مرة أخرى" };
  }
}

/** Quick publish/unpublish from the listings grid. */
export async function toggleListingPublished(id: string): Promise<ActionResult> {
  await requireAdmin();

  const listing = await prisma.listing.findUnique({
    where: { id },
    select: { published: true, slug: true },
  });
  if (!listing) return { ok: false, error: "الاستراحة غير موجودة" };

  await prisma.listing.update({
    where: { id },
    data: { published: !listing.published },
  });

  revalidateListing(listing.slug);
  revalidatePath("/admin/listings");

  return {
    ok: true,
    message: listing.published ? "تم إخفاء الاستراحة عن الموقع" : "الاستراحة ظاهرة الآن",
  };
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
  await requireAdmin();

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { slug: true, name: true, _count: { select: { images: true } } },
  });
  if (!listing) return { ok: false, error: "الاستراحة غير موجودة" };

  if (listing._count.images + files.length > 30) {
    return { ok: false, error: "الحد الأقصى ٣٠ صورة لكل استراحة" };
  }

  const storage = getStorage();
  let sortOrder = listing._count.images;

  try {
    for (const file of files) {
      if (!file || file.size === 0) continue;
      const stored = await storage.save(file, { folder: "listings" });
      await prisma.listingImage.create({
        data: {
          listingId,
          url: stored.url,
          alt: `${listing.name} — صورة ${sortOrder + 1}`,
          sortOrder: sortOrder++,
        },
      });
    }
  } catch (error) {
    if (error instanceof UploadError) return { ok: false, error: error.message };
    console.error("addListingImages failed:", error);
    return { ok: false, error: "تعذّر رفع الصور — حاول مرة أخرى" };
  }

  revalidateListing(listing.slug);
  revalidatePath(`/admin/listings/${listingId}`);

  return { ok: true, message: "تم رفع الصور" };
}

export async function deleteListingImage(imageId: string): Promise<ActionResult> {
  await requireAdmin();

  const image = await prisma.listingImage.findUnique({
    where: { id: imageId },
    select: { url: true, listingId: true, listing: { select: { slug: true } } },
  });
  if (!image) return { ok: false, error: "الصورة غير موجودة" };

  await prisma.listingImage.delete({ where: { id: imageId } });

  await deleteStoredAsset(image.url);

  revalidateListing(image.listing.slug);
  revalidatePath(`/admin/listings/${image.listingId}`);

  return { ok: true, message: "تم حذف الصورة" };
}

/** Move an image to the front of the gallery — it becomes the card cover. */
export async function makeImageCover(imageId: string): Promise<ActionResult> {
  await requireAdmin();

  const image = await prisma.listingImage.findUnique({
    where: { id: imageId },
    select: { listingId: true, listing: { select: { slug: true } } },
  });
  if (!image) return { ok: false, error: "الصورة غير موجودة" };

  const siblings = await prisma.listingImage.findMany({
    where: { listingId: image.listingId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });

  // Rewrite the whole order rather than juggling two rows — with ≤30 images it
  // costs nothing and can't leave a duplicate sortOrder behind.
  const reordered = [imageId, ...siblings.map((s) => s.id).filter((sid) => sid !== imageId)];
  await prisma.$transaction(
    reordered.map((sid, index) =>
      prisma.listingImage.update({ where: { id: sid }, data: { sortOrder: index } }),
    ),
  );

  revalidateListing(image.listing.slug);
  revalidatePath(`/admin/listings/${image.listingId}`);

  return { ok: true, message: "تم تعيين صورة الغلاف" };
}
