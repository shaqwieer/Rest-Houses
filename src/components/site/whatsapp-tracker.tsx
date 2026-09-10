"use client";

import { useEffect } from "react";
import { track } from "@/lib/tracking-events";

/**
 * Report every WhatsApp hand-off on the public site.
 *
 * ─── Why one listener and not a prop on each button ──────────────────────────
 * "Opened WhatsApp" is the plan's `WhatsApp Contact`, and on this site it is
 * the closest thing to an enquiry there is — but the button exists in nine
 * places: the header, the footer, the home page, /about, /faq, the sidebar card
 * on a listing, the mobile bar, the confirmation screen. Threading a handler
 * into each of them would mean nine chances to miss one, and every new
 * `wa.me` link added later would be missing by default.
 *
 * So this listens once, on the document, in the capture phase, and asks one
 * question of whatever was clicked: did it lead to WhatsApp? Nothing else in
 * the codebase has to know that WhatsApp clicks are measured.
 *
 * Both hosts are matched. Links are built as `api.whatsapp.com/send` (see the
 * note in src/lib/whatsapp.ts for why the `wa.me` alias had to go), but a
 * `wa.me` link pasted into a listing description or left in an older cached
 * page is the same enquiry and still counts. Matching only the current form
 * would have made this silently stop counting the moment the endpoint moved —
 * which is the failure this delegated listener exists to prevent.
 *
 * ─── Capture phase, and never preventing the click ───────────────────────────
 * Capture, because a handler on the element itself may stop propagation — the
 * confirmation screen's countdown wrapper deliberately does something like it
 * — and a click that never bubbles is still a click that opened WhatsApp. And
 * nothing here calls `preventDefault` or blocks: the navigation must happen
 * exactly as it would have, whether or not any pixel is loaded.
 *
 * ─── Mounted in the public shell only ────────────────────────────────────────
 * With the pixels themselves. The admin dashboard is full of WhatsApp links —
 * every request card has one — and an operator answering their queue is not an
 * enquiry.
 *
 * Renders nothing.
 */
export function WhatsappTracker() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;

      // `closest`, not the target itself: the click almost always lands on the
      // icon or the label inside the anchor.
      const link = target.closest("a");
      const href = link?.getAttribute("href") ?? "";
      const isWhatsapp =
        href.startsWith("https://api.whatsapp.com/send") ||
        href.startsWith("https://wa.me/");
      if (!isWhatsapp) return;

      // On a rest house's page, say which one — a "contacted about a listing"
      // audience is worth far more than an undifferentiated "contacted us".
      // The slug is the path segment; it is Arabic and percent-encoded in the
      // address bar, so it is decoded back to the value every other event uses.
      const match = window.location.pathname.match(/^\/listings\/([^/]+)/);
      let id: string | undefined;
      if (match) {
        try {
          id = decodeURIComponent(match[1]);
        } catch {
          // A malformed escape in the URL. The event is still worth reporting
          // without the listing attached.
          id = undefined;
        }
      }

      track("ContactWhatsapp", id ? { id } : {});
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
