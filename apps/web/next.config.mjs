// COOP/COEP only on /sim so the rest of the site can load third-party resources.
// Defined here (not vercel.json) so the same headers apply in `next dev` and on Vercel.
const isolationHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      { source: "/sim", headers: isolationHeaders },
      { source: "/sim/:path*", headers: isolationHeaders },
    ];
  },
};
export default nextConfig;
