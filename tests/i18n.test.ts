import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  getDirection,
  htmlLang,
  normalizeLocale,
  otherLocale,
} from "@/lib/i18n/config";
import { ar } from "@/lib/i18n/ar";
import { en } from "@/lib/i18n/en";
import { getDictionary } from "@/lib/i18n";
import { arNum, arPercent } from "@/lib/format";
import { arDayMonth, arFullDate, formatDateTime } from "@/lib/dates";
import { CITIES, cityLabel, amenityLabel, normalizeCityId } from "@/lib/constants";

describe("locale defaults", () => {
  it("defaults to Arabic", () => {
    expect(DEFAULT_LOCALE).toBe("ar");
  });

  it("falls back to Arabic for a missing, unknown or tampered cookie", () => {
    expect(normalizeLocale(undefined)).toBe("ar");
    expect(normalizeLocale("")).toBe("ar");
    expect(normalizeLocale("fr")).toBe("ar");
    expect(normalizeLocale("../../etc/passwd")).toBe("ar");
    expect(normalizeLocale(42)).toBe("ar");
  });

  it("accepts the two supported locales", () => {
    expect(normalizeLocale("ar")).toBe("ar");
    expect(normalizeLocale("en")).toBe("en");
    expect(LOCALES).toEqual(["ar", "en"]);
  });
});

describe("text direction", () => {
  it("is RTL for Arabic and LTR for English", () => {
    expect(getDirection("ar")).toBe("rtl");
    expect(getDirection("en")).toBe("ltr");
  });

  it("sets the matching html lang", () => {
    expect(htmlLang("ar")).toBe("ar");
    expect(htmlLang("en")).toBe("en");
  });

  it("switches to the other locale", () => {
    expect(otherLocale("ar")).toBe("en");
    expect(otherLocale("en")).toBe("ar");
  });
});

/**
 * Key parity is already a compile error — `en` is typed as `typeof ar`. This
 * checks it at runtime as well, which catches the one way the type layer can be
 * bypassed: a cast. It also verifies the *shapes* match, so a key that is a
 * string in one language and a function in the other is caught rather than
 * blowing up at render time with "t.foo is not a function".
 */
describe("dictionary parity", () => {
  type Node = Record<string, unknown>;

  function walk(a: Node, b: Node, path: string[] = []): string[] {
    const problems: string[] = [];
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);

    for (const key of keys) {
      const here = [...path, key].join(".");
      const av = a[key];
      const bv = b[key];

      if (!(key in a)) {
        problems.push(`only in en: ${here}`);
        continue;
      }
      if (!(key in b)) {
        problems.push(`only in ar: ${here}`);
        continue;
      }

      const at = typeof av;
      const bt = typeof bv;
      if (at !== bt) {
        problems.push(`type mismatch at ${here}: ar=${at} en=${bt}`);
        continue;
      }
      if (at === "object" && av && bv) {
        problems.push(...walk(av as Node, bv as Node, [...path, key]));
      }
      if (at === "function") {
        const aa = (av as (...args: unknown[]) => unknown).length;
        const ba = (bv as (...args: unknown[]) => unknown).length;
        if (aa !== ba) problems.push(`arity mismatch at ${here}: ar=${aa} en=${ba}`);
      }
      if (at === "string" && (av as string).trim() === "") {
        problems.push(`empty string at ${here}`);
      }
    }
    return problems;
  }

  it("has identical keys, shapes and arities in both languages", () => {
    expect(walk(ar as unknown as Node, en as unknown as Node)).toEqual([]);
  });

  it("resolves a dictionary for each locale, defaulting to Arabic", () => {
    expect(getDictionary("ar")).toBe(ar);
    expect(getDictionary("en")).toBe(en);
    expect(getDictionary("nonsense")).toBe(ar);
    expect(getDictionary(undefined)).toBe(ar);
  });
});

describe("locale-aware formatting", () => {
  it("renders Arabic-Indic digits for Arabic and Latin for English", () => {
    expect(arNum(1800, "ar")).toBe("١٬٨٠٠");
    expect(arNum(1800, "en")).toBe("1,800");
  });

  it("keeps the Arabic default when no locale is passed", () => {
    // Every pre-existing call site relies on this.
    expect(arNum(60)).toBe("٦٠");
  });

  it("uses the right percent sign per language", () => {
    expect(arPercent(30, "ar")).toBe("٣٠٪");
    expect(arPercent(30, "en")).toBe("30%");
  });

  it("formats dates in each language", () => {
    expect(arDayMonth("2026-07-28", "ar")).toBe("٢٨ يوليو");
    expect(arDayMonth("2026-07-28", "en")).toBe("28 July");
    expect(arFullDate("2026-07-28", "en")).toBe("28 July 2026");
  });

  it("translates domain vocabulary", () => {
    expect(cityLabel("dubai", "ar")).toBe("دبي");
    expect(cityLabel("dubai", "en")).toBe("Dubai");
    expect(amenityLabel("pool", "en")).toBe("Private pool");
  });

  it("degrades an unknown id rather than throwing", () => {
    expect(cityLabel("atlantis", "en")).toBe("—");
    expect(amenityLabel("teleporter", "en")).toBe("teleporter");
  });
});

