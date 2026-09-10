import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { ensureSchema, prisma, resetDatabase, seedSettings } from "./db";
import {
  googleAdsSendTo,
  gtmOverlaps,
  isTrackingLive,
  trackingConfig,
  type TrackingConfig,
} from "@/lib/tracking";
import type { Settings } from "@/lib/settings";
import { GoogleTag } from "@/components/site/google-tag";
import { TrackingScripts } from "@/components/site/tracking-scripts";
import Script from "next/script";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { ActionResult } from "@/app/actions/listings";

/**
 * What /admin/tracking will accept, and what the site does with it afterwards.
 *
 * These are worth asserting because every failure mode here is *silent*. A
 * pixel that never loads, a `send_to` assembled from half a configuration, a
 * conversion attributed to nothing, a configuration quietly wiped by an
 * unrelated save — none of them throws, none of them shows up in the interface,
 * and the only symptom is a number that never arrives in an advertising account
 * nobody looks at for a fortnight.
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

const { saveTracking } = await import("@/app/actions/tracking");
const { saveSettings } = await import("@/app/actions/settings");

/** A tracking post. Every field is optional to the schema; "" is "switched off". */
function trackingForm(fields: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Every field the SETTINGS form must post for its schema to parse at all. */
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
    select: {
      googleTagId: true,
      googleAdsConversionLabel: true,
      googleAnalyticsId: true,
      gtmContainerId: true,
      metaPixelId: true,
      tiktokPixelId: true,
      snapchatPixelId: true,
      ownerAreaTracking: true,
    },
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

describe("the Google tag", () => {
  it("stores an Ads tag ID and a conversion label", async () => {
    const result = await saveTracking(
      trackingForm({
        googleTagId: "AW-950802645",
        googleAdsConversionLabel: "dVoECJ30sOQcENWxsMUD",
      }),
    );

    expect(result.ok).toBe(true);
    const row = await saved();
    expect(row.googleTagId).toBe("AW-950802645");
    expect(row.googleAdsConversionLabel).toBe("dVoECJ30sOQcENWxsMUD");
  });

  /**
   * Google prints the conversion as "AW-950802645/dVoECJ30sOQcENWxsMUD", so
   * that is what an operator copies. Refusing it would be technically correct
   * and practically useless — there is no way for them to know the field wanted
   * only the second half.
   */
  it("keeps only the label when the whole send_to value is pasted", async () => {
    await saveTracking(
      trackingForm({
        googleTagId: "AW-950802645",
        googleAdsConversionLabel: "AW-950802645/dVoECJ30sOQcENWxsMUD",
      }),
    );

    expect((await saved()).googleAdsConversionLabel).toBe("dVoECJ30sOQcENWxsMUD");
  });

  it("normalises a lower-case tag ID", async () => {
    await saveTracking(trackingForm({ googleTagId: "  aw-950802645  " }));
    expect((await saved()).googleTagId).toBe("AW-950802645");
  });

  /**
   * The label is case-sensitive: "dvoecj…" is a different conversion from
   * "dVoECJ…", and one that does not exist. Upper-casing it the way the tag ID
   * is upper-cased would produce a configuration that looks right in the form
   * and reports nothing.
   */
  it("never changes the case of the conversion label", async () => {
    await saveTracking(
      trackingForm({
        googleTagId: "AW-950802645",
        googleAdsConversionLabel: "dVoECJ30sOQcENWxsMUD",
      }),
    );
    expect((await saved()).googleAdsConversionLabel).toBe("dVoECJ30sOQcENWxsMUD");
  });

  it("accepts a GA4 measurement ID in the tag field too", async () => {
    const result = await saveTracking(trackingForm({ googleTagId: "G-ABC123XYZ" }));
    expect(result.ok).toBe(true);
    expect((await saved()).googleTagId).toBe("G-ABC123XYZ");
  });

  /**
   * The case the validation exists for: half a copied script line. It looks
   * enough like a tag ID for a human skimming the form to miss it, and would
   * render a tag that can never fire.
   */
  it("rejects a pasted script fragment and leaves the stored value alone", async () => {
    await saveTracking(trackingForm({ googleTagId: "AW-950802645" }));

    const result = await saveTracking(
      trackingForm({ googleTagId: "<script src=gtag/js?id=AW-950802645>" }),
    );

    expect(refused(result).fieldErrors?.googleTagId).toBeTruthy();
    expect((await saved()).googleTagId).toBe("AW-950802645");
  });

  it("rejects a tag ID with no recognised prefix", async () => {
    const result = await saveTracking(trackingForm({ googleTagId: "950802645" }));
    expect(refused(result).fieldErrors?.googleTagId).toBeTruthy();
  });

  /**
   * A container is loaded by gtm.js, not by gtag/js?id=. Accepting one here
   * would render a script that quietly does nothing — so it is refused, and it
   * has a field of its own.
   */
  it("refuses a Tag Manager container in the Google tag field", async () => {
    const result = await saveTracking(trackingForm({ googleTagId: "GTM-ABC1234" }));
    expect(refused(result).fieldErrors?.googleTagId).toBeTruthy();
  });
});

describe("the advertising pixels", () => {
  it("stores Meta, TikTok, Snapchat, GA4 and a container together", async () => {
    const result = await saveTracking(
      trackingForm({
        metaPixelId: "123456789012345",
        tiktokPixelId: "CO4A2JJC77UF1234ABCD",
        snapchatPixelId: "0a1b2c3d-4e5f-6789-abcd-ef0123456789",
        googleAnalyticsId: "G-ABC123XYZ",
        gtmContainerId: "GTM-ABC1234",
      }),
    );

    expect(result.ok).toBe(true);
    expect(await saved()).toMatchObject({
      metaPixelId: "123456789012345",
      tiktokPixelId: "CO4A2JJC77UF1234ABCD",
      snapchatPixelId: "0a1b2c3d-4e5f-6789-abcd-ef0123456789",
      googleAnalyticsId: "G-ABC123XYZ",
      gtmContainerId: "GTM-ABC1234",
    });
  });

  it("normalises the case each platform prints its id in", async () => {
    await saveTracking(
      trackingForm({
        tiktokPixelId: "co4a2jjc77uf1234abcd",
        snapchatPixelId: "0A1B2C3D-4E5F-6789-ABCD-EF0123456789",
        gtmContainerId: "gtm-abc1234",
      }),
    );

    const row = await saved();
    expect(row.tiktokPixelId).toBe("CO4A2JJC77UF1234ABCD");
    expect(row.snapchatPixelId).toBe("0a1b2c3d-4e5f-6789-abcd-ef0123456789");
    expect(row.gtmContainerId).toBe("GTM-ABC1234");
  });

  /**
   * The whole reason these are identifier fields and not a "paste your head
   * code here" box: a script body must never reach the settings row, because
   * everything on it is rendered into every page of the public site.
   */
  it("refuses a pasted pixel snippet on every platform", async () => {
    const snippet = "<script>fbq('init','123456789012345')</script>";

    for (const field of ["metaPixelId", "tiktokPixelId", "snapchatPixelId"]) {
      const result = await saveTracking(trackingForm({ [field]: snippet }));
      expect(refused(result).fieldErrors?.[field]).toBeTruthy();
    }

    expect(await saved()).toMatchObject({
      metaPixelId: "",
      tiktokPixelId: "",
      snapchatPixelId: "",
    });
  });

  it("refuses a GA4 field that has been given an Ads tag", async () => {
    const result = await saveTracking(trackingForm({ googleAnalyticsId: "AW-950802645" }));
    expect(refused(result).fieldErrors?.googleAnalyticsId).toBeTruthy();
  });

  it("refuses a container field that has been given a GA4 id", async () => {
    const result = await saveTracking(trackingForm({ gtmContainerId: "G-ABC123XYZ" }));
    expect(refused(result).fieldErrors?.gtmContainerId).toBeTruthy();
  });

  it("accepts blank everywhere, which is how a platform is switched off", async () => {
    await saveTracking(
      trackingForm({ metaPixelId: "123456789012345", googleTagId: "AW-950802645" }),
    );
    const result = await saveTracking(trackingForm());

    expect(result.ok).toBe(true);
    expect(await saved()).toMatchObject({ metaPixelId: "", googleTagId: "" });
  });
});

describe("the owner-area switch", () => {
  it("is off unless the box is ticked", async () => {
    await saveTracking(trackingForm({ ownerAreaTracking: "on" }));
    expect((await saved()).ownerAreaTracking).toBe(true);

    await saveTracking(trackingForm());
    expect((await saved()).ownerAreaTracking).toBe(false);
  });
});

/**
 * The reason the tracking fields left `saveSettings` entirely rather than being
 * carried through it.
 *
 * `saveSettings` reads every field as `formData.get(name) ?? ""`. While the two
 * Google fields were still in its schema and no longer on its form, an operator
 * editing the site's tagline would have silently erased their advertising
 * configuration — and would have had no way to tell until the conversions
 * stopped arriving.
 */
describe("a settings save cannot touch the tracking configuration", () => {
  it("leaves every pixel alone when the site's branding is saved", async () => {
    await saveTracking(
      trackingForm({
        googleTagId: "AW-950802645",
        googleAdsConversionLabel: "dVoECJ30sOQcENWxsMUD",
        metaPixelId: "123456789012345",
        tiktokPixelId: "CO4A2JJC77UF1234ABCD",
        snapchatPixelId: "0a1b2c3d-4e5f-6789-abcd-ef0123456789",
        googleAnalyticsId: "G-ABC123XYZ",
        gtmContainerId: "GTM-ABC1234",
        ownerAreaTracking: "on",
      }),
    );
    const before = await saved();

    const result = await saveSettings(settingsForm({ siteName: "اسم جديد تمامًا" }));
    expect(result.ok).toBe(true);

    expect(await saved()).toEqual(before);
  });

  /** And the settings form's own post cannot smuggle them in either. */
  it("ignores tracking fields posted to the settings form", async () => {
    await saveTracking(trackingForm({ googleTagId: "AW-950802645" }));

    await saveSettings(settingsForm({ googleTagId: "AW-000000000", metaPixelId: "999999999999" }));

    expect(await saved()).toMatchObject({ googleTagId: "AW-950802645", metaPixelId: "" });
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

describe("the configuration handed to the browser", () => {
  const empty: TrackingConfig = {
    googleTagId: "",
    googleAnalyticsId: "",
    gtmContainerId: "",
    metaPixelId: "",
    tiktokPixelId: "",
    snapchatPixelId: "",
    adsSendTo: "",
  };

  it("carries identifiers only — never a credential from the settings row", async () => {
    const settings = (await prisma.siteSettings.findUnique({ where: { id: 1 } }))!;
    const config = trackingConfig(settings);

    expect(Object.keys(config).sort()).toEqual(Object.keys(empty).sort());
  });

  it("knows when nothing at all is configured", () => {
    expect(isTrackingLive(empty)).toBe(false);
    expect(isTrackingLive({ ...empty, snapchatPixelId: "0a1b2c3d-4e5f-6789-abcd-ef0123456789" })).toBe(
      true,
    );
  });

  /**
   * The double-count warning. A container that also fires the same pixel counts
   * every page view twice, and the campaign that looks like it doubled its
   * conversions did nothing of the kind. Reported, never silently resolved.
   */
  it("flags a container running alongside a directly wired pixel", () => {
    expect(gtmOverlaps({ ...empty, gtmContainerId: "GTM-ABC1234" })).toBe(false);
    expect(gtmOverlaps({ ...empty, metaPixelId: "123456789012345" })).toBe(false);
    expect(
      gtmOverlaps({ ...empty, gtmContainerId: "GTM-ABC1234", metaPixelId: "123456789012345" }),
    ).toBe(true);
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

  /** GA4 on its own is still a reason to load gtag.js. */
  it("renders the loader for a GA4 id with no Ads tag", () => {
    expect(GoogleTag({ id: "", analyticsId: "G-ABC123XYZ" })).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* What actually reaches the page                                             */
/* -------------------------------------------------------------------------- */

/**
 * Flatten a component's returned tree into one string.
 *
 * `TrackingScripts` returns a tree of `next/script` elements whose bodies are
 * template strings. Rendering it with react-dom would drag in Next's head
 * manager for no benefit — what is under test is that each snippet is built
 * with the right loader and the right id, which is a property of the tree
 * itself. The plain function components (`MetaPixel` and friends) are invoked
 * by hand so the traversal reaches them.
 *
 * `Script` is the one function component NOT invoked: it calls `useContext`,
 * which needs a live renderer. It is read as a leaf instead — its `src` and its
 * body are exactly the two things worth asserting on anyway.
 */
function flatten(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flatten).join("");

  if (isValidElement(node)) {
    const element = node as ReactElement<Record<string, unknown>>;
    if (typeof element.type === "function" && element.type !== Script) {
      const render = element.type as (props: unknown) => ReactNode;
      return flatten(render(element.props));
    }
    // A host element: its own attributes matter too (the <img> and <iframe>
    // beacons carry the id in `src` rather than in a script body).
    const props = element.props ?? {};
    const attrs = Object.entries(props)
      .filter(([key, value]) => key !== "children" && typeof value === "string")
      .map(([, value]) => value)
      .join(" ");
    return `${attrs}${flatten(props.children as ReactNode)}`;
  }

  return "";
}

/** Every platform configured at once, with ids shaped the way each issues them. */
const ALL_LIVE: TrackingConfig = {
  googleTagId: "AW-950802645",
  googleAnalyticsId: "G-ABC123XYZ",
  gtmContainerId: "GTM-ABC1234",
  metaPixelId: "123456789012345",
  tiktokPixelId: "CO4A2JJC77UF1234ABCD",
  snapchatPixelId: "0a1b2c3d-4e5f-6789-abcd-ef0123456789",
  adsSendTo: "AW-950802645/dVoECJ30sOQcENWxsMUD",
};

describe("the snippets the site serves", () => {
  const markup = flatten(TrackingScripts({ config: ALL_LIVE }));

  /**
   * The check that matters on the day a media buyer says "the pixel isn't
   * firing": each platform's own loader, requested from its own host, with the
   * id the operator typed. A wrong host or a missing id produces no error
   * anywhere — the pixel simply never reports.
   */
  it.each([
    ["Google Ads / gtag", "googletagmanager.com/gtag/js?id=AW-950802645"],
    ["Tag Manager", "googletagmanager.com/gtm.js?id="],
    ["Meta", "connect.facebook.net/en_US/fbevents.js"],
    ["TikTok", "analytics.tiktok.com/i18n/pixel/events.js"],
    ["Snapchat", "sc-static.net/scevent.min.js"],
  ])("loads the %s library", (_platform, loader) => {
    expect(markup).toContain(loader);
  });

  it.each([
    ["Google Ads", `gtag('config', "AW-950802645")`],
    ["GA4", `gtag('config', "G-ABC123XYZ")`],
    ["Tag Manager", `'dataLayer',"GTM-ABC1234"`],
    ["Meta", `fbq('init', "123456789012345")`],
    ["TikTok", `ttq.load("CO4A2JJC77UF1234ABCD")`],
    ["Snapchat", `snaptr('init', "0a1b2c3d-4e5f-6789-abcd-ef0123456789")`],
  ])("initialises %s with the configured id", (_platform, call) => {
    expect(markup).toContain(call);
  });

  /**
   * Ads and GA4 share one gtag.js loader and take a `config` each — which is
   * the whole reason they are two columns. Two loaders would race; one loader
   * with one `config` would silently drop whichever property lost.
   */
  it("puts Google Ads and GA4 on a single loader", () => {
    expect(markup.match(/gtag\/js\?id=/g)).toHaveLength(1);
    expect(markup.match(/gtag\('config'/g)).toHaveLength(2);
  });

  /** Each platform reports its own page view, and exactly once. */
  it.each([
    ["Meta", /fbq\('track', 'PageView'\)/g],
    ["TikTok", /ttq\.page\(\)/g],
    ["Snapchat", /snaptr\('track', 'PAGE_VIEW'\)/g],
  ])("sends one %s page view", (_platform, pattern) => {
    expect(markup.match(pattern)).toHaveLength(1);
  });

  /** The no-script beacons carry the id too, or they report nothing. */
  it("builds the no-script fallbacks with the same ids", () => {
    expect(markup).toContain("facebook.com/tr?id=123456789012345");
    expect(markup).toContain("googletagmanager.com/ns.html?id=GTM-ABC1234");
  });

  /**
   * An id is interpolated through JSON.stringify rather than dropped into the
   * script body raw. The validation already refuses anything with a quote in
   * it; this is the second line, and the one that does not depend on a check
   * made in another file.
   */
  it("escapes an id into its script body rather than pasting it", () => {
    const hostile = flatten(
      TrackingScripts({ config: { ...ALL_LIVE, metaPixelId: `1');alert('x` } }),
    );
    expect(hostile).not.toContain(`fbq('init', '1');alert('x')`);
    expect(hostile).toContain(String.raw`"1');alert('x"`);
  });

  /** A platform left blank must not appear on the page in any form. */
  it("renders only what is configured", () => {
    const metaOnly = flatten(
      TrackingScripts({
        config: {
          googleTagId: "",
          googleAnalyticsId: "",
          gtmContainerId: "",
          metaPixelId: "123456789012345",
          tiktokPixelId: "",
          snapchatPixelId: "",
          adsSendTo: "",
        },
      }),
    );

    expect(metaOnly).toContain("connect.facebook.net");
    expect(metaOnly).not.toContain("analytics.tiktok.com");
    expect(metaOnly).not.toContain("sc-static.net");
    expect(metaOnly).not.toContain("googletagmanager.com");
  });

  /**
   * The baseline every deployment starts from: a site with nothing configured
   * serves exactly the HTML it served before any of this existed.
   */
  it("renders nothing at all when no platform is configured", () => {
    const nothing = flatten(
      TrackingScripts({
        config: {
          googleTagId: "",
          googleAnalyticsId: "",
          gtmContainerId: "",
          metaPixelId: "",
          tiktokPixelId: "",
          snapchatPixelId: "",
          adsSendTo: "",
        },
      }),
    );

    expect(nothing).toBe("");
  });
});
