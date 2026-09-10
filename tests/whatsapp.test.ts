import { describe, expect, it } from "vitest";
import {
  formatWhatsappDisplay,
  isValidWhatsapp,
  normalizeWhatsapp,
  resolveListingWhatsapp,
  whatsappLink,
  bookingRequestMessage,
} from "@/lib/whatsapp";

describe("normalizeWhatsapp", () => {
  it("handles every shape a UAE mobile is written in", () => {
    const expected = "971502148890";
    expect(normalizeWhatsapp("+971 50 214 8890")).toBe(expected);
    expect(normalizeWhatsapp("+971502148890")).toBe(expected);
    expect(normalizeWhatsapp("00971502148890")).toBe(expected);
    expect(normalizeWhatsapp("971502148890")).toBe(expected);
    expect(normalizeWhatsapp("0502148890")).toBe(expected);
    expect(normalizeWhatsapp("502148890")).toBe(expected);
    expect(normalizeWhatsapp("050-214-8890")).toBe(expected);
    expect(normalizeWhatsapp("(050) 214 8890")).toBe(expected);
  });

  /**
   * An owner typing on an Arabic keyboard produces U+0660–U+0669. Stripping
   * non-ASCII digits first would leave an empty string and a `wa.me/` link with
   * no number in it.
   */
  it("accepts Arabic-Indic digits", () => {
    expect(normalizeWhatsapp("٠٥٠٢١٤٨٨٩٠")).toBe("971502148890");
    expect(normalizeWhatsapp("+٩٧١ ٥٠ ٢١٤ ٨٨٩٠")).toBe("971502148890");
  });

  it("leaves a foreign country code alone rather than forcing +971", () => {
    // Saudi and Omani owners are plausible; rewriting their code would send
    // guests to a completely different person.
    expect(normalizeWhatsapp("+966501234567")).toBe("966501234567");
    expect(normalizeWhatsapp("0096899123456")).toBe("96899123456");
  });

  it("returns an empty string for anything unusable", () => {
    expect(normalizeWhatsapp("")).toBe("");
    expect(normalizeWhatsapp(null)).toBe("");
    expect(normalizeWhatsapp(undefined)).toBe("");
    expect(normalizeWhatsapp("not a phone")).toBe("");
  });
});

describe("isValidWhatsapp", () => {
  it("accepts E.164-length numbers", () => {
    expect(isValidWhatsapp("+971502148890")).toBe(true);
    expect(isValidWhatsapp("0502148890")).toBe(true);
    expect(isValidWhatsapp("+966501234567")).toBe(true);
  });

  it("rejects too-short, empty and non-numeric input", () => {
    expect(isValidWhatsapp("123")).toBe(false);
    expect(isValidWhatsapp("")).toBe(false);
    expect(isValidWhatsapp(null)).toBe(false);
    expect(isValidWhatsapp("hello")).toBe(false);
  });

  it("rejects a number longer than E.164 allows", () => {
    expect(isValidWhatsapp("+9715021488901234567")).toBe(false);
  });
});

