import { z } from "zod";
import { isValidPhone, normalizePhone, phoneProblem } from "./phone";
import type { Dictionary } from "./i18n";

/**
 * The field-level validators every server action shares.
 *
 * ─── Why these are central and not written per form ──────────────────────────
 * A phone number was validated in six places — registration, the admin's owner
 * editor, the owner's own profile, the booking form, the site's WhatsApp number
 * and the login — with four subtly different rules. Two counted digits with
 * `replace(/[^0-9]/g, "").length >= 9`, one delegated to the WhatsApp
 * normaliser, one only checked that the field was non-empty. So the same number
 * could be accepted by one form and refused by the next, and — worse — stored
 * in whichever shape it happened to be typed.
 *
 * That stopped being cosmetic when the owner's phone number became the thing
 * they sign in with: an owner who registers as "+971 50 332 2119" and later
 * types "0503322119" is the same person, and one of those two has to be the
 * stored username. These helpers make that decision once.
 *
 * Both emit the **canonical** value, not the typed one, so an action that uses
 * them writes normalised data without remembering to call the normaliser.
 * Kept out of src/lib/phone.ts on purpose: that module is imported by client
 * components for placeholders and hints, and it should not drag zod into the
 * browser bundle.
 */

/**
 * A phone number field. Accepts every shape people type, emits `971503322119`.
 *
 * Two distinct messages rather than one, because they ask the user for
 * different things: "incomplete" means keep typing, "invalid" means what you
 * typed cannot be a number at all.
 */
export function phoneField(t: Dictionary) {
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      const problem = phoneProblem(value);
      if (!problem) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          problem === "incomplete"
            ? t.validation.phoneIncomplete
            : t.validation.phoneInvalid,
      });
    })
    // Runs only once the refinement above is clean, so this never normalises a
    // value that was about to be rejected.
    .transform((value) => normalizePhone(value));
}

/**
 * A WhatsApp number — the same rules, one message.
 *
 * Kept distinct from `phoneField` for the message alone: this field is the one
 * that has to produce a working `wa.me` link, so it names WhatsApp and tells
 * the owner to include the country code rather than saying "incomplete".
 */
export function whatsappField(t: Dictionary) {
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (isValidPhone(value)) return;
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: t.validation.whatsappInvalid });
    })
    .transform((value) => normalizePhone(value));
}

/**
 * An optional phone field — "" stays "" rather than becoming a rejected empty
 * number. Used for the settings row's contact number, which an operator may
 * legitimately leave blank.
 */
export function optionalPhoneField(t: Dictionary) {
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (!value) return;
      if (isValidPhone(value)) return;
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: t.validation.phoneInvalid });
    })
    .transform((value) => (value ? normalizePhone(value) : ""));
}

/**
 * An email field. Lower-cased because `User.email` is unique and addresses are
 * case-insensitive in practice — without this, "Owner@x.ae" and "owner@x.ae"
 * are two accounts and the second one silently shadows the first at login.
 */
export function emailField(t: Dictionary) {
  return z.string().trim().toLowerCase().email(t.validation.invalidEmail).max(160);
}

/** The same, but blank-allowed for records where an address is optional. */
export function optionalEmailField(t: Dictionary) {
  return emailField(t).or(z.literal("")).default("");
}
