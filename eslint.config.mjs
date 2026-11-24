import js from "@eslint/js";
import { fileURLToPath } from "node:url";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/drizzle/**", "**/next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Variabel berawalan _ sengaja diabaikan (mis. membuang field saat destrukturisasi).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  // Plugin didaftarkan global agar `next build` (yang memeriksa konfigurasi untuk berkas config ini) mendeteksinya;
  // aturannya hanya berlaku untuk aplikasi web.
  { plugins: { "@next/next": nextPlugin } },
  {
    files: ["apps/web/**/*.{ts,tsx,js,mjs}"],
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // Gambar di aplikasi ini berasal dari blob/data URL ber-token (lampiran, foto, QR) yang tidak bisa dioptimasi
      // `next/image`; CSP juga tidak mengizinkan optimizer eksternal.
      "@next/next/no-img-element": "off",
    },
    // Path absolut agar aturan menemukan folder app baik lint dari root maupun dari apps/web.
    settings: { next: { rootDir: fileURLToPath(new URL("./apps/web/", import.meta.url)) } },
  },
);
