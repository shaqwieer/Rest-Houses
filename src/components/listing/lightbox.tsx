"use client";

import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { arNum } from "@/lib/format";
import { useLocale } from "@/lib/i18n/provider";

/**
 * Full-screen photo viewer with pinch/double-tap zoom.
 *
 * ─── Why this is hand-rolled and not a carousel library ──────────────────────
 * The gallery's header note said the old plain hero-swap kept "another JS
 * dependency off the most-visited template on the site". That reasoning still
 * holds and it is why this is ~300 lines of pointer handling rather than an
 * import: the whole thing is behind a click, so it costs a lazily-loadable
 * chunk, while a carousel library would land on every listing page for everyone
 * — including the visitors who never open a photo.
 *
 * ─── The zoom, which is the actual requirement ───────────────────────────────
 * Three ways in, because people reach for different ones on a phone:
 *   • pinch with two fingers — scales about the midpoint between them, so the
 *     detail under your fingers stays under your fingers
 *   • double-tap — toggles between fit and 2.5×, centred on what was tapped
 *   • the +/− buttons — for a mouse, and for anyone who cannot pinch
 *
 * `touch-action: none` on the stage is load-bearing. Without it the browser
 * claims the gestures for its own page zoom and scroll, and none of the
 * handlers below ever fire on a real phone. The consequence is that this
 * component owns *all* panning while it is open, which is why the overlay also
 * locks body scroll: half-owned gestures are worse than either extreme.
 *
 * ─── Swipe vs. pan ───────────────────────────────────────────────────────────
 * One finger means "next photo" at fit scale and "move the photo" once zoomed
 * in. Those are the same gesture, so the mode is decided by the zoom level
 * rather than by direction-guessing — a pan that changed the photo halfway
 * through would make a zoomed image impossible to explore.
 */

export type LightboxImage = { id: string; url: string; alt: string };

/** Scale applied by a double-tap, and the ceiling for pinch. */
const ZOOM_STEP = 2.5;
const MAX_SCALE = 4;
const MIN_SCALE = 1;

/** Horizontal travel, in px, that counts as a deliberate swipe rather than a tap. */
const SWIPE_THRESHOLD = 60;

