import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { HeroSearch } from "@/components/site/hero-search";
import { ListingCard } from "@/components/listing/listing-card";
import { toCardData } from "@/components/listing/card-data";
import { Icon, type IconName } from "@/components/ui/icon";
import { ButtonLink } from "@/components/ui/button";
import { getPublicListingStats, getRandomListings } from "@/lib/listings";
import { getPopularSearches } from "@/lib/popular-searches";
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
 * ─── The first screen is for the search people arrived with ──────────────────
 * Almost all paid traffic is a phone, from searches like «شاليهات للايجار» and
 * «مزارع للايجار». So the first screen says plainly what is here (the heading
 * is the operator's `heroTitle`, set to exactly that), puts a search that
 * starts unrestricted directly under it, then one tap per popular search, and
 * then real rest houses — photo, place, guests, price — before anything else.
 * The occasion tiles and the reasons to book come after the listings, not
 * before them.
 *
 * ─── No testimonials ─────────────────────────────────────────────────────────
 * The three quotes that used to sit here were sample copy: named guests "since
 * 2023" and "since 2024" on a platform that went live in July 2026, with no
 * review behind any of them. They are gone, not rewritten. Real reviews live on
 * each listing's page, where they belong to a stay that happened.
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
  const { t, locale } = await getI18n();
  const [settings, featured, stats, popular] = await Promise.all([
    getSettings(),
    getRandomListings(4),
    // Routed through the shared public predicate, so an inactive or expired
    // owner's listings are absent from these counts exactly as they are from
    // the grid. The three inline `prisma.listing` queries this replaced each
    // built their own `{ published: true }` and would have kept counting them.
    getPublicListingStats(),
    // The popular searches that currently lead somewhere — a link with no
    // live listing behind it is not rendered at all.
    getPopularSearches(locale),
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

        <div className="relative mx-auto max-w-[1280px] px-4 pt-6 pb-4 md:px-10 md:pt-20 md:pb-10">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-gold-500/40 bg-night-900/50 px-3.5 py-1 text-[12px] font-semibold text-gold-300 md:mb-5 md:px-4 md:py-1.5 md:text-[12.5px]">
            <span
              className="animate-soft-pulse size-1.5 rounded-full bg-gold-500"
              aria-hidden
            />
            {t.home.inventoryBadge(arNum(stats.total, locale), arNum(stats.cities, locale))}
          </div>

          {/* The operator's heading, from /admin/settings. The second line is
              optional — the search-intent heading is one sentence — and an
              empty one renders nothing, not a blank gold line. */}
          <h1 className="m-0 mb-2.5 max-w-[22ch] font-display text-[clamp(26px,5vw,54px)] font-extrabold leading-[1.3] text-sand-50 md:mb-4">
            {s.heroTitle}
            {s.heroTitleAlt && (
              <>
                <br />
                <span className="text-gold-300">{s.heroTitleAlt}</span>
              </>
            )}
          </h1>
          {s.heroSubtitle && (
            <p className="m-0 max-w-[52ch] text-[clamp(14.5px,1.5vw,19px)] leading-[1.75] text-sand-100/80">
              {s.heroSubtitle}
            </p>
          )}
        </div>

        <div className="relative mx-auto max-w-[1280px] px-4 pb-5 md:px-10 md:pb-16">
          <HeroSearch />

          {/* One tap into each search people actually type. Counted against
              live inventory: a search with nothing behind it is not offered.
              One scrolling row on a phone rather than three wrapped ones —
              the listings belong on the first screen, not below the chips. */}
          {popular.length > 0 && (
            <nav
              aria-label={t.home.mostSearched}
              className="-mx-4 mt-3 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:mt-4 md:flex-wrap md:overflow-visible md:px-0"
            >
              <span className="shrink-0 text-[12.5px] font-semibold text-sand-100/70">
                {t.home.mostSearched}
              </span>
              {popular.map((q) => (
                <Link
                  key={q.id}
                  href={q.href}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-gold-500/45 bg-night-900/55 px-3.5 py-2 text-[13px] font-semibold text-sand-50 no-underline transition hover:bg-gold-500/20 hover:no-underline"
                >
                  {q.label}
                  <span className="rounded-full bg-gold-500/25 px-1.5 text-[11.5px] font-bold text-gold-300">
                    {arNum(q.count, locale)}
                  </span>
                </Link>
              ))}
            </nav>
          )}
        </div>
      </section>

      {/* ================= LISTINGS ================= */}
      {/* Straight after the search: real rest houses — photo, place, guests
          and price — are what a visitor from an ad is looking for, so they
          start on the first screen of a phone. A swipeable row there (one card
          and the edge of the next, which is what says "swipe"), the grid from
          `sm` up. */}
      {featured.length > 0 && (
        <section className="mx-auto max-w-[1280px] px-4 pt-6 md:px-10 md:pt-14">
          <div className="mb-3.5 flex items-end justify-between gap-3 md:mb-5.5">
            <div className="min-w-0">
              <div className="mb-1 inline-flex items-center gap-2 text-[12px] font-bold tracking-wide text-bronze md:mb-2 md:text-[12.5px]">
                <span className="h-px w-5.5 bg-gold-500" aria-hidden />
                {t.home.featuredEyebrow}
              </div>
              <h2 className="m-0 font-display text-[clamp(19px,2.6vw,30px)] font-extrabold text-ink">
                {t.home.featuredTitle}
              </h2>
            </div>
            <ButtonLink href="/listings" variant="secondary" size="sm" className="shrink-0">
              {t.home.browseAll(arNum(stats.total, locale))}
              {/* The arrow points forward along the reading direction, so it
                  flips with the document rather than always pointing left. */}
              <Icon name={locale === "ar" ? "arrow_back" : "arrow_forward"} size={18} />
            </ButtonLink>
          </div>

          <div className="-mx-4 flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4">
            {featured.map((listing, i) => (
              <div key={listing.id} className="grid w-[80%] shrink-0 snap-start sm:w-auto">
                <ListingCard
                  listing={toCardData(listing)}
                  showVerifiedBadge
                  // The first two are on screen at load, on a phone and a laptop.
                  priority={i < 2}
                />
              </div>
            ))}
          </div>
        </section>
      )}

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

      {/* ================= CTA ================= */}
      {/* Top padding of its own: the section above ends on a full-bleed dark
          band, and without it this dark card sits flush against that band. */}
      <section className="mx-auto max-w-[1280px] px-4 pt-11 pb-12 md:px-10 md:pt-20 md:pb-20">
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
