"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth";

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
function safeRedirect(next: unknown): string {
  if (typeof next !== "string") return "/admin";
  if (!next.startsWith("/") || next.startsWith("//")) return "/admin";
  return next;
}

export async function loginAction(formData: FormData): Promise<LoginResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = safeRedirect(formData.get("next"));

  if (!email || !password) {
    return { ok: false, error: "الرجاء إدخال البريد الإلكتروني وكلمة المرور" };
  }

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      // Deliberately generic: distinguishing "no such user" from "wrong
      // password" tells an attacker which emails are registered.
      return { ok: false, error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" };
    }
    throw error;
  }

  return { ok: true, redirectTo };
}

export async function logoutAction() {
  await signOut({ redirect: false });
  redirect("/");
}
