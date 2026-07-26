import { notFound } from "next/navigation";
import { ListingEditor } from "@/components/admin/listing-editor";
import { getListingById } from "@/lib/listings";

/** Edit an existing listing. Unlike the public route this looks up by id, so
 *  unpublished drafts are reachable. */
export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listing = await getListingById(id);
  if (!listing) notFound();

  return (
    <ListingEditor
      draft={{
        id: listing.id,
        name: listing.name,
        description: listing.description,
        city: listing.city,
        area: listing.area,
        pricePerNight: listing.pricePerNight,
        weekendPrice: listing.weekendPrice,
        capacity: listing.capacity,
        lat: listing.lat,
        lng: listing.lng,
        amenityIds: listing.amenityIds,
        categoryIds: listing.categoryIds,
        verified: listing.verified,
        featured: listing.featured,
        published: listing.published,
        ownerName: listing.ownerName ?? "",
        ownerWhatsapp: listing.ownerWhatsapp ?? "",
        images: listing.images.map((img) => ({ id: img.id, url: img.url, alt: img.alt })),
      }}
    />
  );
}
