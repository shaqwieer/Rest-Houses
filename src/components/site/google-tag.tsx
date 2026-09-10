import Script from "next/script";

/**
 * The Google tag (gtag.js), assembled from the identifiers stored on the
 * settings row.
 *
 * ─── Why this builds the snippet instead of storing it ───────────────────────
 * Google hands the operator a block of `<script>` and says "paste it before
 * `</head>`". Storing that block verbatim and printing it back would put an
 * unvalidated string into every page of the site — a stored-XSS surface that a
 * single compromised admin session turns into full control of the front end,
 * and a mistyped paste that silently breaks every page. So /admin/tracking
 * takes the *identifiers* only ("AW-950802645", "G-…", "GT-…"), checks them
 * against the shapes Google issues, and this component writes the snippet.
 *
 * ─── One loader, one `config` per property ───────────────────────────────────
 * `id` is the advertising tag — in practice "AW-…" — and `analyticsId` is the
 * GA4 measurement id. They are two columns rather than one because gtag.js
 * takes a single loader and a `config` command per property: a site that runs
 * Ads *and* Analytics needs both configured on the same tag, not two loaders
 * racing each other. Either may be empty; whichever is present becomes the
 * loader's own id, and both are configured when both are set.
 *
 * ─── Where it is mounted ─────────────────────────────────────────────────────
 * src/app/(site)/layout.tsx — the public shell — not the root layout. /admin
 * and /login sit outside that route group, so the operator's own working day
 * never lands in the advertising account's traffic or, worse, in its conversion
 * counts. (/owner joins the public shell's tracking only when an operator turns
 * `ownerAreaTracking` on; see src/components/site/tracking-scripts.tsx.)
 *
 * ─── Why next/script, not a literal <head> tag ───────────────────────────────
 * The App Router owns `<head>`; there is no element here to paste before.
 * `next/script` with `afterInteractive` is the supported equivalent and is what
 * Google's own `async` attribute is asking for anyway — the tag must not block
 * first paint. The two scripts are emitted in order, so `gtag()` and the
 * `config` commands are queued on `dataLayer` before anything else can use them.
 *
 * Two empty ids render nothing at all: a site with no tag configured serves
 * exactly the HTML it served before this existed.
 */
export function GoogleTag({ id, analyticsId = "" }: { id: string; analyticsId?: string }) {
  // Whichever is set loads the library; the other is configured on top of it.
  const loaderId = id || analyticsId;
  if (!loaderId) return null;

  // A site that runs Ads only, or GA4 only, must not emit the same `config`
  // twice — gtag tolerates it, but a duplicate is a lie about what the page is
  // doing and the next reader has to work out which one matters.
  const configIds = [id, analyticsId].filter((value, index, all) => {
    return Boolean(value) && all.indexOf(value) === index;
  });

  return (
    <>
      <Script
        id="google-tag-src"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(loaderId)}`}
      />
      {/* JSON.stringify, not a bare template hole: the ids are validated on
          save, but the rule for anything interpolated into a script body is
          that it escapes itself rather than relying on a check made somewhere
          else. */}
      <Script id="google-tag-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
${configIds.map((value) => `gtag('config', ${JSON.stringify(value)});`).join("\n")}`}
      </Script>
    </>
  );
}
