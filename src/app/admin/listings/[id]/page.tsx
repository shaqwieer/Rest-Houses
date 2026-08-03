import { notFound } from "next/navigation";
import { ListingEditor } from "@/components/admin/listing-editor";
import { getListingById } from "@/lib/listings";
import { getSettings } from "@/lib/settings";
import { requireAdminPage } from "@/lib/auth";
import { listOwnerOptions } from "@/lib/admin-queries";

/** Edit an existing listing. Unlike the public route this looks up by id, so
 *  unpublished drafts are reachable. */
export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPage();

  const { id } = await params;
  const [listing, settings, owners] = await Promise.all([
    getListingById(id),
    getSettings(),
    listOwnerOptions(),
  ]);
  if (!listing) notFound();

  return (
    <ListingEditor
      scope="admin"
      platformDepositPercent={settings.depositPercent}
      owners={owners}
      draft={{
        id: listing.id,
        name: listing.name,
        description: listing.description,
        city: listing.city,
        area: listing.area,
        nameEn: listing.nameEn ?? "",
        descriptionEn: listing.descriptionEn ?? "",
        areaEn: listing.areaEn ?? "",
        pricePerNight: listing.pricePerNight,
        weekendPrice: listing.weekendPrice,
        dayUsePrice: listing.dayUsePrice,
        dayUseWeekendPrice: listing.dayUseWeekendPrice,
        dayUseCheckOutTime: listing.dayUseCheckOutTime,
        dayUseCheckOutTimeEn: listing.dayUseCheckOutTimeEn ?? "",
        securityDeposit: listing.securityDeposit,
        capacity: listing.capacity,
        lat: listing.lat,
        lng: listing.lng,
        depositPercent: listing.depositPercent,
        amenityIds: listing.amenityIds,
        categoryIds: listing.categoryIds,
        verified: listing.verified,
        featured: listing.featured,
        published: listing.published,
        ownerName: listing.ownerName ?? "",
        ownerWhatsapp: listing.ownerWhatsapp ?? "",
        ownerId: listing.ownerId,
        images: listing.images.map((img) => ({ id: img.id, url: img.url, alt: img.alt })),
      }}
    />
  );
}
