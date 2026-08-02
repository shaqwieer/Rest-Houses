"use client";

import Link from "next/link";
import { Brand } from "./brand";
import { LanguageSwitcher } from "./language-switcher";
import { Icon, type IconName } from "@/components/ui/icon";
import type { Settings } from "@/lib/settings";
import { localizeSettings } from "@/lib/settings";
import { whatsappLink } from "@/lib/whatsapp";
import { useLocale } from "@/lib/i18n/provider";
import { arNum } from "@/lib/format";

/**
 * Site footer: about + explore links + help links + contact.
 *
 * ─── The "موقعنا / Our Location" block has been removed ──────────────────────
 * This footer used to carry a fourth column with a Google Maps `<iframe>` built
 * from the lat/lng in settings — the only "Our Location" block anywhere in the
 * codebase, and the map that rendered below the home page's closing call to
 * action. It has been deleted outright, along with the keyless
 * `google.com/maps?output=embed` request it made on every page load.
 *
 * Two consequences worth being explicit about:
 *   • The removal is site-wide, not home-page-only. The footer is one shared
 *     component; threading a `hideLocation` prop through it to suppress the
 *     block on a single route would leave the same map on every other page and
 *     add a conditional whose only purpose is to confuse a later reader.
 *   • The contact affordances that lived in that column — the WhatsApp number
 *     and the address line — were **not** lost. They moved into the contact
 *     column below, so nothing a visitor could reach before is unreachable now;
 *     only the embedded map is gone.
 *
 * The interactive per-listing map (Leaflet, components/listing/listing-map.tsx)
 * is a different component on a different page, and is untouched.
 */

function socialLinks(
  settings: Settings,
  emailLabel: string,
): { href: string; icon: IconName; label: string }[] {
  const out: { href: string; icon: IconName; label: string }[] = [];

  if (settings.instagram)
    out.push({ href: settings.instagram, icon: "photo_camera", label: "Instagram" });

  // Returns "" when the number is unusable, so an unconfigured site renders no
  // dead link to `wa.me/`.
  const wa = whatsappLink(settings.whatsappNumber);
  if (wa) out.push({ href: wa, icon: "chat", label: "WhatsApp" });

  if (settings.email)
    out.push({ href: `mailto:${settings.email}`, icon: "alternate_email", label: emailLabel });
  if (settings.youtube)
    out.push({ href: settings.youtube, icon: "play_circle", label: "YouTube" });
  if (settings.tiktok)
    out.push({ href: settings.tiktok, icon: "play_circle", label: "TikTok" });

  return out;
}

export function SiteFooter({ settings }: { settings: Settings }) {
  const { t, locale } = useLocale();
  const s = localizeSettings(settings, locale);

  const socials = socialLinks(settings, t.owner.email);
  const year = arNum(new Date().getFullYear(), locale);
  const waHref = whatsappLink(settings.whatsappNumber);

  return (
    <footer className="relative overflow-hidden bg-night-900">
      <div className="bg-sadu pointer-events-none absolute inset-0 opacity-45" aria-hidden />

      <div className="relative mx-auto max-w-[1280px] px-4 pt-10 md:px-10 md:pt-16">
        <div className="grid gap-8 pb-9 sm:grid-cols-2 lg:grid-cols-4">
          {/* about */}
          <div>
            <div className="mb-3.5">
              <Brand settings={settings} tone="dark" size="md" />
            </div>
            <p className="mb-4 max-w-[34ch] text-[13.5px] leading-relaxed text-sand-100/60">
              {s.footerAbout}
            </p>
            <div className="mb-4 flex gap-2.5">
              {socials.map((social) => (
                <a
                  key={social.label + social.href}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={social.label}
                  className="grid size-9.5 place-items-center rounded-xl border border-gold-500/30 text-gold-300 no-underline transition hover:bg-gold-500/15 hover:no-underline"
                >
                  <Icon name={social.icon} size={19} />
                </a>
              ))}
            </div>
            <LanguageSwitcher tone="dark" />
          </div>

          {/* explore */}
          <nav aria-label={t.footer.explore}>
            <h2 className="mb-3.5 font-display text-[14.5px] font-bold text-sand-50">
              {t.footer.explore}
            </h2>
            <ul className="flex flex-col gap-2.5">
              {[
                { href: "/listings", label: t.footer.allListings },
                { href: "/listings?amenities=pool", label: t.footer.poolListings },
                { href: "/listings?category=wedding", label: t.footer.weddingVenues },
                { href: "/listings?category=camp", label: t.footer.winterCamps },
                { href: "/favorites", label: t.nav.favorites },
              ].map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-[13.5px] text-sand-100/60 no-underline hover:text-gold-300 hover:no-underline"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* help */}
          <nav aria-label={t.footer.help}>
            <h2 className="mb-3.5 font-display text-[14.5px] font-bold text-sand-50">
              {t.footer.help}
            </h2>
            <ul className="flex flex-col gap-2.5">
              {[
                { href: "/how-it-works", label: t.nav.howItWorks },
                { href: "/policies", label: t.nav.policies },
                { href: "/faq", label: t.nav.faq },
                { href: "/about", label: t.nav.about },
              ].map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-[13.5px] text-sand-100/60 no-underline hover:text-gold-300 hover:no-underline"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* contact — the WhatsApp number and address that used to sit under
              the removed map, kept here so no contact route was lost with it */}
          <div>
            <h2 className="mb-3.5 font-display text-[14.5px] font-bold text-sand-50">
              {t.footer.contact}
            </h2>

            {waHref && (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-2.5 flex items-center gap-2 text-[13.5px] text-gold-300 no-underline hover:text-sand-100 hover:no-underline"
              >
                <Icon name="chat" size={17} />
                <span dir="ltr">{settings.whatsappNumber}</span>
              </a>
            )}

            {settings.email && (
              <a
                href={`mailto:${settings.email}`}
                className="mb-2.5 flex items-center gap-2 text-[13.5px] text-sand-100/60 no-underline hover:text-gold-300 hover:no-underline"
              >
                <Icon name="alternate_email" size={17} />
                <span dir="ltr">{settings.email}</span>
              </a>
            )}

            {s.addressLine && (
              <p className="m-0 mb-4 flex items-start gap-2 text-[12.5px] text-sand-100/55">
                <Icon name="location_on" size={16} className="mt-0.5 shrink-0" />
                {s.addressLine}
              </p>
            )}

            {/* The one place in the public footer that addresses owners rather
                than customers — everything else here speaks to the guest who is
                looking for a rest house. */}
            <Link
              href="/register/owner"
              className="inline-flex items-center gap-2 rounded-full border border-gold-500/30 px-3.5 py-2 text-[12.5px] font-bold text-gold-300 no-underline transition hover:bg-gold-500/15 hover:no-underline"
            >
              <Icon name="add_home_work" size={16} />
              {t.footer.listYourPropertyCta}
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gold-500/20 py-4.5">
          <span className="text-[12.5px] text-sand-100/45">
            {t.footer.rights(year, s.siteName)}
          </span>
          <span className="flex gap-4.5">
            <Link
              href="/policies"
              className="text-[12.5px] text-sand-100/45 no-underline hover:text-gold-300 hover:no-underline"
            >
              {t.nav.terms}
            </Link>
            <Link
              href="/privacy"
              className="text-[12.5px] text-sand-100/45 no-underline hover:text-gold-300 hover:no-underline"
            >
              {t.nav.privacy}
            </Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
