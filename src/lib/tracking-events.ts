/**
 * One event, every platform.
 *
 * ─── Why a fan-out module and not four calls at each site ────────────────────
 * The same moment — "a guest opened WhatsApp to ask about a rest house" — is
 * called `Contact` by Meta, `Contact` by TikTok, `CUSTOM_EVENT_1` by Snapchat
 * and `contact` by GA4, and each of them wants the money in a differently named
 * field. Spelling that out at a dozen call sites means a dozen chances to send
 * TikTok Meta's parameter names, and no way to answer "what does this site
 * actually report" without reading every component.
 *
 * So call sites name the *business* event and this module owns the vocabulary.
 * The table below is also what /admin/tracking renders for the media buyer, so
 * the names they type into Events Manager come from the same source of truth as
 * the names the site sends.
 *
 * ─── Client-safe by construction ─────────────────────────────────────────────
 * No imports. This module is pulled into components that run in the browser,
 * and anything reaching for Prisma or the settings row here would drag the
 * server into the bundle.
 *
 * ─── Tracking never breaks the product ───────────────────────────────────────
 * Every platform call is wrapped on its own. A blocked pixel, an ad-blocker
 * stub that throws, a half-loaded snippet — none of it may interrupt a booking,
 * so one platform failing does not stop the other three, and the caller is
 * never handed an exception.
 */

/** Everything the site reports, in the language of the business. */
export type TrackEventName =
  /** A rest-house page was opened. */
  | "ViewProperty"
  /** Results came back for a destination/date/guest search. */
  | "Search"
  /** A guest picked a complete set of dates on a listing's calendar. */
  | "AvailabilityCheck"
  /** A guest opened WhatsApp to talk to the owner or the platform. */
  | "ContactWhatsapp"
  /** A guest moved from the listing into the booking form. */
  | "InitiateBooking"
  /** The booking request was accepted by the server. */
  | "BookingRequested"
  /** A deposit was verified as paid — see the note on the caller. */
  | "Purchase"
  /** An owner finished the registration form. */
  | "Registration"
  /** An owner created a rest house. */
  | "AddProperty"
  /** An owner published a rest house, so it is live for guests. */
  | "CompletePropertySetup";

/**
 * Per-platform names.
 *
 * `null` means "this platform has no sensible name for this moment, send
 * nothing" — an honest answer, and better than inventing a slot whose meaning
 * nobody can look up six months later.
 *
 * `meta.custom` selects `fbq('trackCustom', …)`. Meta refuses to attribute an
 * unrecognised name sent through `track`, so a custom event MUST go through the
 * other call — this flag is the difference between an event that appears in
 * Events Manager and one that vanishes.
 *
 * Snapchat has no CONTACT and no AVAILABILITY_CHECK; its five `CUSTOM_EVENT_n`
 * slots are exactly the mechanism for that, and which slot means what is
 * printed on /admin/tracking so a media buyer can name them in Ads Manager.
 */
export type PlatformNames = {
  meta: { name: string; custom?: boolean } | null;
  tiktok: string | null;
  snapchat: string | null;
  /** gtag event name — GA4, and the Google Tag generally. */
  google: string | null;
};

