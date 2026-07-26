import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Photo uploads are server actions taking a whole `File[]` (see
   * addListingImages in src/app/actions/listings.ts — the admin's multi-select
   * is sent as one call). Next caps a server action body at 1 MB by default,
   * which is below MAX_UPLOAD_BYTES (8 MB, src/lib/storage/types.ts): every
   * real phone photo would be rejected by the framework before the app's own
   * validation — and far more so for a batch.
   *
   * Keep this in step with `client_max_body_size` on any reverse proxy in
   * front, or the proxy becomes the new invisible ceiling.
   */
  experimental: {
    serverActions: { bodySizeLimit: "32mb" },
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
