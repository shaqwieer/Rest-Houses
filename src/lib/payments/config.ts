import {
  ONLINE_PAYMENT_PROVIDERS,
  type PaymentProviderId,
} from "@/lib/constants";
import type { Settings } from "@/lib/settings";

/**
 * Payment configuration — the seam between the operator's switches and the
 * deployment's credentials.
 *
 * ─── SERVER ONLY ────────────────────────────────────────────────────────────
 * Everything in this file reads `process.env`. Nothing it returns may be handed
 * to a client component, and no function here returns a secret to a caller that
 * did not already have to be on the server to call it. The one function meant
 * to cross that boundary is `publicPaymentConfig()` at the bottom, which
 * returns booleans and nothing else — it exists precisely so a page never has
 * to reach for a credential object to answer "is Telr on?".
 *
 * ─── The three gates ────────────────────────────────────────────────────────
 * A provider is offered to a guest only when all three hold:
 *
 *   1. `SiteSettings.depositPaymentsEnabled` — online payments on at all
 *   2. that provider's own flag on `SiteSettings`
 *   3. its credentials are present in the environment
 *
 * They are kept distinct because they fail for different reasons and an
 * operator must be able to tell which. (1) is a business decision, (2) is a
 * per-gateway decision, and (3) is a deployment fact the admin UI cannot
 * change. Collapsing them would produce the single worst outcome available
 * here: a "Pay now" button that leads nowhere because somebody ticked a box
 * before the keys were deployed.
 *
 * ─── Credentials live here and only here ────────────────────────────────────
 * Not on `SiteSettings`, not in the database, not in a JSON column an admin can
 * edit. A merchant key in the settings row would be readable by every operator
 * account, would land in `pg_dump` backups that go offsite nightly, and would
 * be one careless `select *` away from a client bundle. In the environment it
 * is deployed with the container and rotated without a migration.
 */

/* --------------------------------------------------------------------------
 * Per-provider credential shapes.
 *
 * Each mirrors what that gateway's own documentation calls the fields, so a
 * developer holding the merchant onboarding email can match them up without
 * translating names.
 * -------------------------------------------------------------------------- */

export type TelrConfig = {
  /** Telr's "Store ID" — numeric, from the merchant dashboard. */
  storeId: string;
  /** The store's authentication key. Secret. */
  authKey: string;
  /**
   * Telr's own sandbox switch. Sent as `ivp_test=1`, which makes the gateway
   * accept test cards and move no real money.
   *
   * Defaults to TRUE when unset, and that default is the deliberate direction:
   * a deployment that has credentials but has not said which mode it is in must
   * not start taking live money by accident. Going live is an explicit
   * `TELR_TEST_MODE="false"`.
   */
  testMode: boolean;
};

export type TabbyConfig = {
  publicKey: string;
  secretKey: string;
  /** Signs Tabby's webhook deliveries. Without it, webhook authenticity cannot
   *  be established and the webhook route refuses the delivery. */
  webhookSecret: string;
  testMode: boolean;
};

export type TamaraConfig = {
  apiToken: string;
  /** Tamara's notification (webhook) token. Same role as Tabby's secret. */
  notificationToken: string;
  /** Sandbox and production have different hosts; the adapter never hardcodes
   *  one, so pointing a deployment at the sandbox is a config change. */
  apiUrl: string;
  testMode: boolean;
};

export type ProviderConfig = TelrConfig | TabbyConfig | TamaraConfig;

/* -------------------------------------------------------------------------- */

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/**
 * A boolean environment variable.
 *
 * `fallback` is what an *unset* variable means. Only the explicit strings
 * "false"/"0"/"no" turn something off — an empty string is treated as unset
 * rather than as false, because a deployment tool writing `TELR_TEST_MODE=""`
 * has not made a decision and must not be read as having made the riskier one.
 */
function envFlag(name: string, fallback: boolean): boolean {
  const raw = env(name).toLowerCase();
  if (!raw) return fallback;
  return !["false", "0", "no", "off"].includes(raw);
}

export function telrConfig(): TelrConfig | null {
  const storeId = env("TELR_STORE_ID");
  const authKey = env("TELR_AUTH_KEY");
  if (!storeId || !authKey) return null;
  return { storeId, authKey, testMode: envFlag("TELR_TEST_MODE", true) };
}

export function tabbyConfig(): TabbyConfig | null {
  const publicKey = env("TABBY_PUBLIC_KEY");
  const secretKey = env("TABBY_SECRET_KEY");
  if (!publicKey || !secretKey) return null;
  return {
    publicKey,
    secretKey,
    webhookSecret: env("TABBY_WEBHOOK_SECRET"),
    testMode: envFlag("TABBY_TEST_MODE", true),
  };
}