export const EVENT_MAP: Record<TrackEventName, PlatformNames> = {
  ViewProperty: {
    meta: { name: "ViewContent" },
    tiktok: "ViewContent",
    snapchat: "VIEW_CONTENT",
    google: "view_item",
  },
  Search: {
    meta: { name: "Search" },
    tiktok: "Search",
    snapchat: "SEARCH",
    google: "search",
  },
  AvailabilityCheck: {
    meta: { name: "AvailabilityCheck", custom: true },
    tiktok: "AvailabilityCheck",
    snapchat: "CUSTOM_EVENT_2",
    google: "availability_check",
  },
  ContactWhatsapp: {
    meta: { name: "Contact" },
    tiktok: "Contact",
    snapchat: "CUSTOM_EVENT_1",
    google: "contact",
  },
  InitiateBooking: {
    meta: { name: "InitiateCheckout" },
    tiktok: "InitiateCheckout",
    snapchat: "START_CHECKOUT",
    google: "begin_checkout",
  },
  /**
   * A request, not a sale. The guest has asked and the owner has not yet
   * confirmed, so this is a lead everywhere it can be one — reporting it as a
   * Purchase would teach every platform's optimiser to buy enquiries that never
   * become stays, which is exactly what the plan's step 4 is guarding against
   * when it says an event is not proof of a booking until it has been matched
   * against the real thing.
   */
  BookingRequested: {
    meta: { name: "Lead" },
    tiktok: "SubmitForm",
    snapchat: "RESERVE",
    google: "generate_lead",
  },
  Purchase: {
    meta: { name: "Purchase" },
    tiktok: "CompletePayment",
    snapchat: "PURCHASE",
    google: "purchase",
  },
  Registration: {
    meta: { name: "CompleteRegistration" },
    tiktok: "CompleteRegistration",
    snapchat: "SIGN_UP",
    google: "sign_up",
  },
  AddProperty: {
    meta: { name: "AddProperty", custom: true },
    tiktok: "AddProperty",
    snapchat: null,
    google: "add_property",
  },
  CompletePropertySetup: {
    meta: { name: "CompletePropertySetup", custom: true },
    tiktok: "CompletePropertySetup",
    snapchat: null,
    google: "complete_property_setup",
  },
};

/** Every event name, in the order the guest and owner journeys run. */
export const TRACKED_EVENTS = Object.keys(EVENT_MAP) as TrackEventName[];

/**
 * What a call site knows, in neutral terms.
 *
 * Deliberately not "the union of four platforms' parameter names": each
 * platform's serializer below translates from this, so a call site never has to
 * know that Snapchat calls the money `price` while everyone else calls it
 * `value`.
 */
export type TrackPayload = {
  /** The rest house — its slug, which is what every other URL uses. */
  id?: string;
  /** The rest house's name, in the visitor's language. */
  name?: string;
  /** Money, in AED. Omitted where there is no figure yet. */
  value?: number;
  /** What was searched for — a destination, a date range, a guest count. */
  query?: string;
  /** Results returned, or guests, depending on the event. */
  count?: number;
  /** Booking reference, for a Purchase — the platforms' de-duplication key. */
  transactionId?: string;
};

/** The site prices in dirhams and nothing else. */
const CURRENCY = "AED";

/* -------------------------------------------------------------------------- */
/* The globals each snippet installs                                          */
/* -------------------------------------------------------------------------- */

type Fbq = (...args: unknown[]) => void;
type Ttq = { track: (name: string, params?: Record<string, unknown>) => void };
type Snaptr = (...args: unknown[]) => void;
type Gtag = (...args: unknown[]) => void;

type TrackingWindow = Window & {
  fbq?: Fbq;
  ttq?: Ttq;
  snaptr?: Snaptr;
  gtag?: Gtag;
  dataLayer?: unknown[];
};

function browser(): TrackingWindow | null {
  return typeof window === "undefined" ? null : (window as unknown as TrackingWindow);
}

/* -------------------------------------------------------------------------- */
/* Per-platform parameter vocabularies                                        */
/* -------------------------------------------------------------------------- */

function metaParams(p: TrackPayload): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (p.id) {
    params.content_ids = [p.id];
    // Meta matches a catalogue on "product"; a rest house behaves like one for
    // attribution even though the word is wrong for it.
    params.content_type = "product";
  }
  if (p.name) params.content_name = p.name;
  if (p.value !== undefined) {
    params.value = p.value;
    params.currency = CURRENCY;
  }
  if (p.query) params.search_string = p.query;
  if (p.count !== undefined) params.num_items = p.count;
  return params;
}

function tiktokParams(p: TrackPayload): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (p.id || p.name) {
    params.contents = [
      {
        content_id: p.id ?? "",
        content_name: p.name ?? "",
        content_type: "product",
        ...(p.value !== undefined ? { price: p.value } : {}),
        quantity: 1,
      },
    ];
  }
  if (p.value !== undefined) {
    params.value = p.value;
    params.currency = CURRENCY;
  }
  if (p.query) params.query = p.query;
  return params;
}

function snapchatParams(p: TrackPayload): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (p.id) params.item_ids = [p.id];
  if (p.name) params.item_category = p.name;
  // Snapchat's money field is `price`, not `value` — the single most common way
  // a Snap pixel ends up reporting conversions worth nothing at all.
  if (p.value !== undefined) {
    params.price = p.value;
    params.currency = CURRENCY;
  }
  if (p.query) params.search_string = p.query;
  if (p.count !== undefined) params.number_items = p.count;
  if (p.transactionId) params.transaction_id = p.transactionId;
  return params;
}