/** Two taps closer together than this, and near enough, are a double-tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 30;

export function Lightbox({
  images,
  index,
  onIndexChange,
  onClose,
  name,
}: {
  images: LightboxImage[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
  name: string;
}) {
  const { t, locale, dir } = useLocale();
  const isRtl = dir === "rtl";

  const stageRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Transform state. `scale` 1 means "fit"; offset is in CSS pixels and is only
  // ever non-zero while zoomed in.
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // Live pointers, keyed by pointerId. A Map rather than state: these change on
  // every pointermove and re-rendering per move would drop frames.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    startDistance: number;
    startScale: number;
    startOffset: { x: number; y: number };
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);

  const zoomed = scale > 1.01;
  const count = images.length;

  const resetTransform = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const go = useCallback(
    (delta: number) => {
      if (count < 2) return;
      // Wraps, so the last photo's "next" is the first rather than a dead
      // button — with a strip of eight the end is reached constantly.
      onIndexChange((index + delta + count) % count);
      resetTransform();
    },
    [count, index, onIndexChange, resetTransform],
  );

  /* ---------------------------------------------------------------- keyboard */

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "ArrowRight":
          e.preventDefault();
          // Arrow keys follow the reading direction, matching the on-screen
          // chevrons: in RTL the right arrow goes to the *previous* photo, the
          // same way the month chevrons work in the availability calendar.
          go(isRtl ? -1 : 1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          go(isRtl ? 1 : -1);
          break;
        case "+":
        case "=":
          e.preventDefault();
          setScale((s) => Math.min(MAX_SCALE, s + 0.5));
          break;
        case "-":
          e.preventDefault();
          setScale((s) => {
            const next = Math.max(MIN_SCALE, s - 0.5);
            if (next === MIN_SCALE) setOffset({ x: 0, y: 0 });
            return next;
          });
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, isRtl, onClose]);

  /* ------------------------------------------------- body scroll + focus trap */

  useLayoutEffect(() => {
    // The overlay owns the viewport while it is open. Without this the page
    // behind it scrolls under the photo on iOS, and closing the viewer leaves
    // the visitor somewhere they never navigated to.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    // Focus moves into the dialog so the first Tab lands on a control inside it
    // and Escape reaches the handler above even when the click that opened it
    // came from a thumbnail deep in the page.
    closeRef.current?.focus();
  }, []);

  function onTrapKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;

    const focusables = overlayRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables || focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // A modal that lets Tab escape into the page behind it is a modal only for
    // people using a mouse.
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* ----------------------------------------------------------------- pointers */

  function distanceBetween(points: { x: number; y: number }[]) {
    const [a, b] = points;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const points = [...pointers.current.values()];
    gesture.current = {
      startDistance: points.length === 2 ? distanceBetween(points) : 0,
      startScale: scale,
      startOffset: offset,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const g = gesture.current;
    if (!g) return;

    const points = [...pointers.current.values()];

    // --- two fingers: pinch ---
    if (points.length === 2 && g.startDistance > 0) {
      const ratio = distanceBetween(points) / g.startDistance;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, g.startScale * ratio));
      setScale(next);
      g.moved = true;
      if (next === MIN_SCALE) setOffset({ x: 0, y: 0 });
      return;
    }

    // --- one finger, zoomed in: pan ---
    if (points.length === 1 && g.startScale > 1.01) {
      setOffset({
        x: g.startOffset.x + (e.clientX - g.startX),
        y: g.startOffset.y + (e.clientY - g.startY),
      });
      g.moved = true;
      return;
    }

    // --- one finger, fit: swipe. Only the flag is set here; the photo changes
    // on release, so a hesitant drag that comes back is not a page turn. ---
    if (points.length === 1 && Math.abs(e.clientX - g.startX) > 8) {
      g.moved = true;
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);

    if (!g) return;

    // A swipe only counts while the photo is at fit scale — see the note at the
    // top about why the mode is decided by zoom rather than by direction.
    if (pointers.current.size === 0 && !zoomed && g.startScale <= 1.01) {
      const travel = e.clientX - g.startX;

      if (Math.abs(travel) >= SWIPE_THRESHOLD) {
        // Dragging the photo leftwards pulls the next one in from the right —
        // in RTL the strip runs the other way, so the same drag means the
        // opposite photo. Mirroring this is the difference between a gallery
        // that feels native in Arabic and one that fights the reader.
        const forward = isRtl ? travel > 0 : travel < 0;
        go(forward ? 1 : -1);
        gesture.current = null;
        return;
      }

      // Not a swipe → treat as a tap, and check for a double.
      if (!g.moved) {
        const now = Date.now();
        const prev = lastTap.current;
        const isDouble =
          prev !== null &&
          now - prev.time < DOUBLE_TAP_MS &&
          Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_SLOP;

        if (isDouble) {
          zoomAt(e.clientX, e.clientY);
          lastTap.current = null;
        } else {
          lastTap.current = { time: now, x: e.clientX, y: e.clientY };
        }
      }
    }

    // A double-tap while already zoomed returns to fit — the way out has to be
    // the same gesture as the way in, or a zoomed photo becomes a trap on a
    // phone with no visible keyboard.
    if (pointers.current.size === 0 && zoomed && !g.moved) {
      const now = Date.now();
      const prev = lastTap.current;
      if (prev && now - prev.time < DOUBLE_TAP_MS) {
        resetTransform();
        lastTap.current = null;
      } else {
        lastTap.current = { time: now, x: e.clientX, y: e.clientY };
      }
    }

    if (pointers.current.size === 0) gesture.current = null;
  }

  /** Zoom in about a point, keeping what is under it roughly under it. */
  function zoomAt(clientX: number, clientY: number) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) {
      setScale(ZOOM_STEP);
      return;
    }

    // Distance from the centre of the stage to the tapped point. Scaling
    // happens about the centre, so shifting by that distance × (scale − 1)
    // brings the tapped detail back to the middle.
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);

    setScale(ZOOM_STEP);
    setOffset({ x: -dx * (ZOOM_STEP - 1), y: -dy * (ZOOM_STEP - 1) });
  }

  const image = images[index];
  if (!image) return null;

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onKeyDown={onTrapKeyDown}
      className="fixed inset-0 z-[300] flex flex-col bg-night-900/97 backdrop-blur-sm"
    >
      {/* ---- top bar ---- */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        {/* "صورة ١ من ٥" / "Photo 1 of 5" rather than "1 / 5".
            A bare "n / m" is two Arabic-Indic numerals either side of a neutral
            slash, which the bidi algorithm reorders inside an RTL page: the
            counter rendered as "٥ / ١" — five of one. `dir="ltr"` on the span
            did not save it, because Arabic-Indic digits are class AN and the
            slash between them is a common separator that joins the whole thing
            into one run. Words on both sides anchor the direction, and read
            better in either language than a fraction does. */}
        <span className="text-[13px] font-bold text-sand-100/80">
          {t.gallery.imagePosition(arNum(index + 1, locale), arNum(count, locale))}
        </span>

        <div className="flex items-center gap-1.5">
          <ControlButton
            onClick={() =>
              setScale((s) => {
                const next = Math.max(MIN_SCALE, s - 0.5);
                if (next === MIN_SCALE) setOffset({ x: 0, y: 0 });
                return next;
              })
            }
            disabled={scale <= MIN_SCALE}
            icon="remove"
            label={t.gallery.zoomOut}
          />
          <ControlButton
            onClick={() => setScale((s) => Math.min(MAX_SCALE, s + 0.5))}
            disabled={scale >= MAX_SCALE}
            icon="add"
            label={t.gallery.zoomIn}
          />
          <ControlButton
            ref={closeRef}
            onClick={onClose}
            icon="close"
            label={t.gallery.closeViewer}
          />
        </div>
      </div>

      {/* ---- stage ---- */}
      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // `touch-none` hands every gesture to the handlers above. Without it the
        // browser's own pinch-zoom and scroll take them first and none of this
        // works on a phone — see the note at the top of the file.
        className="relative min-h-0 flex-1 touch-none overflow-hidden select-none"
      >
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            // Animated only when settling back, never mid-pinch: a transition
            // during a gesture lags a finger by its own duration.
            transition: gesture.current ? "none" : "transform 180ms ease-out",
            cursor: zoomed ? "grab" : "zoom-in",
          }}
        >
          <Image
            key={image.id}
            src={image.url}
            alt={image.alt || name}
            fill
            sizes="100vw"
            // `contain`, not `cover`: this is the view a guest opens to see the
            // whole room, so nothing may be cropped away at fit scale.
            className="object-contain"
            // Not `priority` — the page's LCP is the hero in the gallery below,
            // and marking this too would have them compete for the same budget.
            draggable={false}
          />
        </div>
      </div>

      {/* ---- prev / next ---- */}
      {count > 1 && (
        <>
          <EdgeButton
            side="start"
            onClick={() => go(isRtl ? 1 : -1)}
            icon={isRtl ? "chevron_right" : "chevron_left"}
            label={t.gallery.previousImage}
          />
          <EdgeButton
            side="end"
            onClick={() => go(isRtl ? -1 : 1)}
            icon={isRtl ? "chevron_left" : "chevron_right"}
            label={t.gallery.nextImage}
          />
        </>
      )}

      {/* ---- thumbnail strip ---- */}
      {count > 1 && (
        <div className="no-scrollbar flex shrink-0 gap-2 overflow-x-auto px-4 py-3">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => {
                onIndexChange(i);
                resetTransform();
              }}
              aria-label={t.gallery.imageNumber(arNum(i + 1, locale))}
              aria-current={i === index}
              className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                i === index ? "border-gold-500" : "border-transparent opacity-55 hover:opacity-100"
              }`}
            >
              <Image src={img.url} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* One line, shown only where the gesture exists, so a desktop visitor is
          not told to pinch a screen they cannot pinch. */}
      <p className="m-0 pb-3 text-center text-[11.5px] text-sand-100/40 md:hidden">
        {t.gallery.zoomHint}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ControlButton({
  ref,
  onClick,
  disabled,
  icon,
  label,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  onClick: () => void;
  disabled?: boolean;
  icon: "add" | "remove" | "close";
  label: string;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-10 place-items-center rounded-full bg-sand-100/10 text-sand-100 transition enabled:hover:bg-sand-100/20 disabled:opacity-30"
    >
      <Icon name={icon} size={20} />
    </button>
  );
}

function EdgeButton({
  side,
  onClick,
  icon,
  label,
}: {
  side: "start" | "end";
  onClick: () => void;
  icon: "chevron_left" | "chevron_right";
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      // Logical `start`/`end` rather than left/right so the pair flips with the
      // page direction along with the chevrons inside them.
      className={`absolute top-1/2 hidden -translate-y-1/2 place-items-center rounded-full bg-sand-100/10 p-3 text-sand-100 transition hover:bg-sand-100/20 sm:grid ${
        side === "start" ? "start-4" : "end-4"
      }`}
    >
      <Icon name={icon} size={24} />
    </button>
  );
}
