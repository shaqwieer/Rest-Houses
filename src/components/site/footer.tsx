import Link from "next/link";
import { Brand } from "./brand";
import { Icon, type IconName } from "@/components/ui/icon";
import type { Settings } from "@/lib/settings";
import { whatsappLink } from "@/lib/whatsapp";
import { arNum } from "@/lib/format";

/**
 * Site footer: about + explore links + help links + Google Maps embed.
 *
 * The map here is a Google Maps embed (the client asked for Google Maps) built
 * from the lat/lng pair in settings — no API key needed for the `/maps?q=` embed
 * form. The interactive per-listing map uses Leaflet instead; see
 * components/listing/listing-map.tsx for why the two differ.
 */

function socialLinks(settings: Settings): { href: string; icon: IconName; label: string }[] {
  const out: { href: string; icon: IconName; label: string }[] = [];
  if (settings.instagram) out.push({ href: settings.instagram, icon: "photo_camera", label: "إنستغرام" });
  out.push({ href: whatsappLink(settings.whatsappNumber), icon: "chat", label: "واتساب" });
  if (settings.email) out.push({ href: `mailto:${settings.email}`, icon: "alternate_email", label: "البريد" });
  if (settings.youtube) out.push({ href: settings.youtube, icon: "play_circle", label: "يوتيوب" });
  if (settings.tiktok) out.push({ href: settings.tiktok, icon: "play_circle", label: "تيك توك" });
  return out;
}

export function SiteFooter({ settings }: { settings: Settings }) {
  const socials = socialLinks(settings);
  const year = arNum(new Date().getFullYear());

  // `q=lat,lng` + `output=embed` is the keyless Google Maps embed. `z` is zoom.
  const mapSrc = `https://www.google.com/maps?q=${settings.mapLat},${settings.mapLng}&z=${settings.mapZoom}&hl=ar&output=embed`;
  const mapDirections = `https://www.google.com/maps/search/?api=1&query=${settings.mapLat},${settings.mapLng}`;

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
              {settings.footerAbout}
            </p>
            <div className="flex gap-2.5">
              {socials.map((s) => (
                <a
                  key={s.label + s.href}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className="grid size-9.5 place-items-center rounded-xl border border-gold-500/30 text-gold-300 no-underline transition hover:bg-gold-500/15 hover:no-underline"
                >
                  <Icon name={s.icon} size={19} />
                </a>
              ))}
            </div>
          </div>

          {/* explore */}
          <nav aria-label="استكشف">
            <h2 className="mb-3.5 font-display text-[14.5px] font-bold text-sand-50">استكشف</h2>
            <ul className="flex flex-col gap-2.5">
              {[
                { href: "/listings", label: "كل الاستراحات" },
                { href: "/listings?amenities=pool", label: "استراحات بمسبح" },
                { href: "/listings?category=wedding", label: "قاعات أعراس" },
                { href: "/listings?category=camp", label: "مخيمات شتوية" },
                { href: "/favorites", label: "المفضلة" },
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
          <nav aria-label="المساعدة">
            <h2 className="mb-3.5 font-display text-[14.5px] font-bold text-sand-50">المساعدة</h2>
            <ul className="flex flex-col gap-2.5">
              {[
                { href: "/how-it-works", label: "كيف أحجز؟" },
                { href: "/policies", label: "سياسة الإلغاء" },
                { href: "/faq", label: "الأسئلة الشائعة" },
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
              <li>
                <Link
                  href="/admin"
                  className="flex items-center gap-1.5 text-[13.5px] text-sand-100/60 no-underline hover:text-gold-300 hover:no-underline"
                >
                  <Icon name="lock_open" size={16} />
                  دخول المُلّاك
                </Link>
              </li>
            </ul>
          </nav>

          {/* location */}
          <div>
            <h2 className="mb-3.5 font-display text-[14.5px] font-bold text-sand-50">موقعنا</h2>
            <div className="mb-3 h-33 overflow-hidden rounded-2xl border border-gold-500/30 bg-night-800">
              <iframe
                src={mapSrc}
                title="خريطة الموقع"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="size-full border-0 [filter:saturate(0.75)_contrast(1.05)]"
              />
            </div>
            {settings.addressLine && (
              <p className="mb-2 text-[12.5px] text-sand-100/55">{settings.addressLine}</p>
            )}
            <a
              href={mapDirections}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-2 flex items-center gap-2 text-[13px] text-gold-300 no-underline hover:text-sand-100 hover:no-underline"
            >
              <Icon name="pin_drop" size={17} />
              الاتجاهات على خرائط جوجل
            </a>
            <a
              href={whatsappLink(settings.whatsappNumber)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-[13.5px] text-gold-300 no-underline hover:text-sand-100 hover:no-underline"
            >
              <Icon name="call" size={17} />
              <span dir="ltr">{settings.whatsappNumber}</span>
            </a>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gold-500/20 py-4.5">
          <span className="text-[12.5px] text-sand-100/45">
            © {year} {settings.siteName} — جميع الحقوق محفوظة
          </span>
          <span className="flex gap-4.5">
            <Link
              href="/policies"
              className="text-[12.5px] text-sand-100/45 no-underline hover:text-gold-300 hover:no-underline"
            >
              الشروط والأحكام
            </Link>
            <Link
              href="/privacy"
              className="text-[12.5px] text-sand-100/45 no-underline hover:text-gold-300 hover:no-underline"
            >
              سياسة الخصوصية
            </Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
