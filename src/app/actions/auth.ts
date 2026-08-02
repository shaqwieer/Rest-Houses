"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
 */
async function landingFor(email: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { role: true },
  });
  return user?.role === "OWNER" ? "/owner" : "/admin";
}

export async function loginAction(formData: FormData): Promise<LoginResult> {
  const { t } = await getI18n();

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const requested = safeRedirect(formData.get("next"));

  if (!email || !password) {
    return { ok: false, error: t.auth.missingCredentials };
  }

  try {
    await signIn("credentials", { email, password, redirect: false });
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
  return { ok: true, redirectTo: requested ?? (await landingFor(email)) };
}

export async function logoutAction() {
  await signOut({ redirect: false });
  redirect("/");
}
