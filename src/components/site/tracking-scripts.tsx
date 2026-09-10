import Script from "next/script";
import { GoogleTag } from "./google-tag";
import type { TrackingConfig } from "@/lib/tracking";

/**
 * Every advertising pixel the site is configured to run.
 *
 * ─── Assembled here, never pasted ────────────────────────────────────────────
 * Meta, TikTok and Snapchat each hand the operator a block of minified
 * JavaScript to paste into `<head>`. /admin/tracking refuses to store any of
 * it: it takes the identifier, validates its shape, and this component writes
 * the snippet. The whole surface an admin session can reach is therefore "which
 * account do we report to" and never "what JavaScript runs on every page" —
 * which is what a free-text head-code box would have handed to anyone who ever
 * takes over an admin login. The identifiers are interpolated through
 * `JSON.stringify` regardless, so the script body escapes its own values
 * instead of trusting a check made somewhere else.
 *
 * ─── Each snippet is the vendor's own loader ─────────────────────────────────
 * The bodies below are the published bootstraps, reproduced rather than
 * invented: they install the platform's global (`fbq`, `ttq`, `snaptr`), queue
 * calls made before the real library arrives, and then load it asynchronously.
 * That queueing is the reason an event fired a fraction of a second after the
 * page opens is not lost, and the reason src/lib/tracking-events.ts can simply
 * check whether the global exists.
 *
 * ─── PageView is fired here, once ────────────────────────────────────────────
 * Every platform's initialisation reports the page view itself, so nothing else
 * in the codebase sends one. This is the "PageView" of the plan's step 2, and
 * it is deliberately the ONLY event that lives in a snippet — everything else
 * goes through `track()`, where one business event has one name per platform.
 *
 * Note this fires on mount and not again on client-side navigation. A rest
 * house opened from the results list reports `ViewProperty` with the listing's
 * own detail, which is the event a campaign is actually optimised on; adding a
 * synthetic second PageView on top would inflate every platform's traffic
 * figure against a real page count that never changed.
 *
 * ─── An empty configuration renders nothing ──────────────────────────────────
 * Each block is gated on its own id, so a site with one pixel loads one script
 * and a site with none serves exactly the HTML it served before this existed.
 */
export function TrackingScripts({ config }: { config: TrackingConfig }) {
  return (
    <>
      {/* Google Ads and GA4, on one gtag.js loader. */}
      <GoogleTag id={config.googleTagId} analyticsId={config.googleAnalyticsId} />

      {config.gtmContainerId && <GoogleTagManager id={config.gtmContainerId} />}
      {config.metaPixelId && <MetaPixel id={config.metaPixelId} />}
      {config.tiktokPixelId && <TikTokPixel id={config.tiktokPixelId} />}
      {config.snapchatPixelId && <SnapchatPixel id={config.snapchatPixelId} />}
    </>
  );
}

/**
 * Tag Manager.
 *
 * Its own component and its own column because a container is loaded by
 * `gtm.js`, not by `gtag/js?id=` — which is why /admin/tracking refuses a
 * "GTM-…" value in the Google tag field rather than accepting it and rendering
 * a script that quietly does nothing.
 *
 * The `<noscript>` iframe is part of Google's published snippet and is what
 * lets a container still fire for a visitor with JavaScript disabled. It has to
 * be real markup rather than a `next/script` body, so it is rendered directly.
 */
function GoogleTagManager({ id }: { id: string }) {
  return (
    <>
      <Script id="gtm-init" strategy="afterInteractive">
        {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer',${JSON.stringify(id)});`}
      </Script>
      <noscript>
        <iframe
          src={`https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(id)}`}
          height="0"
          width="0"
          style={{ display: "none", visibility: "hidden" }}
          title="Google Tag Manager"
        />
      </noscript>
    </>
  );
}

/** Meta (Facebook and Instagram) pixel — `fbq`. */
function MetaPixel({ id }: { id: string }) {
  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', ${JSON.stringify(id)});
fbq('track', 'PageView');`}
      </Script>
      {/* Meta's tracking pixel for visitors with JavaScript disabled. A bare
          <img>, not next/image: this is a 1×1 beacon that must be requested
          exactly as Meta serves it, and routing it through the optimiser would
          fetch it on the server instead of from the visitor's browser — which
          is the only place the request means anything. */}
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${encodeURIComponent(id)}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}

/** TikTok pixel — `ttq`. */
function TikTokPixel({ id }: { id: string }) {
  return (
    <Script id="tiktok-pixel" strategy="afterInteractive">
      {`!function (w, d, t) {
w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var s=d.createElement("script");s.type="text/javascript",s.async=!0,s.src=r+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(s,a)};
ttq.load(${JSON.stringify(id)});
ttq.page();
}(window, document, 'ttq');`}
    </Script>
  );
}

/** Snap Pixel — `snaptr`. */
function SnapchatPixel({ id }: { id: string }) {
  return (
    <Script id="snapchat-pixel" strategy="afterInteractive">
      {`(function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function(){
a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};
a.queue=[];var s='script';var r=t.createElement(s);r.async=!0;
r.src=n;var u=t.getElementsByTagName(s)[0];
u.parentNode.insertBefore(r,u);})(window,document,
'https://sc-static.net/scevent.min.js');
snaptr('init', ${JSON.stringify(id)});
snaptr('track', 'PAGE_VIEW');`}
    </Script>
  );
}
