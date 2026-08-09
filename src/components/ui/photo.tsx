"use client";

import Image, { type ImageProps } from "next/image";
import { useCallback, useState } from "react";
import clsx from "clsx";

/**
 * A listing photo that does not pop in.
 *
 * ─── What was wrong with a bare `next/image` ────────────────────────────────
 * Nothing, technically — it lazy-loads and serves a right-sized file already.
 * But until the bytes arrive the slot is *empty*: on the results grid, someone
 * scrolling on a phone over a Gulf mobile connection sees a column of blank
 * rectangles filling in one by one, and a page that is loading correctly looks
 * like a page that is broken.
 *
 * So the slot is never empty. A shimmering placeholder is painted over it from
 * first paint and fades away once the image has decoded. Nothing about the
 * layout moves: every caller already reserves the box with a sized, positioned
 * parent, so this changes what occupies the space, not how much.
 *
 * ─── The placeholder fades, not the image ───────────────────────────────────
 * The obvious build is `opacity-0 → opacity-100` on the `<Image>` itself. It is
 * wrong here, and subtly: callers pass their own classes through — the results
 * card passes `transition duration-500 group-hover:scale-[1.03]` — and
 * `transition-opacity` sets the same CSS property (`transition-property`) as
 * `transition`. Whichever Tailwind emits later wins, so adding the fade would
 * silently disable the hover animation on the card, or not fade, depending on
 * class order. Fading a separate overlay leaves the caller's classes untouched.
 *
 * ─── Why a shimmer and not a blurred thumbnail ──────────────────────────────
 * `next/image` supports `blurDataURL`, and with sharp now running on upload we
 * could generate a 20px preview per photo. Rejected for now: it needs a column
 * on `ListingImage`, a backfill for every existing photo, and a few hundred
 * base64 bytes per card in the HTML of every grid — on a twelve-card page, more
 * added weight than the shimmer costs. The shimmer is CSS-only, works for
 * photos uploaded before it existed, and needs no migration. `blurDataURL`
 * remains the upgrade if a real blur is ever wanted.
 */
export function Photo({
  className,
  alt,
  ...rest
}: Omit<ImageProps, "onLoad" | "onError">) {
  const [settled, setSettled] = useState(false);

  /**
   * A cached image can finish decoding before React attaches `onLoad`, and then
   * the event never fires and the placeholder sits over a perfectly good photo
   * forever. This is the standard guard: on mount, ask the element whether it
   * is already done. It is why the ref is a callback rather than `useRef`.
   */
  const check = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete) setSettled(true);
  }, []);

  return (
    <>
      <Image
        {...rest}
        alt={alt}
        ref={check}
        className={className}
        onLoad={() => setSettled(true)}
        // A photo whose bytes have gone — a storage driver switched with old
        // rows still pointing at /uploads/… — would otherwise leave the broken
        // image glyph under a permanent shimmer. Clearing the placeholder shows
        // the browser's own empty state, which at least stops animating.
        onError={() => setSettled(true)}
      />
      {/* Always rendered, never conditionally — unmounting it would remove the
          element mid-transition and the fade would never run, leaving the
          placeholder to vanish in one frame. Toggling opacity on a mounted
          element is what actually animates. `pointer-events-none` so the
          invisible overlay cannot swallow a click on the card beneath. */}
      <span
        aria-hidden
        className={clsx(
          "photo-skeleton pointer-events-none absolute inset-0 block",
          "transition-opacity duration-500 ease-out",
          settled ? "opacity-0" : "opacity-100",
        )}
      />
    </>
  );
}
