import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Retry navigations once the connection returns; powers the offline banner (useOffline).
    useOffline: true,
  },
  // The booth is the app: send "/" there before any page renders. (A page that only calls
  // redirect() has nothing for instant-navigation validation to render, and errors in dev.)
  async redirects() {
    return [{ source: "/", destination: "/booth", permanent: false }];
  },
  async headers() {
    return [
      {
        // The service worker must never be cached, or updates would never reach the booth.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
