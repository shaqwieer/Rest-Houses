import { ListingEditor } from "@/components/admin/listing-editor";
import { getSettings } from "@/lib/settings";
import { getActiveOwnerSession } from "@/lib/auth";
import { formatWhatsappDisplay } from "@/lib/whatsapp";
import { platformPolicyFor } from "@/lib/policies";
import { getI18n } from "@/lib/i18n/server";

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
  const [settings, { locale }] = await Promise.all([getSettings(), getI18n()]);

  return (
    <ListingEditor
      scope="owner"
      platformDepositPercent={settings.depositPercent}
      platformPolicy={platformPolicyFor(settings, locale)}
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
        holidayPrice: 0,
        // Pre-selected from the owner's own emirate, because Sharjah is the
        // whole reason this option exists: its working week is four days, so a
        // Sharjah rest house is full on Friday night. It is a `<select>` the
        // owner can change on the same screen — a default, not a decision.
        weekendMode: owner.city === "sharjah" ? "long" : "short",
        // Blank inherits the platform's times and cancellation window, which is
        // exactly the page a new listing has today. An owner who wants their
        // own hours types them here.
        checkInHour: null,
        checkOutHour: null,
        checkInTime: "",
        checkOutTime: "",
        cancelPolicy: "",
        freeCancelHours: null,
        dayUsePrice: 0,
        dayUseWeekendPrice: 0,
        dayUseCheckOutHour: null,
        dayUseCheckOutTime: "",
        securityDeposit: 0,
        instagram: "",
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
