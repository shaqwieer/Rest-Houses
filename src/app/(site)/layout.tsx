import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { FavoritesProvider } from "@/components/site/favorites-provider";
import { GoogleTag } from "@/components/site/google-tag";
import { getSettings } from "@/lib/settings";

/**
 * Layout for the public site (everything except /admin and /login).
 *
 * A route group so the admin dashboard can have a completely different shell —
 * dark header, bottom tab bar — without either fighting the other's chrome.
 *
 * `settings` is fetched once here and passed down as a prop. `getSettings()` is
 * request-cached anyway, but passing it explicitly keeps the header and footer
 * as pure components that are trivial to reason about.
 *
 * It is also where the Google tag is mounted, and mounting it *here* rather
 * than in the root layout is the point: /admin, /owner and /login live outside
 * this route group, so the operator's own sessions never reach the advertising
 * account. See src/components/site/google-tag.tsx.
 */
export default async function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const settings = await getSettings();

  return (
    <FavoritesProvider>
      {/* "" when no tag is configured — renders nothing. */}
      <GoogleTag id={settings.googleTagId} />
      <div className="flex min-h-screen flex-col bg-sand-50">
        <SiteHeader settings={settings} />
        <main className="flex-1">{children}</main>
        <SiteFooter settings={settings} />
      </div>
    </FavoritesProvider>
  );
}
