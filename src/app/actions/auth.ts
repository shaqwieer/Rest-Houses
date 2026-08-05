"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { getI18n } from "@/lib/i18n/server";

/**
 * Sign-in / sign-out server actions.
 *
 * Wrapping `signIn` rather than posting to the NextAuth endpoint directly lets
 * us return an Arabic error message to the form instead of bouncing through a
 * `?error=CredentialsSignin` query string.
 */

export type LoginResult = { ok: false; error: string } | { ok: true; redirectTo: string };

/** Only same-origin paths may be used as a post-login redirect, so a crafted
 *  `?next=https://evil.example` link can't turn the login into an open redirect. */
function safeRedirect(next: unknown): string | null {
  if (typeof next !== "string" || !next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

/**
 * Where a given account lands after signing in.
 *
 * Owners go to /owner, which routes them onward to the dashboard or the status
 * page depending on whether they are approved. Sending every account to /admin
 * as before would drop an owner on a page they are not authorised for and
 * bounce them straight back to the login form.
 *
 * The `ownerProfile` check is not redundant with the role check: a `User` with
 * role "OWNER" and no profile belongs to neither dashboard, and naming one
 * anyway is how a sign-in used to end in a redirect loop rather than on a page.
 * /login is the honest answer, and it renders the form for such an account
 * instead of forwarding it — see `dashboardForSession` in src/lib/auth.ts.
 *
 * Takes the identifier in whichever form it was typed and resolves it the same
 * way `authorize()` did, so the account this lands on is by construction the
 * account that was just authenticated.
 */
async function landingFor(identifier: string): Promise<string> {
  const where = identifier.includes("@")
    ? { email: identifier.toLowerCase() }
    : { username: normalizePhone(identifier) };

  if ("username" in where && !where.username) return "/login";

  const user = await prisma.user.findUnique({
    where,
    select: { role: true, ownerProfile: { select: { id: true } } },
  });

  if (!user) return "/login";
  if (user.role === "ADMIN") return "/admin";
  return user.ownerProfile ? "/owner" : "/login";
}

export async function loginAction(formData: FormData): Promise<LoginResult> {
  const { t } = await getI18n();

  // One field for both kinds of account: an owner types their phone number,
  // the operator types their email. Deliberately NOT lower-cased here — that
  // happens inside `resolveAccount` on the email branch only, where it is
  // correct. Lower-casing a phone number is harmless but doing it up front
  // meant the raw value and the value that was looked up could differ, which
  // is the sort of near-miss this whole change exists to remove.
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const requested = safeRedirect(formData.get("next"));

  if (!identifier || !password) {
    return { ok: false, error: t.auth.missingCredentials };
  }

  try {
    await signIn("credentials", { identifier, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      // Deliberately generic: distinguishing "no such user" from "wrong
      // password" tells an attacker which emails are registered.
      return { ok: false, error: t.auth.invalidCredentials };
    }
    throw error;
  }

  // An explicit `?next=` wins — it is how the middleware returns someone to the
  // page they were trying to reach — but only after the credentials check, so a
  // failed login never reveals whether the target exists.
  return { ok: true, redirectTo: requested ?? (await landingFor(identifier)) };
}

export async function logoutAction() {
  await signOut({ redirect: false });
  redirect("/");
}
