import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ListingCard, type ListingCardData } from "@/components/listing/listing-card";
import { FavoritesProvider } from "@/components/site/favorites-provider";
import { LocaleProvider } from "@/lib/i18n/provider";
import { ar } from "@/lib/i18n/ar";
import { en } from "@/lib/i18n/en";
import { arNum } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";

/**
 * The bedroom count beside the guest count on a listing card.
 *
 * Two things matter: the Arabic reads the way a person says it (one and two
 * have their own words, 3–10 take the plural, 11+ the singular), and a listing
 * whose owner never filled the number in — every listing that predates the
 * column — shows no bedroom line at all rather than «٠ غرفة نوم».
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const base: ListingCardData = {
  id: "l1",
  slug: "مزرعة-الريف",
  name: "مزرعة الريف الاخضر",
  city: "rak",
  area: "قرب خت والمطار",
  nameEn: null,
  areaEn: null,
  pricePerNight: 1615,
  weekendPrice: 0,
  holidayPrice: 0,
  capacity: 40,
  bedrooms: 0,
  rating: 5,
  reviewsCount: 1,
  verified: false,
  coverUrl: "/x.jpg",
  amenityIds: [],
};

function card(bedrooms: number, locale: Locale = "ar") {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <FavoritesProvider>
        <ListingCard listing={{ ...base, bedrooms }} />
      </FavoritesProvider>
    </LocaleProvider>,
  );
}

describe("bedroom wording", () => {
  const say = (n: number) => ar.common.bedrooms(arNum(n, "ar"), n);

  it("says one and two in words, as Arabic does", () => {
    expect(say(1)).toBe("غرفة نوم واحدة");
    expect(say(2)).toBe("غرفتا نوم");
  });

  it("takes the plural for 3–10 and the singular from 11", () => {
    expect(say(4)).toBe("٤ غرف نوم");
    expect(say(10)).toBe("١٠ غرف نوم");
    expect(say(11)).toBe("١١ غرفة نوم");
  });

  it("has an English form", () => {
    expect(en.common.bedrooms("1", 1)).toBe("1 bedroom");
    expect(en.common.bedrooms("4", 4)).toBe("4 bedrooms");
  });
});

describe("listing card", () => {
  it("shows the bedroom count beside the guests when the owner has set it", () => {
    const html = card(4);
    expect(html).toContain("٤ غرف نوم");
    expect(html).toContain("حتى ٤٠ ضيفًا");
  });

  it("shows nothing for a listing that has not stated it", () => {
    const html = card(0);
    expect(html).not.toContain("غرف");
    expect(html).not.toContain("غرفة");
  });

  it("speaks English on the English site", () => {
    expect(card(3, "en")).toContain("3 bedrooms");
  });
});
