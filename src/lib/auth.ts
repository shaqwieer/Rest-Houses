import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "./prisma";

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

/**
 * Guard for server components and server actions.
 *
 * `middleware.ts` already blocks unauthenticated navigation to /admin, but a
 * server action can be invoked directly by anyone who knows its id — so every
 * mutating action calls this too. Defence in depth, not redundancy.
 */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("UNAUTHORIZED");
  }
  return session.user;
}
