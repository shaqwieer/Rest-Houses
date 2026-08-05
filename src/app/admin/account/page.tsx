import { AdminAccountForm } from "@/components/admin/account-form";
import { requireAdminPage } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";

/**
 * The operator's own account.
 *
 * `requireAdminPage()` returns the signed-in account, so the form is pre-filled
 * from the session's own row and there is no id anywhere on the page — the
 * server actions behind it act on `requireAdmin().id` and nothing else, which is
 * what makes "edit my account" incapable of editing anybody else's.
 */
export default async function AdminAccountPage() {
  const admin = await requireAdminPage();
  const { t } = await getI18n();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="m-0 mb-1 font-display text-[22px] font-extrabold text-ink">
          {t.admin.account}
        </h1>
        <p className="m-0 text-[13.5px] text-muted">{t.admin.accountIntro}</p>
      </div>

      <AdminAccountForm
        account={{ name: admin.name ?? "", email: admin.email }}
      />
    </div>
  );
}
