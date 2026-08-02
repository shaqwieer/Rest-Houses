import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OwnerRegisterForm } from "@/components/owner/register-form";
import { PageHeader } from "@/components/site/page-shell";
import { auth } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";

/**
 * Owner registration.
 *
 * ─── Why this lives inside the (site) route group ────────────────────────────
 * It needs the public chrome — header, footer, and crucially the
 * `FavoritesProvider` those depend on. `SiteHeader` calls `useFavorites()`,
 * which throws without that provider; rendering the header from outside the
 * group returned a 500 on this route until the page was moved here.
 *
 * A route group adds no path segment, so the URL is still /register/owner and
 * the middleware — which matches only /admin and /owner — still leaves it open.
 * That matters: a registration form behind a "you must be signed in" redirect
 * could never be used.
 *
 * This is one of the two places on the platform where owner-facing copy belongs
 * (the other is the owner dashboard). Everything else the public sees addresses
 * the customer looking for a rest house — see requirement 6.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t.owner.registerTitle,
    description: t.owner.registerSubtitle,
    robots: { index: true, follow: true },
  };
}

export default async function OwnerRegisterPage() {
  const [{ t }, session] = await Promise.all([getI18n(), auth()]);

  // Already signed in: send them where they belong rather than letting them
  // create a second account for the same person.
  if (session?.user) redirect("/owner");

  return (
    <>
      <PageHeader title={t.owner.registerTitle} subtitle={t.owner.registerSubtitle} />

      <div className="mx-auto max-w-[900px] px-4 py-8 md:px-10 md:py-12">
        <OwnerRegisterForm />
      </div>
    </>
  );
}
