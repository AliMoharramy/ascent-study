import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use an isolated build directory and serial route-output writes on Windows.
  // Vercel/Linux use the standard .next directory and normal workers.
  ...(process.platform === "win32" ? { distDir: ".next-win", experimental: { webpackBuildWorker: false, cpus: 1 } } : {}),
  // standalone is for Docker/self-host; Vercel builds its own serverless output.
  output: process.env.VERCEL === "1" ? undefined : "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["pg", "@node-rs/argon2"],
  outputFileTracingIncludes: {
    "/*": ["./src/db/migrations-pg/**/*.sql", "./docs/seed/**/*.yaml", "./docs/**/*.md"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