function googleParams(p: TrackPayload): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (p.value !== undefined) {
    params.value = p.value;
    params.currency = CURRENCY;
  }
  if (p.query) params.search_term = p.query;
  if (p.transactionId) params.transaction_id = p.transactionId;
  if (p.id || p.name) {
    params.items = [
      {
        item_id: p.id ?? "",
        item_name: p.name ?? "",
        ...(p.value !== undefined ? { price: p.value } : {}),
        quantity: 1,
      },
    ];
  }
  return params;
}

/* -------------------------------------------------------------------------- */
/* The fan-out                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Report one business event to every platform that is loaded.
 *
 * Nothing here checks *whether* a pixel is configured: an unconfigured platform
 * never installed its global, so its branch is skipped. That saves telling the
 * browser the site's configuration a second time, and means a pixel switched
 * off in /admin/tracking stops reporting on the next page load rather than
 * whenever somebody remembers a second flag.
 *
 * Returns nothing on purpose. A call site must never branch on whether an
 * advertising platform was reachable.
 */
export function track(event: TrackEventName, payload: TrackPayload = {}): void {
  const w = browser();
  if (!w) return;

  const names = EVENT_MAP[event];

  if (names.meta && typeof w.fbq === "function") {
    try {
      w.fbq(names.meta.custom ? "trackCustom" : "track", names.meta.name, metaParams(payload));
    } catch {
      // A blocked or stubbed pixel. Nothing to do, and nothing worth reporting.
    }
  }

  if (names.tiktok && w.ttq && typeof w.ttq.track === "function") {
    try {
      w.ttq.track(names.tiktok, tiktokParams(payload));
    } catch {
      /* see above */
    }
  }

  if (names.snapchat && typeof w.snaptr === "function") {
    try {
      w.snaptr("track", names.snapchat, snapchatParams(payload));
    } catch {
      /* see above */
    }
  }

  if (names.google && typeof w.gtag === "function") {
    try {
      w.gtag("event", names.google, googleParams(payload));
    } catch {
      /* see above */
    }
  }

  /**
   * And the container, if one is running.
   *
   * A Tag Manager container cannot see the calls above — they go straight to
   * each platform's own global — so an operator who manages their tags in GTM
   * would otherwise get page views and nothing else. The prefix keeps these
   * clear of whatever else pushes to `dataLayer`.
   */
  if (Array.isArray(w.dataLayer)) {
    try {
      w.dataLayer.push({ event: `rihla_${event}`, ...payload });
    } catch {
      /* see above */
    }
  }
}

/** Keys already reported during this page load. See `trackOnce`. */
const reported = new Set<string>();

/**
 * `track`, but at most once for a given key.
 *
 * The guest journey is full of moments that repeat without anything new having
 * happened: a refresh of the confirmation screen, the back button out of
 * WhatsApp, React re-running an effect in development. Each of those would
 * report another conversion.
 *
 * The key is scoped by the caller — a booking reference, a listing slug — and
 * lives in sessionStorage so re-opening the same link tomorrow behaves like a
 * first visit. The in-memory set covers this page load even where storage
 * throws, which it does in some privacy modes.
 *
 * Returns whether the event was reported, which is what makes it testable.
 */
export function trackOnce(
  key: string,
  event: TrackEventName,
  payload: TrackPayload = {},
): boolean {
  const w = browser();
  if (!key || !w) return false;

  const storageKey = `rihla-track:${event}:${key}`;
  if (reported.has(storageKey)) return false;

  try {
    if (w.sessionStorage.getItem(storageKey) === "1") {
      reported.add(storageKey);
      return false;
    }
  } catch {
    // Storage unavailable. The in-memory guard below still holds for this load.
  }

  // Marked BEFORE the platforms are called, so a synchronous re-entry cannot
  // report the same moment twice.
  reported.add(storageKey);
  try {
    w.sessionStorage.setItem(storageKey, "1");
  } catch {
    /* the in-memory guard remains */
  }

  track(event, payload);
  return true;
}
