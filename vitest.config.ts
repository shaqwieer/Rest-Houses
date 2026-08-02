import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Test configuration.
 *
 * ─── Why there is no jsdom, and no testing-library ───────────────────────────
 * Everything the brief asks to be tested is either a pure function (direction,
 * deposit rounding, WhatsApp normalisation, dictionary parity) or a database
 * rule (visibility, approval, membership, authorisation). None of it needs a
 * DOM. The two assertions that do involve components — that the removed
 * location section no longer renders, and that it triggers no map request —
 * are answered by `renderToStaticMarkup` from `react-dom/server`, which is a
 * string comparison rather than a simulated browser.
 *
 * That keeps the suite fast and, more importantly, keeps it honest: a jsdom
 * test that "renders" a server component would be testing a mock of the app,
 * while these run the same code paths the site does.
 *
 * `environment: "node"` for the same reason — the Prisma client and every
 * module under test are server code.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // The database tests share one SQLite file and truncate between cases, so
    // they must not run in parallel with each other. A single fork keeps the
    // ordering deterministic; the suite is small enough that the lost
    // parallelism costs a second or two.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    setupFiles: ["tests/setup.ts"],
    // Builds the SQLite schema once, before any worker starts — see the
    // note in tests/global-setup.ts for why it cannot live in a test file.
    globalSetup: ["tests/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    // Mirrors the `@/*` path alias from tsconfig.json.
    alias: { "@": path.resolve(__dirname, "src") },
  },
  esbuild: {
    // The components under test are .tsx; esbuild needs to know how to compile
    // JSX without a separate React plugin, since nothing here needs Fast Refresh.
    jsx: "automatic",
  },
});
