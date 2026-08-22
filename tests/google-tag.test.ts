import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { ensureSchema, prisma, resetDatabase, seedSettings } from "./db";
import { googleAdsSendTo, type Settings } from "@/lib/settings";
import { GoogleTag } from "@/components/site/google-tag";
import type { ActionResult } from "@/app/actions/listings";

/**
 * The Google tag: what /admin/settings will accept, and what the site does with
 * it afterwards.
 *
 * These are worth asserting because every failure mode here is *silent*. A tag
 * that never loads, a `send_to` assembled from half a configuration, a
 * conversion attributed to nothing — none of them throws, none of them shows up
 * in the interface, and the only symptom is a number that never arrives in an
 * advertising account nobody looks at for a fortnight.
 *
 * The session mocks are the same arrangement as tests/admin-account.test.ts:
 * only NextAuth is faked, and `requireAdmin` runs for real.
 */

const sessionUser = vi.hoisted(() => ({ current: null as { id: string } | null }));

vi.mock("next-auth", () => ({
  default: () => ({
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
    auth: async () => (sessionUser.current ? { user: { id: sessionUser.current.id } } : null),
  }),
  AuthError: class AuthError extends Error {},
}));

vi.mock("next-auth/providers/credentials", () => ({ default: () => ({}) }));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/i18n/server", async () => {
  const { ar } = await import("@/lib/i18n/ar");
  return {
    getLocale: async () => "ar",
    getT: async () => ar,
    getDir: async () => "rtl",
    getI18n: async () => ({ locale: "ar", t: ar, dir: "rtl" }),
  };
});

const { saveSettings } = await import("@/app/actions/settings");

/** Every field the settings form must post for the schema to parse at all. */
function settingsForm(fields: Record<string, string> = {}) {
  const fd = new FormData();
  const base: Record<string, string> = {
    siteName: "استراحات الرمال",
    whatsappNumber: "+971500000000",
    colorAccent: "#C9A44C",
    colorAccentDeep: "#A8873A",
    colorNight: "#0C1522",
    colorSand: "#FBF7F0",
    heroTitle: "استراحتك في قلب الصحراء",
  };
  for (const [k, v] of Object.entries({ ...base, ...fields })) fd.set(k, v);
  return fd;
}

/** Narrows a refused save so its field errors can be read. */
function refused(result: ActionResult) {
  if (result.ok) throw new Error("expected the save to be refused");
  return result;
}

async function saved() {
  const row = await prisma.siteSettings.findUnique({
    where: { id: 1 },
    select: { googleTagId: true, googleAdsConversionLabel: true },
  });
  return row!;
}

beforeAll(() => {
  ensureSchema();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await seedSettings();
  const admin = await prisma.user.create({
    data: { email: "boss@example.ae", name: "أبو سلطان", passwordHash: "x", role: "ADMIN" },
  });
  sessionUser.current = { id: admin.id };
});

