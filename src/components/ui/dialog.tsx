"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The one modal overlay. Rendered through a portal into `document.body`.
 *
 * ─── Why the portal is the whole point ───────────────────────────────────────
 * Three copies of this overlay used to live inline inside the card they belonged
 * to, each written `fixed inset-0 … grid place-items-center`. That reads as
 * "cover the viewport and centre in it", and it is what the CSS says — right up
 * until an ancestor owns a `transform`, `filter`, `backdrop-filter`,
 * `perspective`, `contain` or `will-change`. Any one of those makes that
 * ancestor the containing block for every `position: fixed` descendant, and
 * `inset-0` silently stops meaning the viewport and starts meaning *that box*.
 *
 * Which is exactly what was reported: on a long list of booking requests the
 * confirm dialog appeared in the middle of the *page* instead of the middle of
 * the screen, so pressing delete on the last card popped a dialog the operator
 * had to scroll up to find. Every admin page wraps its content in
 * `animate-fade-up`, whose keyframes animate `transform` with `fill-mode: both`
 * — the strongest suspect, and the reason the symptom scaled with list length.
 *
 * The fix deliberately does not depend on identifying the culprit. A portal
 * leaves the component tree entirely and mounts on `document.body`, so no
 * ancestor of the *React* tree is an ancestor in the *DOM* tree, and no style
 * anyone adds to a card, a grid or a page wrapper later can reach it. Chasing
 * the individual property would have fixed today's three screens and left the
 * next one to be found by a user again.
 *
 * ─── What it does beyond escaping the tree ───────────────────────────────────
 * Being the single place a modal is drawn is what makes the rest affordable.
 * The inline copies had none of it: no role, no Escape, no scroll lock, and the
 * page behind them scrolled freely while they were open.
 *
 * A focus *trap* is deliberately not here. Focus moves into the dialog and
 * returns to the trigger on close, which is what makes the keyboard and a
 * screen reader usable; preventing Tab from ever leaving needs a good deal more
 * machinery than these short confirmations justify.
 */
export function Dialog({
  open,
  onClose,
  label,
  wide = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name. The visible heading is free to be rich JSX. */
  label?: string;
  /** A dialog carrying a whole form rather than a sentence and two buttons. */
  wide?: boolean;
  children: ReactNode;
}) {
  // `document` does not exist while this renders on the server. Every one of
  // these opens from a click and so is only ever mounted in the browser, but
  // the guard costs nothing and means a caller that later renders one open on
  // first paint gets an empty first frame rather than a crash.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  // `onClose` is almost always an inline arrow at the call site, so it is a new
  // function on every render. Depending on it directly would tear down and
  // rebuild the effect below on each one — re-running the cleanup, which throws
  // focus back to the trigger button mid-dialog. The ref keeps the latest
  // handler without making the effect care that it changed.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    // Waits for `mounted` as well as `open`: until the portal is really in the
    // document there is no panel to move focus to.
    if (!open || !mounted) return;

    // Remembered before focus moves, restored in the cleanup below, so
    // dismissing a confirmation puts the caret back on the button that opened
    // it rather than at the top of the document.
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);

    // Same treatment the mobile navigation sheet gives itself — a dialog you
    // can scroll the page under feels broken on a phone. The previous value is
    // captured rather than assumed to be "", so restoring cannot clobber a
    // lock some other component set.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      restoreFocusTo.current?.focus?.();
    };
  }, [open, mounted]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-300 grid place-items-center overflow-y-auto bg-night-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        // Focusable so `panelRef.current.focus()` above lands somewhere, and so
        // the keydown listener has the dialog rather than the page behind it as
        // the active element. -1 keeps it out of the Tab order itself.
        tabIndex={-1}
        className={`animate-pop-in w-full ${
          // The wide dialog is anchored to the top instead of centred. Its two
          // tabs are very different heights — seven fields against two — and
          // centring re-positioned the whole dialog on every switch, moving the
          // tab bar ~150px out from under the pointer. The second click then
          // landed on the backdrop and closed the dialog, discarding whatever
          // had been typed.
          //
          // `self-start` is what does the work: the parent is
          // `place-items-center`, so a margin alone cannot top-anchor a grid
          // item — align-self has to be overridden for the offset to mean
          // anything. The short confirmations keep the centred treatment.
          wide ? "max-w-140 self-start my-8" : "max-w-100 my-auto"
        } rounded-[24px] border border-line bg-surface p-5 text-start shadow-e2 outline-none`}
        // Stops a click inside the dialog from reaching the backdrop's handler
        // and closing it — a half-typed rejection reason should survive a stray
        // click on the textarea.
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * "Are you sure?" — the shape both destructive confirmations share.
 *
 * The two of them (delete a booking request, delete a rest house) had drifted
 * apart while being the same dialog: different max widths, one disabling its
 * cancel button while an action was in flight and the other not. Neither
 * difference was a decision. The stricter of each pair is kept — a cancel that
 * stays live during the delete would dismiss the dialog while the request it
 * started is still running.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  pending = false,
  icon,
  title,
  body,
  confirmLabel,
  cancelLabel,
  label,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Disables both buttons while the server action is in flight. */
  pending?: boolean;
  /** Optional emblem above the heading. */
  icon?: ReactNode;
  /** Rich, so a heading can carry an `<span dir="ltr">` reference number. */
  title: ReactNode;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** Plain-text accessible name, since `title` may be JSX. */
  label?: string;
}) {
  return (
    <Dialog open={open} onClose={onClose} label={label}>
      {icon ? (
        <div className="mx-auto mb-3.5 grid size-14 place-items-center rounded-full bg-busy-bg">
          {icon}
        </div>
      ) : null}

      <h2 className="m-0 mb-2 text-center font-display text-[17px] font-extrabold text-ink">
        {title}
      </h2>
      <p className="m-0 mb-4.5 text-center text-[13.5px] leading-relaxed text-muted">{body}</p>

      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="flex-1 rounded-2xl bg-busy p-3.5 text-[14px] font-bold text-white disabled:opacity-60"
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="rounded-2xl border border-line bg-surface px-5 py-3.5 text-[14px] font-bold text-ink disabled:opacity-60"
        >
          {cancelLabel}
        </button>
      </div>
    </Dialog>
  );
}
