import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { FavoritesProvider } from "@/components/site/favorites-provider";
import { TrackingScripts } from "@/components/site/tracking-scripts";
import { WhatsappTracker } from "@/components/site/whatsapp-tracker";
import { getSettings } from "@/lib/settings";
import { trackingConfig } from "@/lib/tracking";

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
 * It is also where every advertising pixel is mounted, and mounting them *here*
 * rather than in the root layout is the point: /admin, /owner and /login live
 * outside this route group, so the operator's own sessions never reach the
 * advertising accounts. See src/components/site/tracking-scripts.tsx — and the
 * `ownerAreaTracking` switch, which is the one deliberate, opt-in exception.
 */
export default async function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const settings = await getSettings();

  return (
    <FavoritesProvider>
      {/* Renders nothing at all when no platform is configured. */}
      <TrackingScripts config={trackingConfig(settings)} />
      {/* One listener for every wa.me link on the public site — see the note in
          the component for why this is not a prop on nine buttons. */}
      <WhatsappTracker />
      <div className="flex min-h-screen flex-col bg-sand-50">
        <SiteHeader settings={settings} />
        <main className="flex-1">{children}</main>
        <SiteFooter settings={settings} />
      </div>
    </FavoritesProvider>
  );
}
