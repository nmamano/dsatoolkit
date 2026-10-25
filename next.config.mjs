/** @type {import('next').NextConfig} */
const nextConfig = {
  // The VPS image runs .next/standalone (Dockerfile); Vercel ignores this.
  output: "standalone",
  // Cloudflare caches pages for 5 minutes at most. Without this, Next sends a
  // one-year s-maxage on prerendered pages.
  async headers() {
    return [
      {
        source: "/:path((?!api/|_next/).*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, s-maxage=300" }],
      },
    ];
  },
};

export default nextConfig;
