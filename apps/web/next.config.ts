import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const dev = process.env.NODE_ENV !== "production";
const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").origin;
  } catch {
    return "http://localhost:3001";
  }
})();
// Token sesi disimpan di peramban, jadi skrip dari luar tidak boleh berjalan dan data hanya boleh dikirim ke API.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin}${dev ? " ws: wss:" : ""}`,
  "media-src 'self' blob:",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Root monorepo, ditetapkan eksplisit agar Next tidak menebaknya dari lockfile lain di folder induk. */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Indikator dev Next di kanan bawah agar tidak menutupi tombol perkecil sidebar (kiri bawah).
  devIndicators: { position: "bottom-right" },
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  // Image Docker produksi memakai server mandiri (NEXT_OUTPUT=standalone); `next start` lokal tidak.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Kamera dipakai kiosk absensi (foto saat absen).
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
          { key: "Content-Security-Policy", value: csp },
          ...(dev
            ? []
            : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
        ],
      },
    ];
  },
};

export default nextConfig;
