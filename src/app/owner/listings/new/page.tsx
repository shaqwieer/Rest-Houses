import { ListingEditor } from "@/components/admin/listing-editor";
import { getSettings } from "@/lib/settings";
import { getActiveOwnerSession } from "@/lib/auth";
import { formatWhatsappDisplay } from "@/lib/whatsapp";

/**
 * An owner creating a new rest house.
 *
 * A pending, rejected, suspended or expired owner never sees this form — the
 * layout renders the status panel instead. More importantly they cannot submit
 * one either: `saveOwnerListing` runs `requireApprovedOwner()`, which throws, so
 * hiding the form is a courtesy and the action is the enforcement.
 */
export default async function NewOwnerListingPage() {
  // null while the owner is pending/rejected/suspended/expired — the layout
  // is rendering the status panel and discards this page's output.
  const session = await getActiveOwnerSession();
  if (!session) return null;
  const { owner } = session;
  const settings = await getSettings();

  return (
    <ListingEditor
      scope="owner"
      platformDepositPercent={settings.depositPercent}
      ownerWhatsapp={formatWhatsappDisplay(owner.whatsapp)}
      draft={{
        id: null,
        name: "",
        description: "",
        nameEn: "",
        descriptionEn: "",
        areaEn: "",
        city: owner.city || "dubai",
        area: "",
        pricePerNight: 1200,
        weekendPrice: 0,
        dayUsePrice: 0,
        dayUseWeekendPrice: 0,
        dayUseCheckOutTime: "",
        dayUseCheckOutTimeEn: "",
        securityDeposit: 0,
        capacity: 40,
        lat: settings.mapLat,
        lng: settings.mapLng,
        depositPercent: null,
        amenityIds: ["wifi", "ac", "park", "bbq", "wc"],
        categoryIds: ["family"],
        verified: false,
        featured: false,
        published: true,
        ownerName: owner.fullName,
        ownerWhatsapp: owner.whatsapp,
        ownerId: owner.id,
        images: [],
      }}
    />
  );
}
