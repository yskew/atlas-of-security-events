import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // R3F manages the WebGL context manually; Strict Mode's dev double-mount
  // tears it down and leaves a black canvas. Disable it for this WebGL app.
  reactStrictMode: false,
};

export default nextConfig;
