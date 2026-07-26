import { PrismaClient } from "@prisma/client";

/**
 * A single PrismaClient for the whole process.
 *
 * Next.js hot-reloads modules in dev, which would otherwise open a new pool on
 * every save until the database refuses connections. Stashing the instance on
 * `globalThis` survives the reload; in production the module is evaluated once
 * so the global is never used.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
