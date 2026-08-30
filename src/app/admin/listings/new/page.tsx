import { ListingEditor } from "@/components/admin/listing-editor";
import { getSettings } from "@/lib/settings";
import { platformPaymentModes } from "@/lib/payments";
import { requireAdminPage } from "@/lib/auth";
import { listOwnerOptions } from "@/lib/admin-queries";
import { platformPolicyFor } from "@/lib/policies";
import { DEFAULT_WEEKEND_MODE } from "@/lib/dates";
import { getI18n } from "@/lib/i18n/server";

/** New-listing form. Sensible defaults so the operator types as little as
 *  possible: the map starts at the site's own coordinates and a handful of
 *  amenities that practically every استراحة has are pre-selected. */
export default async function NewListingPage() {
  await requireAdminPage();

  const [settings, owners, { locale }] = await Promise.all([
    getSettings(),
    listOwnerOptions(),
    getI18n(),
  ]);

  return (
    <ListingEditor
      scope="admin"
      platformDepositPercent={settings.depositPercent}
      platformPaymentModes={platformPaymentModes(settings)}
      platformPolicy={platformPolicyFor(settings, locale)}
      owners={owners}
      draft={{
        id: null,
        name: "",
        description: "",
        nameEn: "",
        descriptionEn: "",
        areaEn: "",
        city: "dubai",
        area: "",
        pricePerNight: 1200,
        weekendPrice: 0,
        holidayPrice: 0,
        // The UAE weekend. An admin creating a Sharjah listing switches it to
        // "long" on the same screen — unlike the owner form there is no emirate
        // chosen yet to infer it from.
        weekendMode: DEFAULT_WEEKEND_MODE,
        // Blank / null = inherit the platform's stay policy, which is the page
        // every listing shows today. Same reasoning as `depositPercent` below:
        // an unset field tracks the platform if the operator changes it later,
        // rather than freezing today's value into the row.
        checkInHour: null,
        checkOutHour: null,
        checkInTime: "",
        checkOutTime: "",
        cancelPolicy: "",
        freeCancelHours: null,
        // 0 / "" = not offered. A new listing does not advertise day bookings
        // or ask for a security deposit until someone deliberately fills these
        // in, which is the "اختياري" the requirement asks for.
        dayUsePrice: 0,
        dayUseWeekendPrice: 0,
        dayUseCheckOutHour: null,
        dayUseCheckOutTime: "",
        securityDeposit: 0,
        instagram: "",
        capacity: 40,
        lat: settings.mapLat,
        lng: settings.mapLng,
        // null, not the platform default: leaving it unset means the listing
        // tracks the platform's rate if the operator later changes it, rather
        // than freezing today's value into the row.
        depositPercent: null,
        paymentModes: null,
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
