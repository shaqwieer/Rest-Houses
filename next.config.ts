import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

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