export function tamaraConfig(): TamaraConfig | null {
  const apiToken = env("TAMARA_API_TOKEN");
  if (!apiToken) return null;
  return {
    apiToken,
    notificationToken: env("TAMARA_NOTIFICATION_TOKEN"),
    // The sandbox host by default, for the same reason `testMode` defaults on.
    apiUrl: env("TAMARA_API_URL") || "https://api-sandbox.tamara.co",
    testMode: envFlag("TAMARA_TEST_MODE", true),
  };
}

/** Whether a provider has usable credentials in this deployment. */
export function hasCredentials(provider: PaymentProviderId): boolean {
  switch (provider) {
    // The off-platform path needs no credentials — it is the owner's own bank
    // account, and it is what this platform has always done.
    case "MANUAL":
      return true;
    case "TELR":
      return telrConfig() !== null;
    case "TABBY":
      return tabbyConfig() !== null;
    case "TAMARA":
      return tamaraConfig() !== null;
    default:
      return false;
  }
}

/* --------------------------------------------------------------------------
 * The switches
 * -------------------------------------------------------------------------- */

/**
 * The global on/off for card and BNPL checkouts.
 *
 * Reads `depositPaymentsEnabled`, whose name is historical — see the note on
 * the column in prisma/schema.prisma. Every caller goes through this function
 * rather than the column, so the day it is renamed there is one line to change.
 *
 * Manual / bank transfer is NOT gated by this. Switching online payments off
 * leaves the platform working exactly as it does today, which is the property
 * that makes it safe to ship this whole subsystem in the off position.
 */
export function onlinePaymentsEnabled(settings: Settings): boolean {
  return settings.depositPaymentsEnabled === true;
}

/** The operator's per-provider flag, before credentials are considered. */
export function providerFlag(settings: Settings, provider: PaymentProviderId): boolean {
  switch (provider) {
    case "MANUAL":
      return true;
    case "TELR":
      return settings.telrEnabled === true;
    case "TABBY":
      return settings.tabbyEnabled === true;
    case "TAMARA":
      return settings.tamaraEnabled === true;
    default:
      return false;
  }
}

/**
 * Which of the three gates a provider is stuck on.
 *
 * A code rather than a sentence, exactly as `depositPaymentStatus` has always
 * returned one: this module has no request scope and therefore no locale, so
 * translating here would hard-code a language into a config file. The admin
 * settings page resolves it against the dictionary.
 *
 *   OFF_GLOBALLY   online payments are switched off site-wide
 *   DISABLED       this provider is switched off
 *   MISCONFIGURED  switched on, but no credentials are deployed — the one
 *                  state an operator cannot fix from the admin UI, and the
 *                  reason this function exists at all
 *   ENABLED        all three gates pass
 */
export type ProviderState = "OFF_GLOBALLY" | "DISABLED" | "MISCONFIGURED" | "ENABLED";

export function providerState(
  settings: Settings,
  provider: PaymentProviderId,
): ProviderState {
  if (!onlinePaymentsEnabled(settings)) return "OFF_GLOBALLY";
  if (!providerFlag(settings, provider)) return "DISABLED";
  if (!hasCredentials(provider)) return "MISCONFIGURED";
  return "ENABLED";
}

/**
 * The gateways a guest may actually be sent to, right now.
 *
 * Empty on every deployment today, which is the point: no credentials exist for
 * any of the three, so this returns `[]` and every surface that asks it falls
 * back to the manual flow. Nothing needs to be "turned off" for that to be
 * true — it is what an unconfigured install does by construction.
 */
export function availableProviders(settings: Settings): PaymentProviderId[] {
  return ONLINE_PAYMENT_PROVIDERS.filter((p) => providerState(settings, p) === "ENABLED");
}

/**
 * The whole picture for the admin settings screen, in one call.
 *
 * Booleans and state codes only. No key, no secret, no partial key: this is the
 * shape that crosses into a client component, so it is defined by what is safe
 * to render rather than by what happens to be convenient.
 */
export function publicPaymentConfig(settings: Settings) {
  return {
    onlinePayments: onlinePaymentsEnabled(settings),
    paymentLinks: settings.paymentLinksEnabled === true,
    providers: Object.fromEntries(
      ONLINE_PAYMENT_PROVIDERS.map((p) => [p, providerState(settings, p)]),
    ) as Record<Exclude<PaymentProviderId, "MANUAL">, ProviderState>,
  };
}

export type PublicPaymentConfig = ReturnType<typeof publicPaymentConfig>;
