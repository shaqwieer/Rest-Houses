import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { HeroSearch } from "@/components/site/hero-search";
import { ListingCard } from "@/components/listing/listing-card";
import { toCardData } from "@/components/listing/card-data";
import { Icon, type IconName } from "@/components/ui/icon";
import { ButtonLink } from "@/components/ui/button";
import { getFeaturedListings, getPublicListingStats } from "@/lib/listings";
import { getSettings, absoluteUrl, localizeSettings } from "@/lib/settings";
import { CATEGORIES, DEFAULT_PHOTO_URL, label } from "@/lib/constants";
import { arNum } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import { htmlLang } from "@/lib/i18n/config";
import { generalEnquiryMessage, whatsappLink } from "@/lib/whatsapp";

/**
 * Rendered per request rather than prerendered at build.
 *
 * The page's whole job is showing current inventory — live listing counts, the
 * featured row, per-category totals — and it is built into a container image
 * that has no database at build time. Prerendering it would therefore bake in
 * zeros and an empty featured row, and with ISR the first visitors after every
 * deploy would see that stale-empty version until it revalidated.
 *
 * ─── Copy ────────────────────────────────────────────────────────────────────
 * Every section addresses the **customer** looking to book. The trust section
 * was written from the platform's side ("we verify every rest house") in a
 * register that read as a pitch to owners; it now says what that verification
 * means for the person about to spend money. The closing call to action is kept
 * — "haven't found the right one? message us" genuinely serves a guest — and
 * rewritten to name what they get back.
 *
 * The only owner-facing surfaces reachable from here are the footer's "list your
 * property" link and the header's owner login, both deliberately secondary.
 *
 * ─── The "Our Location" map has been removed ─────────────────────────────────
 * The Google Maps embed that rendered below this page's closing section lived in
 * the shared footer, and is gone — see the note at the top of
 * components/site/footer.tsx. No home-page-only asset, import or API call
 * survives it: the map was an `<iframe>` with no JS module behind it, so
 * deleting the markup removed the request along with it.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const [{ locale }, settings] = await Promise.all([getI18n(), getSettings()]);
  const s = localizeSettings(settings, locale);
  return {
    title: s.seoTitle || s.tagline,
    description: s.seoDescription || undefined,
    alternates: { canonical: "/" },
  };
}

export default async function HomePage() {
  const [{ t, locale }, settings, featured, stats] = await Promise.all([
    getI18n(),
    getSettings(),
    getFeaturedListings(4),
    // Routed through the shared public predicate, so an inactive or expired
    // owner's listings are absent from these counts exactly as they are from
    // the grid. The three inline `prisma.listing` queries this replaced each
    // built their own `{ published: true }` and would have kept counting them.
    getPublicListingStats(),
  ]);

  const s = localizeSettings(settings, locale);

  // The banner an operator picked in /admin/settings, or the stand-in.
  //
  // This used to fall back to `featured[0]?.coverUrl` in between — whichever
  // rest house happened to sort first became the front page's banner. That is
  // an arbitrary choice the operator never made, it changes without warning
  // when the featured row is re-ordered, and a square-ish listing photo has to
  // be cropped hard to fill a full-bleed hero. A deliberate wide banner beats a
  // borrowed one; setting a hero image in the dashboard still overrides it.
  const heroImage = settings.heroImageUrl || DEFAULT_PHOTO_URL;
  const waHref = whatsappLink(
    settings.whatsappNumber,
    generalEnquiryMessage(s.siteName, locale),
  );

  const trustPoints: { icon: IconName; title: string; body: string }[] = [
    { icon: "verified_user", title: t.home.why1Title, body: t.home.why1Body },
    { icon: "event_available", title: t.home.why2Title, body: t.home.why2Body },
    { icon: "receipt_long", title: t.home.why3Title, body: t.home.why3Body },
    { icon: "forum", title: t.home.why4Title, body: t.home.why4Body },
  ];

  const testimonials = [
    {
      quote: t.home.testimonial1Quote,
      name: t.home.testimonial1Name,
      role: t.home.testimonial1Role,
    },
    {
      quote: t.home.testimonial2Quote,
      name: t.home.testimonial2Name,
      role: t.home.testimonial2Role,
    },
    {
      quote: t.home.testimonial3Quote,
      name: t.home.testimonial3Name,
      role: t.home.testimonial3Role,
    },
  ];

  const quickSearches = [
    { label: t.home.quickPool, href: "/listings?amenities=pool" },
    { label: t.home.quickLahbab, href: "/listings?q=لهباب" },
    { label: t.home.quickWedding, href: "/listings?category=wedding" },
    { label: t.home.quickCamp, href: "/listings?category=camp" },
  ];

  /**
   * Organisation + WebSite structured data. Gives Google the site name, logo and
   * a search action, which is what produces a sitelinks search box.
   */
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: s.siteName,
        url: absoluteUrl("/"),
        description: s.footerAbout,
        telephone: settings.whatsappNumber,
        email: settings.email ?? undefined,
        address: {
          "@type": "PostalAddress",
          addressCountry: "AE",
          addressLocality: s.addressLine || undefined,
        },
      },
      {
        "@type": "WebSite",
        name: s.siteName,
        url: absoluteUrl("/"),
        inLanguage: `${htmlLang(locale)}-AE`,
        potentialAction: {
          "@type": "SearchAction",
          target: `${absoluteUrl("/listings")}?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        // JSON.stringify output is not HTML — safe here, and this is the
        // documented way to emit structured data in the App Router.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* ================= HERO ================= */}
      <section className="relative overflow-hidden bg-night-900">
        <Image
          src={heroImage}
          alt=""
          fill
          priority
          sizes="100vw"
          // The hero is the LCP element: `priority` preloads it and skips
          // lazy-loading, which is the single biggest win on this page.
          className="object-cover"
        />

        <div
          className="pointer-events-none absolute inset-0 bg-linear-[to_top,rgb(12_21_34/0.94)_6%,rgb(12_21_34/0.55)_46%,rgb(12_21_34/0.72)_100%]"
          aria-hidden
        />
        <div className="bg-sadu pointer-events-none absolute inset-0 opacity-50" aria-hidden />

        <div className="relative mx-auto max-w-[1280px] px-4 pt-14 pb-7 md:px-10 md:pt-24 md:pb-14">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-gold-500/40 bg-night-900/50 px-4 py-1.5 text-[12.5px] font-semibold text-gold-300">
            <span
              className="animate-soft-pulse size-1.5 rounded-full bg-gold-500"
              aria-hidden
            />
            {t.home.verifiedBadge(arNum(stats.total, locale), arNum(stats.cities, locale))}
          </div>

          <h1 className="m-0 mb-4 max-w-[15ch] font-display text-[clamp(30px,5.6vw,60px)] font-extrabold leading-[1.22] text-sand-50">
            {s.heroTitle}
            <br />
            <span className="text-gold-300">{s.heroTitleAlt}</span>
          </h1>
          <p className="m-0 max-w-[46ch] text-[clamp(15px,1.5vw,19px)] leading-[1.85] text-sand-100/78">
            {s.heroSubtitle}
          </p>
        </div>

        <div className="relative mx-auto max-w-[1280px] px-4 pb-10 md:px-10 md:pb-18">
          <HeroSearch />

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] font-semibold text-sand-100/60">
              {t.home.mostSearched}
            </span>
            {quickSearches.map((q) => (
              <Link
                key={q.label}
                href={q.href}
                className="rounded-full border border-gold-500/30 px-3 py-1.5 text-[12.5px] font-medium text-sand-100 no-underline transition hover:bg-gold-500/15 hover:no-underline"
              >
                {q.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ================= CATEGORIES ================= */}
      <section className="mx-auto max-w-[1280px] px-4 pt-10 md:px-10 md:pt-18">
        <div className="mb-5.5">
          <h2 className="m-0 mb-1.5 font-display text-[clamp(21px,2.6vw,30px)] font-extrabold text-ink">
            {t.home.categoriesTitle}
          </h2>
          <p className="m-0 text-[14.5px] text-muted">{t.home.categoriesSubtitle}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {CATEGORIES.map((cat) => (
            <Link
              key={cat.id}
              href={`/listings?category=${cat.id}`}
              className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-surface p-4 text-start no-underline shadow-e1 transition duration-200 hover:-translate-y-[3px] hover:border-gold-500 hover:no-underline hover:shadow-e2"
            >
              <span className="grid size-11 place-items-center rounded-[13px] bg-gold-100">
                <Icon name={cat.icon as never} size={24} className="text-bronze" />
              </span>
              <span>
                <span className="mb-1 block font-display text-[15.5px] font-bold text-ink">
                  {label(cat, locale)}
                </span>
                <span className="block text-[12.5px] text-muted">
                  {t.home.categoryCount(
                    arNum(stats.perCategory.get(cat.id) ?? 0, locale),
                    stats.perCategory.get(cat.id) ?? 0,
                  )}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ================= FEATURED ================= */}
      {featured.length > 0 && (
        <section className="mx-auto max-w-[1280px] px-4 pt-10 md:px-10 md:pt-18">
          <div className="mb-5.5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 text-[12.5px] font-bold tracking-wide text-bronze">
                <span className="h-px w-5.5 bg-gold-500" aria-hidden />
                {t.home.featuredEyebrow}
              </div>
              <h2 className="m-0 font-display text-[clamp(21px,2.6vw,30px)] font-extrabold text-ink">
                {t.home.featuredTitle}
              </h2>
            </div>
            <ButtonLink href="/listings" variant="secondary">
              {t.common.viewAll}
              {/* The arrow points forward along the reading direction, so it
                  flips with the document rather than always pointing left. */}
              <Icon name={locale === "ar" ? "arrow_back" : "arrow_forward"} size={18} />
            </ButtonLink>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((listing, i) => (
              <ListingCard
                key={listing.id}
                listing={toCardData(listing)}
                showVerifiedBadge
                // First two cards are usually in view on a laptop.
                priority={i < 2}
              />
            ))}
          </div>
        </section>
      )}

      {/* ================= WHY BOOK WITH US ================= */}
      <section className="relative mt-12 overflow-hidden bg-night-900 md:mt-22">
        <div className="bg-sadu pointer-events-none absolute inset-0 opacity-65" aria-hidden />
        <div className="relative mx-auto max-w-[1280px] px-4 py-11 md:px-10 md:py-20">
          <h2 className="m-0 mb-2.5 font-display text-[clamp(21px,2.6vw,30px)] font-extrabold text-sand-50">
            {t.home.whyTitle}
          </h2>
          <p className="m-0 mb-8 max-w-[52ch] text-[15px] text-sand-100/62">
            {t.home.whySubtitle}
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {trustPoints.map((p) => (
              <div
                key={p.title}
                className="rounded-[20px] border border-gold-500/22 bg-surface/4 p-5.5"
              >
                <Icon name={p.icon} size={30} className="text-gold-500" />
                <h3 className="mt-3.5 mb-1.5 font-display text-[16.5px] font-bold text-sand-50">
                  {p.title}
                </h3>
                <p className="m-0 text-[13.5px] leading-[1.8] text-sand-100/62">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= TESTIMONIALS ================= */}
      <section className="mx-auto max-w-[1280px] px-4 py-11 md:px-10 md:py-20">
        <h2 className="m-0 mb-6.5 font-display text-[clamp(21px,2.6vw,30px)] font-extrabold text-ink">
          {t.home.testimonialsTitle}
        </h2>
        <div className="grid gap-4.5 md:grid-cols-3">
          {testimonials.map((item) => (
            <figure
              key={item.name}
              className="m-0 flex flex-col gap-4 rounded-[20px] border border-line bg-surface p-6 shadow-e1"
            >
              <span className="font-display text-[40px] leading-[0.7] text-gold-300" aria-hidden>
                ”
              </span>
              <blockquote className="m-0 text-[15px] leading-[1.9] text-ink">
                {item.quote}
              </blockquote>
              <figcaption className="mt-auto flex items-center gap-3 border-t border-line pt-3.5">
                <span className="grid size-10 place-items-center rounded-full bg-sand-200 text-bronze">
                  <Icon name="person" size={22} />
                </span>
                <span>
                  <span className="block text-[14px] font-bold text-ink">{item.name}</span>
                  <span className="block text-[12.5px] text-muted">{item.role}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* ================= CTA ================= */}
      <section className="mx-auto max-w-[1280px] px-4 pb-12 md:px-10 md:pb-20">
        <div className="relative flex flex-wrap items-center justify-between gap-6 overflow-hidden rounded-[28px] bg-linear-[135deg,var(--night-800),var(--night-600)] p-7 md:p-13">
          <div className="bg-sadu pointer-events-none absolute inset-0 opacity-50" aria-hidden />
          <div className="relative max-w-[44ch]">
            <h2 className="m-0 mb-2.5 font-display text-[clamp(20px,2.4vw,28px)] font-extrabold text-sand-50">
              {t.home.ctaTitle}
            </h2>
            <p className="m-0 text-[14.5px] leading-[1.85] text-sand-100/72">{t.home.ctaBody}</p>
          </div>
          <div className="relative flex flex-wrap gap-2.5">
            {waHref && (
              <ButtonLink href={waHref} variant="whatsapp" size="lg">
                <Icon name="chat" size={21} />
                {t.home.ctaWhatsapp}
              </ButtonLink>
            )}
            <ButtonLink
              href="/listings"
              variant="ghost"
              size="lg"
              className="border border-gold-500/40 text-sand-100 hover:bg-gold-500/15"
            >
              {t.common.browse}
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
