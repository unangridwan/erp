import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_SECRET: "test-secret-yang-panjangnya-lebih-dari-32-karakter",
      ENCRYPTION_KEY: "test-encryption-key-yang-panjangnya-32-karakter-lebih",
      MAIL_TRANSPORT: "json",
      // Test memakai penerima webhook & penyedia identitas di 127.0.0.1.
      ALLOW_PRIVATE_WEBHOOKS: "true",
    },
    setupFiles: ["./test/setup-env.ts"],
    // Test e2e berbagi satu database; jalankan file secara berurutan.
    fileParallelism: false,
  },
});
