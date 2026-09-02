"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/lib/i18n/provider";

/**
 * "Share" — beside the rest house's Instagram link in the title block.
 *
 * ─── What it shares, and why not this page's own URL ─────────────────────────
 * The short /r/<shortId> form. The canonical URL is an Arabic slug (deliberately
 * — see src/lib/slug.ts), which means `location.href`, and anything copied out
 * of the address bar, is the percent-encoded form: a wall of %D8%A7 that looks
 * broken in a WhatsApp message. The short link is ASCII, fits on one line, and
 * lands the recipient on the same canonical page via src/app/r/[code]/route.ts.
 *
 * ─── Why an anchor and not a button ──────────────────────────────────────────
 * So it renders on the server. The obvious shape — a `<button>` gated on a
 * `typeof navigator.share` check — cannot run that check during render
 * (`navigator` does not exist there, and branching on it would desync
 * hydration), so the control has to appear in an effect, and the whole row of
 * pills visibly shifts a beat after the page paints.
 *
 * An anchor to the share URL is correct markup with no capability check at all:
 * it is in the first HTML, it has a real href to right-click, and the click
 * handler upgrades it to the native share sheet or the clipboard. Following it
 * unenhanced just redirects back to this page, so the degraded case is a no-op
 * rather than a dead end.
 */
export function ShareButton({ url, title }: { url: string; title: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A guest who taps share and navigates away before the confirmation clears
  // would otherwise leave a timer holding a setState on an unmounted component.
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function confirmCopied() {
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  async function onClick(event: React.MouseEvent<HTMLAnchorElement>) {
    // Let a modified click (new tab, "copy link address") do the browser's
    // thing — the href is the very link the guest is trying to get hold of.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

    if (typeof navigator.share !== "function" && !navigator.clipboard?.writeText) return;

    event.preventDefault();

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // Dismissing the sheet rejects with AbortError. That is a completed
        // interaction, not a failure — copying the link the guest just decided
        // not to send would be the wrong answer. Any other rejection is a real
        // failure and does fall through to the clipboard.
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      // A copy with no feedback reads as a click that did nothing.
      confirmCopied();
    } catch {
      // Clipboard permission refused. Silent: there is no useful recovery, and
      // an error toast over a share button is noise.
    }
  }

  return (
    <a
      href={url}
      onClick={onClick}
      // Matches the Instagram pill beside it exactly, so the two read as one row
      // of secondary actions rather than a link and a control that happen to be
      // adjacent.
      className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] font-bold text-bronze no-underline transition hover:border-gold-500 hover:bg-gold-100 hover:no-underline"
    >
      <Icon name={copied ? "check" : "share"} size={17} />
      {copied ? t.listing.shareCopied : t.listing.share}
    </a>
  );
}
