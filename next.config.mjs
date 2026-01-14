/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "nilmamano.com",
        pathname: "/blog/**",
      },
    ],
  },
};

export default nextConfig;
