import { ListingEditor } from "@/components/admin/listing-editor";
import { getSettings } from "@/lib/settings";
import { requireAdminPage } from "@/lib/auth";
import { listOwnerOptions } from "@/lib/admin-queries";

/** New-listing form. Sensible defaults so the operator types as little as
 *  possible: the map starts at the site's own coordinates and a handful of
 *  amenities that practically every استراحة has are pre-selected. */
export default async function NewListingPage() {
  await requireAdminPage();

  const [settings, owners] = await Promise.all([getSettings(), listOwnerOptions()]);

  return (
    <ListingEditor
      scope="admin"
      platformDepositPercent={settings.depositPercent}
      owners={owners}
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
        // null, not the platform default: leaving it unset means the listing
        // tracks the platform's rate if the operator later changes it, rather
        // than freezing today's value into the row.
        depositPercent: null,
        amenityIds: ["wifi", "ac", "park", "bbq", "wc"],
        categoryIds: ["family"],
        verified: false,
        featured: false,
        published: true,
        ownerName: "",
        ownerWhatsapp: "",
        ownerId: null,
        images: [],
      }}
    />
  );
}
