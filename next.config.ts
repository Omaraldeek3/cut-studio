import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  async redirects() {
    // The tool names the portfolio used before Cut Studio had pages of its own.
    return [
      { source: "/tools", destination: "/ar", permanent: true },
    ];
  },
  async headers() {
    // The AI models and runtimes never change under the same name.
    return [
      { source: "/models/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/vendor/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=604800" }] },
      { source: "/wasm/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=604800" }] },
    ];
  },
};

export default config;