describe("whatsappLink", () => {
  it("builds a link with digits only", () => {
    expect(whatsappLink("+971 50 214 8890")).toBe(
      "https://api.whatsapp.com/send?phone=971502148890",
    );
  });

  /**
   * NOT `wa.me`, and this assertion is the guard on that.
   *
   * `wa.me` is WhatsApp's own shortener and it does not redirect losslessly: it
   * re-encodes `text` and replaces every non-BMP character with U+FFFD.
   * Measured against WhatsApp itself, with nothing of ours in the path,
   * `?text=%F0%9F%91%8B` comes back as `text=%EF%BF%BD`. Arabic is BMP and
   * survives, so an Arabic message looks perfectly fine while every emoji in it
   * is quietly destroyed. See the note at the top of src/lib/whatsapp.ts.
   */
  it("uses the endpoint that does not re-encode the message", () => {
    const href = whatsappLink("+971502148890", "مرحبا");
    expect(href.startsWith("https://api.whatsapp.com/send?phone=")).toBe(true);
    expect(href).not.toContain("wa.me");
  });

  it("url-encodes the prefilled message without mangling it", () => {
    const message = "مرحبا — RQ-2420";
    const href = whatsappLink("+971502148890", message);
    expect(
      href.startsWith("https://api.whatsapp.com/send?phone=971502148890&text="),
    ).toBe(true);
    expect(decodeURIComponent(href.split("&text=")[1])).toBe(message);
  });

  /**
   * The regression this change exists for.
   *
   * Emoji are astral — U+1F44B is the surrogate pair 👋 — while
   * Arabic is BMP, and the two travel differently: a transform that loses one
   * keeps the other, which is exactly why the corruption went unnoticed for so
   * long. So the assertion is on the BYTES, not on the rendered glyph:
   * `%F0%9F%91%8B` is the correct UTF-8 percent-encoding of 👋, and
   * `%EF%BF%BD` is the replacement character that must never appear.
   */
  it("carries Arabic and non-BMP emoji through as valid UTF-8", () => {
    const message = "‏السلام عليكم 👋\nالإجمالي: 💰 التأمين: 🛡️";
    const href = whatsappLink("+971502148890", message);
    const encoded = href.split("&text=")[1];

    // Round-trips exactly, emoji and all.
    expect(decodeURIComponent(encoded)).toBe(message);

    // And the wire form is real UTF-8 rather than a replacement character.
    expect(encoded).toContain("%F0%9F%91%8B");
    expect(encoded).toContain("%F0%9F%92%B0");
    expect(encoded).not.toContain("%EF%BF%BD");
    expect(href).not.toContain("�");
  });

  /**
   * The caller uses "" to decide whether to render the button at all. Returning
   * a bare endpoint with no number would produce a visible link that opens
   * nothing.
   */
  it("returns an empty string when there is no usable number", () => {
    expect(whatsappLink("")).toBe("");
    expect(whatsappLink(null)).toBe("");
    expect(whatsappLink("abc")).toBe("");
  });
});

/**
 * ─── Why there is no "+" any more ────────────────────────────────────────────
 * Numbers are entered, stored and displayed in one plus-less shape:
 * `971503322119`. That is the format the operator asked for, and it is also
 * what an owner now types to sign in — `User.username` holds exactly these
 * digits. A display that added a "+" would show owners a string one character
 * away from their own username, which is precisely the near-miss the whole
 * normalisation change exists to remove. Grouping stays: it is readability, not
 * a different value.
 */
describe("formatWhatsappDisplay", () => {
  it("groups a UAE number the way it is written, with no plus", () => {
    expect(formatWhatsappDisplay("971502148890")).toBe("971 50 214 8890");
  });

  it("falls back to bare digits for anything else", () => {
    expect(formatWhatsappDisplay("+966501234567")).toBe("966501234567");
  });

  /** The displayed UAE number is the stored one with spaces — nothing else. */
  it("displays a number that round-trips back to what is stored", () => {
    const stored = "971503322119";
    expect(formatWhatsappDisplay(stored).replace(/ /g, "")).toBe(stored);
  });
});

/**
 * Requirement 4: a listing's contact buttons must open THAT listing's owner.
 */
describe("resolveListingWhatsapp", () => {
  const SITE = "+971500000000";

  it("uses the owner's number for an owned listing", () => {
    const resolved = resolveListingWhatsapp(
      {
        ownerWhatsapp: null,
        ownerName: "Legacy name",
        owner: { whatsapp: "971501110001", fullName: "Salem", businessName: "Salem Rest Houses" },
      },
      SITE,
    );
    expect(resolved.digits).toBe("971501110001");
    expect(resolved.name).toBe("Salem Rest Houses");
  });

  it("prefers the owner relation over a stale per-listing copy", () => {
    // The listing carries an old number; the owner has since changed theirs.
    const resolved = resolveListingWhatsapp(
      {
        ownerWhatsapp: "971509999999",
        owner: { whatsapp: "971501110001", fullName: "Salem", businessName: "" },
      },
      SITE,
    );
    expect(resolved.digits).toBe("971501110001");
  });

  it("gives two owners' listings two different numbers", () => {
    const a = resolveListingWhatsapp(
      { owner: { whatsapp: "971501110001", fullName: "A", businessName: "" } },
      SITE,
    );
    const b = resolveListingWhatsapp(
      { owner: { whatsapp: "971501110002", fullName: "B", businessName: "" } },
      SITE,
    );
    expect(a.digits).not.toBe(b.digits);
    expect(a.digits).toBe("971501110001");
    expect(b.digits).toBe("971501110002");
  });

  /**
   * The dependency requirement 4 exists to remove. An owned listing must never
   * route a guest to the platform operator.
   */
  it("does NOT fall back to the site number for an owned listing", () => {
    const resolved = resolveListingWhatsapp(
      { owner: { whatsapp: "", fullName: "No Number", businessName: "" } },
      SITE,
    );
    expect(resolved.digits).toBe("");
    expect(whatsappLink(resolved.digits)).toBe("");
  });

  it("still supports platform-owned listings, which have no owner", () => {
    const own = resolveListingWhatsapp(
      { ownerWhatsapp: "971509999999", ownerName: "Abu Sultan", owner: null },
      SITE,
    );
    expect(own.digits).toBe("971509999999");

    const siteFallback = resolveListingWhatsapp(
      { ownerWhatsapp: null, ownerName: null, owner: null },
      SITE,
    );
    expect(siteFallback.digits).toBe("971500000000");
  });
});