describe("pluralisation", () => {
  it("uses the singular for one in English", () => {
    // The bug this exists to prevent: "1 results", "1 rest houses".
    expect(en.common.results("1", 1)).toBe("1 result");
    expect(en.common.results("2", 2)).toBe("2 results");
    expect(en.common.results("0", 0)).toBe("0 results");

    expect(en.home.categoryCount("1", 1)).toBe("1 rest house");
    expect(en.home.categoryCount("6", 6)).toBe("6 rest houses");

    expect(en.common.upToGuests("1", 1)).toBe("Up to 1 guest");
    expect(en.common.upToGuests("60", 60)).toBe("Up to 60 guests");

    expect(en.listing.nightsLine("1,800", "1", 1)).toBe("1,800 AED × 1 night");
    expect(en.listing.nightsLine("1,800", "3", 3)).toBe("1,800 AED × 3 nights");
  });

  it("uses Arabic's singular, dual and 3–10 forms", () => {
    // Arabic distinguishes more than two forms; treating it as English would
    // render "١ نتائج" and "٢ نتيجة".
    expect(ar.common.results("١", 1)).toContain("نتيجة");
    expect(ar.common.results("٢", 2)).toContain("نتيجتان");
    expect(ar.common.results("٣", 3)).toContain("نتائج");
    expect(ar.common.results("١١", 11)).toContain("نتيجة");

    expect(ar.listing.nightsLine("١٬٨٠٠", "٢", 2)).toContain("ليلتان");
    expect(ar.listing.nightsLine("١٬٨٠٠", "٥", 5)).toContain("ليالٍ");
  });
});

describe("formatDateTime", () => {
  it("keeps the clock in one digit system and zero-padded", () => {
    const at0905 = new Date(Date.UTC(2026, 6, 28, 9, 5));
    expect(formatDateTime(at0905, "en")).toContain("09:05");
    // Previously rendered "٩:05" — Arabic hour, Latin minutes, padding lost.
    expect(formatDateTime(at0905, "ar")).toContain("٠٩:٠٥");
    expect(formatDateTime(at0905, "ar")).not.toContain("05");
  });

  it("renders an em-dash for a missing date rather than throwing", () => {
    expect(formatDateTime(null)).toBe("—");
  });
});

describe("the emirates city list", () => {
  it("is the seven emirates, in order", () => {
    expect(CITIES.map((c) => c.id)).toEqual([
      "abudhabi",
      "dubai",
      "sharjah",
      "rak",
      "ajman",
      "uaq",
      "fujairah",
    ]);
  });

  it("labels every one in both languages", () => {
    for (const c of CITIES) {
      expect(cityLabel(c.id, "ar").length).toBeGreaterThan(1);
      expect(cityLabel(c.id, "en").length).toBeGreaterThan(1);
      expect(cityLabel(c.id, "ar")).not.toBe("—");
      expect(cityLabel(c.id, "en")).not.toBe("—");
    }
    expect(cityLabel("rak", "ar")).toBe("رأس الخيمة");
    expect(cityLabel("rak", "en")).toBe("Ras Al Khaimah");
    expect(cityLabel("uaq", "ar")).toBe("أم القيوين");
    expect(cityLabel("uaq", "en")).toBe("Umm Al Quwain");
  });

  it("no longer lists regions that sit inside an emirate", () => {
    // "العين" and "الظفرة وليوا" are parts of Abu Dhabi. Having them alongside
    // "أبوظبي" made the filter lossy — picking the emirate hid them.
    const ids = CITIES.map((c) => c.id);
    expect(ids).not.toContain("alain");
    expect(ids).not.toContain("liwa");
  });

  it("still resolves a bookmarked link to a retired id", () => {
    expect(normalizeCityId("alain")).toBe("abudhabi");
    expect(normalizeCityId("liwa")).toBe("abudhabi");
  });

  it("passes current and unknown ids through untouched", () => {
    expect(normalizeCityId("dubai")).toBe("dubai");
    expect(normalizeCityId("rak")).toBe("rak");
    // Garbage must not be coerced into a real emirate.
    expect(normalizeCityId("atlantis")).toBe("atlantis");
    expect(normalizeCityId(undefined)).toBeUndefined();
  });
});
