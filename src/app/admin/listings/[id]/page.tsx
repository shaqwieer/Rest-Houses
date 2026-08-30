import { notFound } from "next/navigation";
import { ListingEditor } from "@/components/admin/listing-editor";
import { getListingById } from "@/lib/listings";
import { getSettings } from "@/lib/settings";
import { parseListingPaymentModes, platformPaymentModes } from "@/lib/payments";
import { requireAdminPage } from "@/lib/auth";
import { listOwnerOptions } from "@/lib/admin-queries";
import { platformPolicyFor } from "@/lib/policies";
import { toWeekendMode } from "@/lib/dates";
import { getI18n } from "@/lib/i18n/server";

/** Edit an existing listing. Unlike the public route this looks up by id, so
 *  unpublished drafts are reachable. */
export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPage();

  const { id } = await params;
  const [listing, settings, owners, { locale }] = await Promise.all([
    getListingById(id),
    getSettings(),
    listOwnerOptions(),
    getI18n(),
  ]);
  if (!listing) notFound();

  return (
    <ListingEditor
      scope="admin"
      platformDepositPercent={settings.depositPercent}
      platformPaymentModes={platformPaymentModes(settings)}
      platformPolicy={platformPolicyFor(settings, locale)}
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
        holidayPrice: listing.holidayPrice,
        weekendMode: toWeekendMode(listing.weekendMode),
        checkInHour: listing.checkInHour,
        checkOutHour: listing.checkOutHour,
        checkInTime: listing.checkInTime,
        checkOutTime: listing.checkOutTime,
        cancelPolicy: listing.cancelPolicy,
        freeCancelHours: listing.freeCancelHours,
        dayUsePrice: listing.dayUsePrice,
        dayUseWeekendPrice: listing.dayUseWeekendPrice,
        dayUseCheckOutHour: listing.dayUseCheckOutHour,
        dayUseCheckOutTime: listing.dayUseCheckOutTime,
        securityDeposit: listing.securityDeposit,
        instagram: listing.instagram ?? "",
        capacity: listing.capacity,
        lat: listing.lat,
        lng: listing.lng,
        depositPercent: listing.depositPercent,
        paymentModes: parseListingPaymentModes(listing.paymentModes),
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
