import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "./prisma";
import { isOwnerActive } from "./owners";
import { redirect } from "next/navigation";

/**
 * NextAuth (v5) — a single admin login with email + password.
 *
 * Sessions are JWTs, not database rows: there is one operator, so a session
 * table would be pure overhead, and JWT sessions let `middleware.ts` authorise
 * /admin at the edge without a database round-trip per request.
 *
 * The password is verified with bcrypt against `User.passwordHash`. Plain
 * passwords exist only in `.env` (for seeding) and in the login form POST.
 */

declare module "next-auth" {
  interface Session {
    user: { id: string; role: string } & DefaultSession["user"];
  }
  interface User {
    role?: string;
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, signIn, signOut, auth } = NextAuth({
  // AUTH_SECRET is read automatically; fail loudly in prod if it's missing.
  trustHost: true,

  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 }, // 30 days

  pages: {
    signIn: "/login",
    error: "/login",
  },

  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "البريد الإلكتروني", type: "email" },
        password: { label: "كلمة المرور", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const email = parsed.data.email.trim().toLowerCase();
        const user = await prisma.user.findUnique({ where: { email } });

        // Compare even when the user is missing, against a dummy hash, so a
        // wrong email and a wrong password take the same time to reject and
        // the endpoint can't be used to enumerate valid accounts.
        const hash =
          user?.passwordHash ??
          "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu";

        const ok = await bcrypt.compare(parsed.data.password, hash);
        if (!ok || !user) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? user.email,
          role: user.role,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = user.role ?? "ADMIN";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.sub ?? "");
        session.user.role = String(token.role ?? "ADMIN");
      }
      return session;
    },
  },
});

/* -------------------------------------------------------------------------- */
/* Authorisation guards                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Thrown by every guard below. Callers convert it into a translated message;
 * nothing should let it escape to the user as a raw stack trace.
 */
export class AuthorizationError extends Error {
  constructor(
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "OWNER_INACTIVE",
    message = code,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** Any signed-in account. Rarely what you want on its own — prefer a role guard. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AuthorizationError("UNAUTHENTICATED");
  }
  return session.user;
}

/**
 * Guard for the admin dashboard and every admin server action.
 *
 * ─── Why the role is re-read from the database ───────────────────────────────
 * This function used to check only that *a* session existed. That was correct
 * when ADMIN was the only role: anyone who could sign in was the operator.
 * The moment owners can sign in at the same /login, "has a session" stops
 * meaning "is an admin" — an owner's cookie would sail through this check and
 * straight into `saveListing`, `deleteListing`, `setRequestStatus` and the
 * settings actions, against *any* listing on the platform.
 *
 * The role is read from the database rather than the JWT because sessions last
 * 30 days. A token minted before a role change keeps asserting the old role
 * for the rest of its life; the database is the only thing that is current.
 * That is one indexed primary-key lookup per privileged action — the right
 * price for an authorisation decision.
 *
 * `middleware.ts` already redirects anyone without a session cookie, but it
 * only checks that a cookie *exists*. A server action can also be invoked
 * directly by anyone who knows its id, bypassing navigation entirely. This is
 * where the real decision is made.
 */
export async function requireAdmin() {
  const sessionUser = await requireUser();

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!user || user.role !== "ADMIN") {
    throw new AuthorizationError("FORBIDDEN");
  }

  return user;
}

/**
 * Guard for the owner dashboard and every owner server action.
 *
 * Returns the owner's profile alongside the account, because every owner action
 * needs the profile id to scope its query — writing `where: { id, ownerId }`
 * rather than `where: { id }` is what stops one owner editing another's listing
 * by guessing an id (IDOR).
 *
 * Status and membership are re-read here, per request, for the same reason the
 * role is: a 30-day JWT minted while the owner was approved keeps saying so
 * long after an admin suspends them or their membership lapses. Authorisation
 * that a suspension cannot revoke for a month is not authorisation.
 */
export async function requireApprovedOwner() {
  const sessionUser = await requireUser();

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      ownerProfile: true,
    },
  });

  if (!user || user.role !== "OWNER" || !user.ownerProfile) {
    throw new AuthorizationError("FORBIDDEN");
  }

  if (!isOwnerActive(user.ownerProfile)) {
    throw new AuthorizationError("OWNER_INACTIVE");
  }

  return { user, owner: user.ownerProfile };
}

/* -------------------------------------------------------------------------- */
/* Page-level guards                                                          */
/* -------------------------------------------------------------------------- */

/**
 * ─── Why pages need their own guards ─────────────────────────────────────────
 * In the App Router a layout and the page beneath it render **in parallel**. A
 * layout calling `redirect()` therefore does not stop the page from running:
 * both execute, the redirect wins, and the page's `requireAdmin()` throws into
 * the void. The visitor is redirected correctly — no data leaks — but every
 * such request logs an `AuthorizationError` stack trace, and in production it
 * surfaces as an error digest rather than a clean redirect.
 *
 * So pages use these, which resolve the same decision as control flow instead
 * of as an exception. Server *actions* keep the throwing versions above: there
 * the throw is caught and turned into a translated message for the form, which
 * is exactly right.
 */

/**
 * Admin guard for a page. Redirects rather than throwing.
 *
 * `redirect()` throws a control-flow signal Next.js understands, so this is a
 * clean 307 with nothing logged.
 */
export async function requireAdminPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/admin");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true },
  });

  // A signed-in owner is not lost — they are on the wrong dashboard, so send
  // them to their own rather than to a login form they don't need.
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "ADMIN") redirect("/owner");

  return user;
}

/**
 * The signed-in owner **if** they are currently allowed to act, otherwise null.
 *
 * Returns null rather than redirecting because the owner layout already renders
 * the status panel for a pending/rejected/suspended/expired owner and discards
 * `children`. A redirect here would send `/owner` to `/owner` and loop; a throw
 * would log a stack trace on a request that is behaving exactly as designed.
 *
 * Pages early-return `null` on a null result — the layout supplies the UI, so
 * nothing is rendered from the page and no data is read for an owner who may
 * not see it.
 */
export async function getActiveOwnerSession() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true, ownerProfile: true },
  });

  if (!user || user.role !== "OWNER" || !user.ownerProfile) return null;
  if (!isOwnerActive(user.ownerProfile)) return null;

  return { user, owner: user.ownerProfile };
}

/**
 * The signed-in owner's profile whatever its state — for the status page, which
 * has to render precisely *because* the owner is pending, rejected or expired.
 * Never use this to gate a mutation.
 */
export async function getOwnerProfileForSession() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true, ownerProfile: true },
  });

  if (!user || user.role !== "OWNER") return null;
  return user;
}

/** The current session's role, or null when signed out. Cheap; for UI branching. */
export async function currentRole(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  return user?.role ?? null;
}
