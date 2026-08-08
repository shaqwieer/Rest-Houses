import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteFooter } from "@/components/site/footer";
import { LocaleProvider } from "@/lib/i18n/provider";
import type { Settings } from "@/lib/settings";

/**
 * Requirement 7: the "موقعنا / Our Location" block and its Google Maps embed
 * are gone.
 *
 * ─── Why this renders to a string rather than using a DOM ────────────────────
 * The question is "does this markup contain a map iframe?", which a string
 * answers exactly. `renderToStaticMarkup` runs the real component — the same
 * code the site ships — with no jsdom, no testing-library and no mock of the
 * thing under test.
 *
 * The "no related request" half of the requirement is checked the same way: the
 * removed map was an `<iframe src="google.com/maps?...&output=embed">` with no
 * JavaScript module behind it, so its network request existed if and only if
 * that tag was in the markup. No iframe, no request.
 */

// next/navigation is only needed by the language switcher inside the footer.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/actions/locale", () => ({ setLocaleAction: vi.fn() }));

const settings = {
  id: 1,
  siteName: "استراحات الرمال",
  tagline: "استراحات وشاليهات الإمارات",
  logoUrl: null,
  logoGlyph: "و",
  whatsappNumber: "+971500000000",
  phone: "+971500000000",
  email: "hello@example.ae",
  instagram: "",
  tiktok: "",
  snapchat: "",
  youtube: "",
  // Blank by default so the base fixture exercises the "not configured" path;
  // the trade-licence tests below clone this row and fill the one field in.
  bankName: "",
  bankAccountHolder: "",
  bankAccountNumber: "",
  bankIban: "",
  tradeLicense: "",
  mapLat: 24.7614,
  mapLng: 55.334,
  mapZoom: 10,
  addressLine: "دبي — الإمارات العربية المتحدة",
  colorAccent: "#C9A44C",
  colorAccentDeep: "#A8873A",
  colorNight: "#0C1522",
  colorSand: "#FBF7F0",
  serviceFeePercent: 5,
  depositPercent: 30,
  commissionPercent: 5,
  reviewInviteDays: 15,
  freeCancelHours: 48,
  checkInTime: "٤ عصرًا",
  checkOutTime: "١٢ ظهرًا",
  depositPaymentsEnabled: false,
  seoTitle: "",
  seoDescription: "",
  ogImageUrl: null,
  heroTitle: "استراحتك في قلب الصحراء",
  heroTitleAlt: "تبدأ بحجز واحد",
  heroSubtitle: "",
  heroImageUrl: null,
  footerAbout: "منصّة إماراتية لحجز الاستراحات",
  siteNameEn: "Sands Rest Houses",
  taglineEn: "",
  addressLineEn: "Dubai — United Arab Emirates",
  checkInTimeEn: "",
  checkOutTimeEn: "",
  checkInHour: null,
  checkOutHour: null,
  seoTitleEn: "",
  seoDescriptionEn: "",
  heroTitleEn: "",
  heroTitleAltEn: "",
  heroSubtitleEn: "",
  footerAboutEn: "",
  updatedAt: new Date(),
} satisfies Settings;

function renderFooter(locale: "ar" | "en", overrides: Partial<Settings> = {}) {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <SiteFooter settings={{ ...settings, ...overrides }} />
    </LocaleProvider>,
  );
}

describe("the removed location section", () => {
  const markups = { ar: renderFooter("ar"), en: renderFooter("en") };

  for (const [locale, html] of Object.entries(markups)) {
    describe(`in ${locale}`, () => {
      it("renders no iframe at all", () => {
        expect(html).not.toContain("<iframe");
      });

      it("makes no request to Google Maps", () => {
        expect(html).not.toContain("google.com/maps");
        expect(html).not.toContain("output=embed");
        expect(html).not.toContain("maps.googleapis.com");
      });

      it("no longer renders the location heading", () => {
        expect(html).not.toContain("موقعنا");
        expect(html).not.toContain("Our Location");
      });

      it("does not link out to Google Maps directions", () => {
        expect(html).not.toContain("maps/search");
        expect(html).not.toContain("الاتجاهات على خرائط جوجل");
      });

      /**
       * The contact affordances that used to live inside the removed column
       * were relocated, not deleted. Losing a visitor's route to the owner
       * would be a regression dressed up as a requirement.
       */
      it("still exposes the WhatsApp number and the address", () => {
        expect(html).toContain("wa.me/971500000000");
        expect(html).toContain("+971500000000");
      });

      it("still renders the rest of the footer", () => {
        expect(html).toContain("/listings");
        expect(html).toContain("/privacy");
        expect(html).toContain("/policies");
      });

      it("offers the owner registration route", () => {
        expect(html).toContain("/register/owner");
      });
    });
  }

  it("renders the localised address in each language", () => {
    expect(markups.ar).toContain("دبي — الإمارات العربية المتحدة");
    expect(markups.en).toContain("Dubai — United Arab Emirates");
  });

  it("falls back to the Arabic value when the English one is blank", () => {
    // `footerAboutEn` is "" above, so English must show the Arabic blurb rather
    // than an empty paragraph.
    expect(markups.en).toContain("منصّة إماراتية لحجز الاستراحات");
  });
});

/**
 * Requirement 5: the footer publishes the commercial trade licence number, and
 * the operator fills it in from /admin/settings.
 *
 * The interesting case is the blank one. A legal disclosure rendered as
 * "Trade licence no." with nothing after it looks like a broken page on exactly
 * the block a visitor might be checking for legitimacy, so an unset value has
 * to remove the whole line rather than leave a dangling label.
 */
describe("the trade licence number", () => {
  it("is absent entirely when it has not been set", () => {
    const html = renderFooter("ar");
    expect(html).not.toContain("رقم الرخصة التجارية");
    expect(renderFooter("en")).not.toContain("Trade licence");
  });

  it("renders the configured number in each language", () => {
    const ar = renderFooter("ar", { tradeLicense: "CN-1234567" });
    expect(ar).toContain("رقم الرخصة التجارية");
    expect(ar).toContain("CN-1234567");

    const en = renderFooter("en", { tradeLicense: "CN-1234567" });
    expect(en).toContain("Trade licence");
    expect(en).toContain("CN-1234567");
  });

  /**
   * The number is a Latin reference code sitting inside an RTL line. Without an
   * explicit `dir="ltr"` the digits and the hyphen reorder on screen, which for
   * a licence number is not cosmetic — it prints a different number.
   */
  it("renders the number left-to-right inside the Arabic footer", () => {
    const html = renderFooter("ar", { tradeLicense: "CN-1234567" });
    expect(html).toMatch(/dir="ltr"[^>]*>CN-1234567/);
  });

  it("sits in the bottom bar, right after the copyright line", () => {
    const html = renderFooter("en", { tradeLicense: "CN-1234567" });
    const rights = html.indexOf("All rights reserved");
    const licence = html.indexOf("CN-1234567");
    // `lastIndexOf`, because /policies also appears far earlier as the "Terms"
    // entry in the help column — the bottom bar's copy is the last one.
    const bottomBarTerms = html.lastIndexOf("/policies");

    expect(rights).toBeGreaterThan(-1);
    expect(licence).toBeGreaterThan(rights);
    expect(licence).toBeLessThan(bottomBarTerms);
  });
});
