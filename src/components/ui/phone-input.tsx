"use client";

import type { ComponentProps, FocusEvent } from "react";
import { TextInput } from "./field";
import { normalizePhone, PHONE_EXAMPLE } from "@/lib/phone";

/**
 * The one phone control on the site.
 *
 * Every phone field — registration, the owner's profile, the admin's owner
 * editor, the booking form, the site's own WhatsApp number — renders this (or
 * spreads `phoneFieldProps` onto its own input), so they all teach the same
 * format and all submit the same shape.
 *
 * ─── What it actually does ───────────────────────────────────────────────────
 * Typing is left alone. People paste numbers out of their contacts with spaces,
 * dashes and a leading "+", and fighting the keystroke is how a phone field
 * ends up impossible to correct mid-word. Instead the value is normalised **on
 * blur**: whatever was typed becomes `971503322119` the moment the field loses
 * focus.
 *
 * That is a deliberate teaching move, not just tidiness. An owner's phone
 * number is now the username they sign in with, so the field has to *show* them
 * the exact string that becomes their login — a form that silently accepted
 * "+971 50 332 2119" and stored something else would leave them typing a
 * username they had never seen. Normalising in front of them closes that gap.
 *
 * The server re-normalises and re-validates regardless (see `phoneField` in
 * src/lib/validation.ts). Nothing here is trusted; this is only about what the
 * person filling in the form sees.
 *
 * ─── Why it stays uncontrolled ───────────────────────────────────────────────
 * Every form that uses it is uncontrolled — the inputs start from `defaultValue`
 * and the action reads a `FormData`. Holding this one field in React state
 * instead would make it the odd one out in the admin's owner dialog, whose two
 * tabs deliberately remount their forms (see the `key` note in
 * owner-actions.tsx): the remount resets every other field to the owner's real
 * record while a stateful phone field would keep a half-typed value. So the
 * normalisation writes straight to the DOM node, which is what `FormData` reads
 * on submit anyway.
 */

/** Normalise in place, on blur. Exported for inputs that style themselves. */
function normalizeOnBlur(event: FocusEvent<HTMLInputElement>) {
  // Only rewrite the field when the input actually parses. Blurring out of a
  // half-typed number must not blank it — that would destroy work the moment
  // someone tabbed away to check their own number.
  const normalized = normalizePhone(event.target.value);
  if (normalized) event.target.value = normalized;
}

/**
 * Props for a phone `<input>`. Spread last so the caller keeps its own `name`,
 * `required` and class:
 *
 *     <input name="phone" className={inputClass} {...phoneFieldProps(account.phone)} />
 */
export function phoneFieldProps(defaultValue?: string | null) {
  return {
    type: "tel" as const,
    // Latin digits and LTR regardless of page direction: a phone number is a
    // numeric identifier, and mirroring it in an RTL paragraph makes it
    // unreadable. `inputMode="tel"` gives the right keypad on a phone.
    dir: "ltr" as const,
    inputMode: "tel" as const,
    placeholder: PHONE_EXAMPLE,
    defaultValue: normalizePhone(String(defaultValue ?? "")),
    onBlur: normalizeOnBlur,
  };
}

export function PhoneInput({
  defaultValue,
  ...rest
}: Omit<ComponentProps<typeof TextInput>, "type" | "value" | "defaultValue"> & {
  defaultValue?: string | null;
}) {
  return <TextInput {...phoneFieldProps(defaultValue)} {...rest} />;
}
