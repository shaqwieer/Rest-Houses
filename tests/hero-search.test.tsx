import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HeroSearch } from "@/components/site/hero-search";
import { LocaleProvider } from "@/lib/i18n/provider";

/**
 * The rendered search bar, not just its defaults constant.
 *
 * tests/search.test.ts proves `EMPTY_HERO_SEARCH` produces an unrestricted
 * URL. This proves the bar a visitor actually sees starts from it: no date in
 * either field and no guest count — the regression being a bar that opens on
 * "30" and two dates, and quietly searches with them when nobody touches it.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

function render(locale: "ar" | "en") {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <HeroSearch />
    </LocaleProvider>,
  );
}

describe("HeroSearch", () => {
  it("opens with no dates and any number of guests", () => {
    const html = render("ar");

    const dates = html.match(/<input[^>]*type="date"[^>]*>/g) ?? [];
    expect(dates).toHaveLength(2);
    for (const input of dates) expect(input).toContain('value=""');

    const guests = html.match(/<input[^>]*type="number"[^>]*>/)?.[0] ?? "";
    expect(guests).toContain('value=""');
    expect(guests).toContain('placeholder="أي عدد"');
    expect(html).not.toContain('value="30"');
  });

  it("says «أي تاريخ» over each empty date instead of the browser's mask", () => {
    expect(render("ar").match(/أي تاريخ/g)).toHaveLength(2);
    expect(render("en").match(/Any date/g)).toHaveLength(2);
  });

  it("starts on every emirate", () => {
    expect(render("ar")).toMatch(/<option value="all" selected="">/);
  });
});
