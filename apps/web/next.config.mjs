// COOP/COEP only on /sim so the rest of the site can load third-party resources.
// Defined here (not vercel.json) so the same headers apply in `next dev` and on Vercel.
const isolationHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@esp32-sim/sim-core"],
  async headers() {
    return [
      { source: "/sim", headers: isolationHeaders },
      { source: "/sim/:path*", headers: isolationHeaders },
      // A dedicated Worker script must carry its own COEP header, otherwise the
      // browser blocks it (ERR_BLOCKED_BY_RESPONSE) on an isolated page.
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};
export default nextConfig;
