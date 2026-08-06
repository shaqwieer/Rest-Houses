import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Photo uploads are server actions taking a whole `File[]` (see
   * addListingImages in src/app/actions/listings.ts — the admin's multi-select
   * is sent as one call). Next caps a server action body at 1 MB by default,
   * which is below MAX_UPLOAD_BYTES (200 MB, src/lib/storage/types.ts): every
   * real phone photo would be rejected by the framework before the app's own
   * validation — and far more so for a batch.
   *
   * Note this is a limit on the *whole request body*, not per file, so a
   * multi-select is capped at 200 MB in total however the bytes are split.
   *
   * Keep this in step with the body-size limit on any reverse proxy in front
   * (`client_max_body_size` on nginx), or the proxy becomes the new invisible
   * ceiling.
   */
  experimental: {
    serverActions: { bodySizeLimit: "200mb" },

    /**
     * The third link in the same chain, and the one that fails worst.
     *
     * `src/middleware.ts` matches /admin/:path* and /owner/:path*, which is
     * exactly where photo uploads are posted. Whenever middleware runs, Next
     * tees the request body so the handler can still read it afterwards — and
     * that tee is capped separately from `serverActions.bodySizeLimit`, at 10 MB
     * by default (see getCloneableBody in next/dist/server/body-streams.js).
     *
     * Over the cap it does not reject the request: it ends both streams early
     * and logs a warning. The server action then receives a *truncated*
     * multipart body and dies with "Unexpected end of form" inside the
     * framework — before addListingImages runs, so the action's own try/catch
     * never sees it and the owner gets a blank "server-side exception" page
     * instead of a message. Three phone photos are enough to cross 10 MB.
     *
     * Keep this equal to the limits above and to nginx's `client_max_body_size`.
     * nginx rejects anything genuinely larger with a 413 before the body is ever
     * teed here, so this value never has to be the one that says no.
     */
    middlewareClientMaxBodySize: "200mb",
  },

  /**
   * Standalone output: `next build` emits .next/standalone containing the server
   * plus only the node_modules it actually traced as reachable. That is what
   * keeps the Docker runtime image small — no devDependencies, no source tree —
   * and it is harmless outside Docker (the extra directory is simply unused).
   */
  output: "standalone",

  images: {
    // Local uploads (/uploads/**) are served straight from /public and need no
    // entry here. Add the host of whichever CDN you switch the storage adapter
    // to — see src/lib/storage/README-ish comments and the README section
    // "Switching image storage".
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "*.s3.amazonaws.com" },
    ],
    // AVIF first, then WebP — both far smaller than JPEG for photo-heavy pages.
    formats: ["image/avif", "image/webp"],
  },

  // Long-lived immutable caching for uploaded originals.
  async headers() {
    return [
      {
        source: "/uploads/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
