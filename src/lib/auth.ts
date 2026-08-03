import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "./prisma";
import { isOwnerActive } from "./owners";
import { LOGIN_RATE_RULES } from "./security";
import { clientIp, consumeAll } from "./security/rate-limit";
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

        // ─── Throttle before doing any work ─────────────────────────────
        //
        // Without this, the login form is an unlimited password oracle: the
        // constant-time comparison below stops an attacker learning *which*
        // emails exist, but nothing stopped them trying a dictionary against
        // one. Budgeted per IP and per email address, so guessing at one
        // account does not lock out everyone behind the same office router,
        // and one attacker cycling addresses still runs out of IP budget.
        //
        // Returning null here is indistinguishable from a wrong password — the
        // form says "check your details". That is a deliberate trade: a
        // "too many attempts" message tells an attacker their rate exactly, and
        // an operator locked out for ten minutes has the container logs.
        const ip = await clientIp();
        if (!consumeAll(LOGIN_RATE_RULES, ip).allowed) {
          console.warn(`login throttled for ip ${ip}`);
          return null;
        }
        if (!consumeAll(LOGIN_RATE_RULES, `email:${email}`).allowed) {
          console.warn(`login throttled for ${email}`);
          return null;
        }

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
 * Which dashboard the current session belongs to — the single answer both
 * dashboards and the login page redirect on.
 *
 * ─── Why this exists: the /admin ⇄ /owner redirect loop ──────────────────────
 * /admin and /owner each used to decide where a stranger belonged by assuming
 * the other case must hold:
 *
 *     /admin:  "not an ADMIN?          → then you're an owner → /owner"
 *     /owner:  "no OwnerProfile?       → then you're an admin → /admin"
 *
 * Both are true for the accounts anyone tests with, and neither handles
 * **neither**. A session that is not a valid admin *and* not a valid owner
 * bounces between the two until the browser gives up with ERR_TOO_MANY_REDIRECTS
 * — and /login joins in, because it forwards an already-signed-in visitor to
 * /admin, which starts the same cycle.
 *
 * That state is not hypothetical. Sessions are 30-day JWTs holding a user id, so
 * the cookie long outlives the row it points at:
 *
 *   • the database was reset or re-seeded — new rows get new cuids, so every
 *     cookie in every open browser now names a user that does not exist
 *   • an account was deleted while someone was signed in
 *   • a `User` has role "OWNER" but no `OwnerProfile` (a half-finished
 *     registration, or a profile removed directly in the database)
 *
 * Returning null for all of them is what breaks the cycle: null means "this
 * session belongs nowhere", and the only correct destination for nowhere is the
 * login form, which — see `login/page.tsx` — renders rather than redirecting
 * when this returns null.
 *
 * Note "/owner" is returned for an owner in *any* state. Pending, rejected,
 * suspended and expired owners all belong there; the owner layout shows them the
 * status panel. Sending them elsewhere is what would loop.
 */
export async function dashboardForSession(): Promise<Dashboard | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, ownerProfile: { select: { id: true } } },
  });

  return dashboardForAccount(user);
}

export type Dashboard = "/admin" | "/owner";

/**
 * The decision itself, separated from the session and the query so it can be
 * tested exhaustively — including the two cases that used to loop, which are
 * awkward to stage through a real cookie. See `tests/owner-workflow.test.ts`.
 *
 * `null` is the load-bearing return value: it means "belongs to no dashboard",
 * and every caller must send it to /login rather than guessing.
 */
export function dashboardForAccount(
  user: { role: string; ownerProfile: { id: string } | null } | null,
): Dashboard | null {
  if (!user) return null; // valid signature, vanished row
  if (user.role === "ADMIN") return "/admin";
  if (user.ownerProfile) return "/owner";
  return null; // an OWNER with no profile, or a role nothing serves
}

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
    // `ownerProfile` is selected only to tell "wrong dashboard" apart from
    // "belongs to no dashboard" without a second query.
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      ownerProfile: { select: { id: true } },
    },
  });

  // A signed-in owner is not lost — they are on the wrong dashboard, so send
  // them to their own rather than to a login form they don't need. Anyone who
  // is neither goes to /login, which is what stops the loop described on
  // `dashboardForSession` above.
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "ADMIN") redirect(user.ownerProfile ? "/owner" : "/login");

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