describe("saving a Google tag from /admin/settings", () => {
  it("stores an Ads tag ID and a conversion label", async () => {
    const result = await saveSettings(
      settingsForm({
        googleTagId: "AW-950802645",
        googleAdsConversionLabel: "dVoECJ30sOQcENWxsMUD",
      }),
    );

    expect(result.ok).toBe(true);
    expect(await saved()).toEqual({
      googleTagId: "AW-950802645",
      googleAdsConversionLabel: "dVoECJ30sOQcENWxsMUD",
    });
  });

  /**
   * Google prints the conversion as "AW-950802645/dVoECJ30sOQcENWxsMUD", so
   * that is what an operator copies. Refusing it would be technically correct
   * and practically useless — there is no way for them to know the field wanted
   * only the second half.
   */
  it("keeps only the label when the whole send_to value is pasted", async () => {
    await saveSettings(
      settingsForm({
        googleTagId: "AW-950802645",
        googleAdsConversionLabel: "AW-950802645/dVoECJ30sOQcENWxsMUD",
      }),
    );

    expect((await saved()).googleAdsConversionLabel).toBe("dVoECJ30sOQcENWxsMUD");
  });

  it("normalises a lower-case tag ID", async () => {
    await saveSettings(settingsForm({ googleTagId: "  aw-950802645  " }));
    expect((await saved()).googleTagId).toBe("AW-950802645");
  });

  /**
   * The label is case-sensitive: "dvoecj…" is a different conversion from
   * "dVoECJ…", and one that does not exist. Upper-casing it the way the tag ID
   * is upper-cased would produce a configuration that looks right in the form
   * and reports nothing.
   */
  it("never changes the case of the conversion label", async () => {
    await saveSettings(
      settingsForm({
        googleTagId: "AW-950802645",
        googleAdsConversionLabel: "dVoECJ30sOQcENWxsMUD",
      }),
    );
    expect((await saved()).googleAdsConversionLabel).toBe("dVoECJ30sOQcENWxsMUD");
  });

  it("accepts a GA4 measurement ID too", async () => {
    const result = await saveSettings(settingsForm({ googleTagId: "G-ABC123XYZ" }));
    expect(result.ok).toBe(true);
    expect((await saved()).googleTagId).toBe("G-ABC123XYZ");
  });

  it("accepts blank on both fields, which is how tracking is switched off", async () => {
    await saveSettings(
      settingsForm({ googleTagId: "AW-950802645", googleAdsConversionLabel: "abcDEF123" }),
    );
    const result = await saveSettings(
      settingsForm({ googleTagId: "", googleAdsConversionLabel: "" }),
    );

    expect(result.ok).toBe(true);
    expect(await saved()).toEqual({ googleTagId: "", googleAdsConversionLabel: "" });
  });

  /**
   * The case the validation exists for: half a copied script line. It looks
   * enough like a tag ID for a human skimming the form to miss it, and would
   * render a tag that can never fire.
   */
  it("rejects a pasted script fragment and leaves the stored value alone", async () => {
    await saveSettings(settingsForm({ googleTagId: "AW-950802645" }));

    const result = await saveSettings(
      settingsForm({ googleTagId: "<script src=gtag/js?id=AW-950802645>" }),
    );

    expect(refused(result).fieldErrors?.googleTagId).toBeTruthy();
    expect((await saved()).googleTagId).toBe("AW-950802645");
  });

  it("rejects a tag ID with no recognised prefix", async () => {
    const result = await saveSettings(settingsForm({ googleTagId: "950802645" }));
    expect(refused(result).fieldErrors?.googleTagId).toBeTruthy();
  });
});

describe("googleAdsSendTo", () => {
  const row = (tag: string, label: string) =>
    ({ googleTagId: tag, googleAdsConversionLabel: label }) as Settings;

  it("joins the two halves the way Google writes them", () => {
    expect(googleAdsSendTo(row("AW-950802645", "dVoECJ30sOQcENWxsMUD"))).toBe(
      "AW-950802645/dVoECJ30sOQcENWxsMUD",
    );
  });

  /**
   * The reason this is a function rather than a template string at the call
   * site. "AW-950802645/" is a value Google accepts and attributes to no
   * conversion at all — a reported number that silently goes nowhere is worse
   * than reporting nothing.
   */
  it("reports nothing when either half is missing", () => {
    expect(googleAdsSendTo(row("AW-950802645", ""))).toBe("");
    expect(googleAdsSendTo(row("", "dVoECJ30sOQcENWxsMUD"))).toBe("");
    expect(googleAdsSendTo(row("", ""))).toBe("");
  });
});

describe("GoogleTag", () => {
  /**
   * A site with no tag configured must serve exactly the HTML it served before
   * this existed — no loader, no dataLayer, no request to Google.
   */
  it("renders nothing at all without an ID", () => {
    expect(GoogleTag({ id: "" })).toBeNull();
  });

  it("renders the loader once an ID is set", () => {
    expect(GoogleTag({ id: "AW-950802645" })).not.toBeNull();
  });
});
