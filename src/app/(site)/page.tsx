import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { HeroSearch } from "@/components/site/hero-search";
import { ListingCard } from "@/components/listing/listing-card";
import { toCardData } from "@/components/listing/card-data";
import { Icon } from "@/components/ui/icon";
import { ButtonLink } from "@/components/ui/button";
import { getFeaturedListings } from "@/lib/listings";
import { getSettings, absoluteUrl } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { CATEGORIES } from "@/lib/constants";
import { arNum } from "@/lib/format";
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
 * The cost is four indexed queries per request (single-digit milliseconds); the
 * static assets, fonts and optimised images are cached exactly as before. Listing
 * detail pages — the ones that carry the SEO traffic — remain statically
 * generated with on-demand revalidation from the admin actions.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: settings.seoTitle || settings.tagline,
    description: settings.seoDescription ?? undefined,
    alternates: { canonical: "/" },
  };
}

/** Guest testimonials. Static copy — not a DB model, since these are marketing
 *  quotes about the platform itself rather than reviews of a listing. */
const TESTIMONIALS = [
  {
    name: "محمد الرميثي",
    role: "زبون منذ ٢٠٢٣",
    quote:
      "أفضل ما في المنصة أن كل استراحة موثّقة فعليًا — الصور مطابقة للواقع تمامًا، وهذا نادر.",
  },
  {
    name: "شيخة المهيري",
    role: "منظّمة مناسبات",
    quote:
      "أنظّم أكثر من عشرين مناسبة سنويًا، والتقويم هنا يوفّر عليّ ساعات من الاتصالات. أرى المتاح فورًا وأرسل الطلب عبر الواتساب.",
  },
  {
    name: "عبدالعزيز السويدي",
    role: "زبون منذ ٢٠٢٤",
    quote:
      "حجزت خلال دقيقتين من الجوال. وصلني تأكيد المالك خلال ربع ساعة مع موقع دقيق على الخريطة.",
  },
] as const;

const TRUST_POINTS = [
  {
    icon: "verified_user" as const,
    title: "زيارة ميدانية لكل استراحة",
    body: "فريقنا يصوّر ويعاين الاستراحة قبل نشرها. لا صور مضلّلة ولا مفاجآت عند الوصول.",
  },
  {
    icon: "event_available" as const,
    title: "تقويم متاح لحظيًا",
    body: "الأيام المحجوزة تظهر باللون الطيني والمتاحة بالأبيض — تعرف الجواب قبل أن تسأل.",
  },
  {
    icon: "receipt_long" as const,
    title: "سعر واحد بلا رسوم مخفية",
    body: "العربون وسياسة الإلغاء مكتوبان بوضوح في صفحة كل استراحة قبل إرسال الطلب.",
  },
  {
    icon: "forum" as const,
    title: "ردّ سريع من المالك",
    body: "طلبك يصل المالك مباشرة على الواتساب مع كل التفاصيل جاهزة — بلا مكالمات متكررة.",
  },
] as const;

