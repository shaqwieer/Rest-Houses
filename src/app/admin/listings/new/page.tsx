import { ListingEditor } from "@/components/admin/listing-editor";
import { getSettings } from "@/lib/settings";

/** New-listing form. Sensible defaults so the owner types as little as possible:
 *  the map starts at the site's own coordinates and a handful of amenities that
 *  practically every استراحة has are pre-selected. */
export default async function NewListingPage() {
  const settings = await getSettings();

  return (
    <ListingEditor
      draft={{
        id: null,
        name: "",
        description: "",
        city: "dubai",
        area: "",
        pricePerNight: 1200,
        weekendPrice: 0,
        capacity: 40,
        lat: settings.mapLat,
        lng: settings.mapLng,
        amenityIds: ["wifi", "ac", "park", "bbq", "wc"],
        categoryIds: ["family"],
        verified: false,
        featured: false,
        published: true,
        ownerName: "",
        ownerWhatsapp: "",
        images: [],
      }}
    />
  );
}
