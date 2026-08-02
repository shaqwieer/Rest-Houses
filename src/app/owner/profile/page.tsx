import { OwnerProfileForm } from "@/components/owner/profile-form";
import { getActiveOwnerSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { toISODate } from "@/lib/dates";

/**
 * The owner's own profile.
 *
 * The WhatsApp number edited here is what every one of this owner's listings
 * uses for its contact buttons — held once and read through the relation, so
 * changing it updates all of them at the same moment.
 */
export default async function OwnerProfilePage() {
  // null while the owner is pending/rejected/suspended/expired — the layout
  // is rendering the status panel and discards this page's output. Returning
  // early avoids reading data the owner may not see, without the throw that
  // would log a stack trace on a request behaving exactly as designed.
  const session = await getActiveOwnerSession();
  if (!session) return null;
  const { owner, user } = session;
  const { t } = await getI18n();

  return (
    <div className="animate-fade-up">
      <div className="mb-4">
        <h1 className="m-0 font-display text-[20px] font-extrabold text-ink">
          {t.owner.profileTitle}
        </h1>
        <p className="m-0 text-[12.5px] text-muted">{t.owner.profileSubtitle}</p>
      </div>

      <OwnerProfileForm
        profile={{
          fullName: owner.fullName,
          email: user.email,
          phone: owner.phone,
          whatsapp: owner.whatsapp,
          businessName: owner.businessName,
          city: owner.city,
          about: owner.about,
          membershipExpiresAt: owner.membershipExpiresAt
            ? toISODate(owner.membershipExpiresAt)
            : null,
        }}
      />
    </div>
  );
}
