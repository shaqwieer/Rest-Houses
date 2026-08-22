import Script from "next/script";

/**
 * The Google tag (gtag.js), assembled from the identifier stored on the
 * settings row.
 *
 * ─── Why this builds the snippet instead of storing it ───────────────────────
 * Google hands the operator a block of `<script>` and says "paste it before
 * `</head>`". Storing that block verbatim and printing it back would put an
 * unvalidated string into every page of the site — a stored-XSS surface that a
 * single compromised admin session turns into full control of the front end,
 * and a mistyped paste that silently breaks every page. So /admin/settings
 * takes the *identifier* only ("AW-950802645", "G-…", "GT-…"), checks it against
 * the shape Google issues, and this component writes the snippet.
 *
 * ─── Where it is mounted ─────────────────────────────────────────────────────
 * src/app/(site)/layout.tsx — the public shell — not the root layout. The
 * dashboard, the owner area and /login sit outside that route group, so the
 * operator's own working day never lands in the advertising account's traffic
 * or, worse, in its conversion counts.
 *
 * ─── Why next/script, not a literal <head> tag ───────────────────────────────
 * The App Router owns `<head>`; there is no element here to paste before.
 * `next/script` with `afterInteractive` is the supported equivalent and is what
 * Google's own `async` attribute is asking for anyway — the tag must not block
 * first paint. The two scripts are emitted in order, so `gtag()` and the
 * `config` command are queued on `dataLayer` before anything else can use them.
 *
 * An empty id renders nothing at all: a site with no tag configured serves
 * exactly the HTML it served before this existed.
 */
export function GoogleTag({ id }: { id: string }) {
  if (!id) return null;

  return (
    <>
      <Script
        id="google-tag-src"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`}
      />
      {/* JSON.stringify, not a bare template hole: the id is validated on save,
          but the rule for anything interpolated into a script body is that it
          escapes itself rather than relying on a check made somewhere else. */}
      <Script id="google-tag-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', ${JSON.stringify(id)});`}
      </Script>
    </>
  );
}