describe("bookingRequestMessage", () => {
  const base = {
    siteName: "Sands",
    reference: "RQ-2420",
    listingName: "Golden Sands",
    listingArea: "Lahbab",
    checkIn: "2026-07-28",
    checkOut: "2026-07-30",
    nights: 2,
    guests: 45,
    customerName: "Khalid",
    customerPhone: "+971 50 214 8890",
    total: 3780,
  };

  it("carries the reference, totals and contact details", () => {
    const message = bookingRequestMessage({ ...base, locale: "en" });
    expect(message).toContain("RQ-2420");
    expect(message).toContain("Golden Sands");
    expect(message).toContain("3,780");
    expect(message).toContain("Khalid");
    expect(message).toContain("+971 50 214 8890");
  });

  it("includes the snapshotted deposit when one is due", () => {
    const message = bookingRequestMessage({
      ...base,
      depositDue: 945,
      depositPercent: 25,
      locale: "en",
    });
    expect(message).toContain("25%");
    expect(message).toContain("945");
  });

  /** "Deposit 0%" reads as a bug to a customer; the line is omitted instead. */
  it("omits the deposit line entirely when none is due", () => {
    const message = bookingRequestMessage({
      ...base,
      depositDue: 0,
      depositPercent: 0,
      locale: "en",
    });
    expect(message).not.toContain("Deposit");
  });

  it("writes the message in the visitor's language", () => {
    const arabic = bookingRequestMessage({ ...base, locale: "ar" });
    const english = bookingRequestMessage({ ...base, locale: "en" });
    expect(arabic).toContain("السلام عليكم");
    expect(english).toContain("Hello");
    expect(english).not.toContain("السلام عليكم");
  });

  /**
   * The RIGHT-TO-LEFT MARK keeps a line starting with "+971…" from being
   * visually reordered inside an Arabic paragraph. It must not leak into the
   * English message, where it would be a stray invisible character.
   */
  it("uses the RTL mark only in Arabic", () => {
    expect(bookingRequestMessage({ ...base, locale: "ar" })).toContain("‏");
    expect(bookingRequestMessage({ ...base, locale: "en" })).not.toContain("‏");
  });

  /**
   * The message is built from dictionary lines that lead with emoji — 📋 for the
   * reference, 📅 for the dates, 💰 for the total. Every one of those is astral,
   * so they are the first thing any encoding fault destroys while the Arabic
   * beside them survives and makes the message look intact.
   */
  it("keeps its emoji intact in both languages", () => {
    for (const locale of ["ar", "en"] as const) {
      const message = bookingRequestMessage({
        ...base,
        depositDue: 945,
        depositPercent: 25,
        securityDeposit: 500,
        locale,
      });

      expect(message, `${locale} greeting emoji`).toContain("👋");
      expect(message, `${locale} reference emoji`).toContain("📋");
      expect(message, `${locale} total emoji`).toContain("💰");
      expect(message, `${locale} security-deposit emoji`).toContain("🛡️");
      expect(message, `${locale} replacement char`).not.toContain("�");
    }
  });

  /**
   * End to end: the message the owner actually receives is the one that came
   * out of the link, not the one that came out of the builder. This is the
   * assertion that would have caught the corruption — the builder was always
   * right, and everything downstream of it is what had to be proved.
   */
  it("survives the round trip through the link as valid UTF-8", () => {
    const message = bookingRequestMessage({ ...base, locale: "ar" });
    const href = whatsappLink("+971502148890", message);
    const encoded = href.split("&text=")[1];

    expect(decodeURIComponent(encoded)).toBe(message);
    expect(encoded).toContain("%F0%9F%91%8B"); // 👋
    expect(encoded).not.toContain("%EF%BF%BD"); // U+FFFD
  });
});