export default async function HomePage() {
  const settings = await getSettings();

  // One round-trip for the counts the hero badge and category tiles show, so
  // the numbers are real rather than the prototype's hardcoded "١٦٣".
  const [featured, totalCount, cityCount, perCategory] = await Promise.all([
    getFeaturedListings(4),
    prisma.listing.count({ where: { published: true } }),
    prisma.listing
      .findMany({ where: { published: true }, select: { city: true }, distinct: ["city"] })
      .then((r) => r.length),
    // Categories live in a JSON column, so counting them means reading the
    // column and tallying in memory — see the note in src/lib/listings.ts.
    prisma.listing
      .findMany({ where: { published: true }, select: { categories: true } })
      .then((rows) => {
        const tally = new Map<string, number>();
        for (const row of rows) {
          try {
            for (const id of JSON.parse(row.categories) as string[]) {
              tally.set(id, (tally.get(id) ?? 0) + 1);
            }
          } catch {
            /* malformed row — skip rather than fail the page */
          }
        }
        return tally;
      }),
  ]);

  const heroImage = settings.heroImageUrl || featured[0]?.coverUrl || null;
  const waHref = whatsappLink(settings.whatsappNumber, generalEnquiryMessage(settings.siteName));

  /**
   * Organisation + WebSite structured data. Gives Google the site name, logo and
   * a search action, which is what produces a sitelinks search box.
   */
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: settings.siteName,
        url: absoluteUrl("/"),
        description: settings.footerAbout,
        telephone: settings.whatsappNumber,
        email: settings.email ?? undefined,
        address: { "@type": "PostalAddress", addressCountry: "AE", addressLocality: settings.addressLine ?? undefined },
      },
      {
        "@type": "WebSite",
        name: settings.siteName,
        url: absoluteUrl("/"),
        inLanguage: "ar-AE",
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
        {heroImage && (
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
        )}
        <div
          className="pointer-events-none absolute inset-0 bg-linear-[to_top,rgb(12_21_34/0.94)_6%,rgb(12_21_34/0.55)_46%,rgb(12_21_34/0.72)_100%]"
          aria-hidden
        />
        <div className="bg-sadu pointer-events-none absolute inset-0 opacity-50" aria-hidden />

        <div className="relative mx-auto max-w-[1280px] px-4 pt-14 pb-7 md:px-10 md:pt-24 md:pb-14">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-gold-500/40 bg-night-900/50 px-4 py-1.5 text-[12.5px] font-semibold text-gold-300">
            <span className="animate-soft-pulse size-1.5 rounded-full bg-gold-500" aria-hidden />
            {arNum(totalCount)} استراحة موثّقة في {arNum(cityCount)} إمارات
          </div>

          <h1 className="m-0 mb-4 max-w-[15ch] font-display text-[clamp(30px,5.6vw,60px)] font-extrabold leading-[1.22] text-sand-50">
            {settings.heroTitle}
            <br />
            <span className="text-gold-300">{settings.heroTitleAlt}</span>
          </h1>
          <p className="m-0 max-w-[46ch] text-[clamp(15px,1.5vw,19px)] leading-[1.85] text-sand-100/78">
            {settings.heroSubtitle}
          </p>
        </div>

        <div className="relative mx-auto max-w-[1280px] px-4 pb-10 md:px-10 md:pb-18">
          <HeroSearch />

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] font-semibold text-sand-100/60">الأكثر بحثًا:</span>
            {[
              { label: "استراحة بمسبح", href: "/listings?amenities=pool" },
              { label: "لهباب", href: "/listings?q=لهباب" },
              { label: "قاعة أعراس", href: "/listings?category=wedding" },
              { label: "مخيم شتوي", href: "/listings?category=camp" },
            ].map((t) => (
              <Link
                key={t.label}
                href={t.href}
                className="rounded-full border border-gold-500/30 px-3 py-1.5 text-[12.5px] font-medium text-sand-100 no-underline transition hover:bg-gold-500/15 hover:no-underline"
              >
                {t.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ================= CATEGORIES ================= */}
      <section className="mx-auto max-w-[1280px] px-4 pt-10 md:px-10 md:pt-18">
        <div className="mb-5.5">
          <h2 className="m-0 mb-1.5 font-display text-[clamp(21px,2.6vw,30px)] font-extrabold text-ink">
            تصفّح حسب المناسبة
          </h2>
          <p className="m-0 text-[14.5px] text-muted">لكل مناسبة استراحة تناسبها</p>
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
                  {cat.ar}
                </span>
                <span className="block text-[12.5px] text-muted">
                  {arNum(perCategory.get(cat.id) ?? 0)} استراحة
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
                مختارة بعناية
              </div>
              <h2 className="m-0 font-display text-[clamp(21px,2.6vw,30px)] font-extrabold text-ink">
                استراحات مميّزة هذا الأسبوع
              </h2>
            </div>
            <ButtonLink href="/listings" variant="secondary">
              عرض الكل
              <Icon name="arrow_back" size={18} />
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

      {/* ================= WHY US ================= */}
      <section className="relative mt-12 overflow-hidden bg-night-900 md:mt-22">
        <div className="bg-sadu pointer-events-none absolute inset-0 opacity-65" aria-hidden />
        <div className="relative mx-auto max-w-[1280px] px-4 py-11 md:px-10 md:py-20">
          <h2 className="m-0 mb-2.5 font-display text-[clamp(21px,2.6vw,30px)] font-extrabold text-sand-50">
            لماذا يختاروننا
          </h2>
          <p className="m-0 mb-8 max-w-[52ch] text-[15px] text-sand-100/62">
            لأن الثقة تُبنى قبل الوصول — نتحقق من كل استراحة على الطبيعة، ونعرض ما ستراه تمامًا.
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_POINTS.map((p) => (
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
          ماذا يقول ضيوفنا
        </h2>
        <div className="grid gap-4.5 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <figure
              key={t.name}
              className="m-0 flex flex-col gap-4 rounded-[20px] border border-line bg-surface p-6 shadow-e1"
            >
              <span
                className="font-display text-[40px] leading-[0.7] text-gold-300"
                aria-hidden
              >
                ”
              </span>
              <blockquote className="m-0 text-[15px] leading-[1.9] text-ink">{t.quote}</blockquote>
              <figcaption className="mt-auto flex items-center gap-3 border-t border-line pt-3.5">
                <span className="grid size-10 place-items-center rounded-full bg-sand-200 text-bronze">
                  <Icon name="person" size={22} />
                </span>
                <span>
                  <span className="block text-[14px] font-bold text-ink">{t.name}</span>
                  <span className="block text-[12.5px] text-muted">{t.role}</span>
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
              لم تجد ما يناسبك؟ راسلنا مباشرة
            </h2>
            <p className="m-0 text-[14.5px] leading-[1.85] text-sand-100/72">
              أخبرنا بالتاريخ وعدد الضيوف والميزانية، ونرشّح لك ثلاث استراحات متاحة خلال دقائق.
            </p>
          </div>
          <div className="relative flex flex-wrap gap-2.5">
            <ButtonLink href={waHref} variant="whatsapp" size="lg">
              <Icon name="chat" size={21} />
              تواصل عبر الواتساب
            </ButtonLink>
            <ButtonLink
              href="/listings"
              variant="ghost"
              size="lg"
              className="border border-gold-500/40 text-sand-100 hover:bg-gold-500/15"
            >
              تصفّح الاستراحات
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
