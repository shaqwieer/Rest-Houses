import { notFound } from "next/navigation";
import { ListingEditor } from "@/components/admin/listing-editor";
import { getOwnerListingById } from "@/lib/listings";
import { getSettings } from "@/lib/settings";
import { getActiveOwnerSession } from "@/lib/auth";
import { formatWhatsappDisplay } from "@/lib/whatsapp";

/**
 * An owner editing one of their own rest houses.
 *
 * `getOwnerListingById(id, owner.id)` puts the owner id in the WHERE clause, so
 * asking for someone else's listing returns null and this renders a 404 — the
 * same response as for an id that doesn't exist, which is what keeps it from
 * confirming that another owner's listing is there (IDOR).
 */
export default async function EditOwnerListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // null while the owner is pending/rejected/suspended/expired — the layout
  // is rendering the status panel and discards this page's output.
  const session = await getActiveOwnerSession();
  if (!session) return null;
  const { owner } = session;
  const { id } = await params;

  const [listing, settings] = await Promise.all([
    getOwnerListingById(id, owner.id),
    getSettings(),
  ]);
  if (!listing) notFound();

  return (
    <ListingEditor
      scope="owner"
      platformDepositPercent={settings.depositPercent}
      ownerWhatsapp={formatWhatsappDisplay(owner.whatsapp)}
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
        instagram: listing.instagram ?? "",
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
