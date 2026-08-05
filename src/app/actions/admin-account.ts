"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin, AuthorizationError } from "@/lib/auth";
import { auditData } from "@/lib/audit";
import { emailField } from "@/lib/validation";
import { getI18n } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n";
import type { ActionResult } from "./listings";

/**
 * The operator's own account — their name, their sign-in email, their password.
 *
 * ─── Why this is not `updateOwnerAccount` with a different guard ─────────────
 * Those actions are an admin acting on *somebody else's* account: an operator
 * resetting a locked-out owner's password has, by definition, no way to supply
 * that owner's current one, so `setOwnerPassword` does not ask for it. Copying
 * that shape here would be a real security hole rather than a stylistic one.
 *
 * Editing your own credentials is the case where the current password IS
 * available, and where not asking for it is dangerous: an unattended terminal,
 * a stolen session cookie or a CSRF hole would otherwise convert into permanent
 * account takeover — the attacker sets a new password and the real operator is
 * locked out of the platform with no way back that does not involve a database
 * shell. Requiring the current password means a session alone is not enough.
 *
 * That is the one substantive rule here. Everything else follows the patterns
 * already established: schemas built per request so their messages are
 * translated, uniqueness checked before writing so it lands on the field,
 * and every change written in the same transaction as its audit row.
 */

function detailsSchema(t: Dictionary) {
  return z.object({
    name: z.string().trim().min(2, t.validation.nameTooShort).max(120),
    email: emailField(t),
  });
}

/**
 * Edit the signed-in operator's name and sign-in email.
 *
 * No `role` and no `username`. Role is deliberately absent — an admin form that
 * accepts a role is an admin form that can demote the last admin and leave the
 * platform with nobody who can administer it. `username` is absent because the
 * operator signs in with an email; the phone-number username belongs to owners
 * and is derived from their profile, which an operator does not have.
 */
export async function updateAdminProfile(formData: FormData): Promise<ActionResult> {
  const { t } = await getI18n();

  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return unauthorizedResult(error, t);
  }

  const parsed = detailsSchema(t).safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { ok: false, error: t.validation.checkFields, fieldErrors: fieldErrorsOf(parsed) };
  }

  const data = parsed.data;

  // Checked here rather than caught as a P2002, so the operator is told which
  // field is wrong instead of "couldn't save". `id: { not: … }` so saving the
  // form without touching the email never reports a clash with yourself.
  if (data.email !== admin.email) {
    const clash = await prisma.user.findFirst({
      where: { email: data.email, id: { not: admin.id } },
      select: { id: true },
    });
    if (clash) {
      return {
        ok: false,
        error: t.validation.emailTaken,
        fieldErrors: { email: t.validation.emailTaken },
      };
    }
  }

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: admin.id },
        data: { name: data.name, email: data.email },
      }),
      prisma.auditLog.create({
        data: auditData({
          actor: { id: admin.id, email: admin.email, role: admin.role },
          action: "ADMIN_ACCOUNT_UPDATED",
          entityType: "User",
          entityId: admin.id,
          summary: data.name,
          // What moved, not the whole record. An operator reading the log wants
          // to see that the sign-in address changed and to what.
          metadata: { emailFrom: admin.email, emailTo: data.email },
        }),
      }),
    ]);
  } catch (error) {
    console.error("updateAdminProfile failed:", error);
    return { ok: false, error: t.validation.saveFailed };
  }

  // The header greets the operator by name, and it is rendered by the admin
  // layout — so the change has to invalidate the layout, not just this page.
  revalidatePath("/admin", "layout");
  return { ok: true, message: t.admin.accountUpdated };
}

/**
 * Change the signed-in operator's own password.
 *
 * ─── The current password is mandatory, and verified against the database ────
 * Not against the session, which asserts only that *someone* holds a valid
 * cookie. See the note at the top of this file for why that distinction is the
 * whole point of this action.
 *
 * ─── What this does and does not invalidate ──────────────────────────────────
 * Sessions are 30-day JWTs with no server-side session table, so an operator
 * signed in elsewhere stays signed in until their token expires: changing the
 * password stops the *old password* working, not an existing session. That is a
 * real limitation and is stated rather than papered over — an operator who
 * believes their session has been stolen needs `AUTH_SECRET` rotated, which
 * invalidates every token at once. The same trade-off is documented on
 * `setOwnerPassword` in src/app/actions/owners.ts.
 */
export async function changeAdminPassword(
  currentPassword: string,
  password: string,
  confirmPassword: string,
): Promise<ActionResult> {
  const { t } = await getI18n();

  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return unauthorizedResult(error, t);
  }

  const parsed = z
    .object({
      currentPassword: z.string().min(1, t.validation.currentPasswordRequired),
      // Bounds identical to every other password field on the platform, so an
      // operator cannot set one their own sign-in form would then reject.
      password: z.string().min(8, t.validation.passwordTooShort).max(200),
      confirmPassword: z.string(),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: t.validation.passwordMismatch,
      path: ["confirmPassword"],
    })
    // A new password identical to the current one is a no-op the operator
    // almost certainly did not intend — usually a half-finished edit.
    .refine((d) => d.password !== d.currentPassword, {
      message: t.validation.passwordUnchanged,
      path: ["password"],
    })
    .safeParse({ currentPassword, password, confirmPassword });

  if (!parsed.success) {
    return { ok: false, error: t.validation.checkFields, fieldErrors: fieldErrorsOf(parsed) };
  }

  // Read the hash fresh rather than trusting anything the guard returned: this
  // is the one comparison the whole action rests on.
  const account = await prisma.user.findUnique({
    where: { id: admin.id },
    select: { passwordHash: true },
  });
  if (!account) {
    return { ok: false, error: t.validation.unauthorized };
  }

  const currentOk = await bcrypt.compare(parsed.data.currentPassword, account.passwordHash);
  if (!currentOk) {
    return {
      ok: false,
      error: t.validation.currentPasswordWrong,
      fieldErrors: { currentPassword: t.validation.currentPasswordWrong },
    };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  try {
    await prisma.$transaction([
      prisma.user.update({ where: { id: admin.id }, data: { passwordHash } }),
      prisma.auditLog.create({
        data: auditData({
          actor: { id: admin.id, email: admin.email, role: admin.role },
          action: "ADMIN_PASSWORD_CHANGED",
          entityType: "User",
          entityId: admin.id,
          summary: admin.name ?? admin.email,
          // That it happened, and to which account. Never the password itself —
          // not here, not in a log line, not in the result message.
          metadata: { email: admin.email },
        }),
      }),
    ]);
  } catch (error) {
    console.error("changeAdminPassword failed:", error);
    return { ok: false, error: t.validation.saveFailed };
  }

  revalidatePath("/admin/account");
  return { ok: true, message: t.admin.accountPasswordChanged };
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

function fieldErrorsOf(parsed: { error: z.ZodError }): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

/** A guard failure becomes a translated result rather than a 500. */
function unauthorizedResult(error: unknown, t: Dictionary): ActionResult {
  if (error instanceof AuthorizationError) {
    return { ok: false, error: t.validation.unauthorized };
  }
  throw error;
}
