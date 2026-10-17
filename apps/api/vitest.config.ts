import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { JWT_SECRET: "test-secret-yang-panjangnya-lebih-dari-32-karakter" },
    // Test e2e berbagi satu database; jalankan file secara berurutan.
    fileParallelism: false,
  },
});
