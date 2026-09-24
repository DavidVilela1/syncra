import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // The floating dev badge sits on top of the sidebar's user row; errors still surface in an overlay.
  devIndicators: false,
};

export default config;
