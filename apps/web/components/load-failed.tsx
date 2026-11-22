"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useI18n } from "../lib/i18n";

/**
 * Status gagal muat untuk halaman detail. Tanpa ini halaman yang datanya gagal dimuat (dihapus, beda perusahaan, tanpa
 * hak) tetap menampilkan "Memuat…" selamanya setelah toast hilang.
 */
export function useLoadError() {
  const [error, setError] = useState<string | null>(null);
  const fail = useCallback((e: unknown) => setError(e instanceof Error ? e.message : String(e)), []);
  return [error, fail] as const;
}

export function LoadFailed({ message }: { message: string }) {
  const { l } = useI18n();
  const router = useRouter();
  return (
    <div className="card" role="alert">
      <p>
        <strong>{l("Data tidak dapat dimuat", "The data could not be loaded")}</strong>
      </p>
      <p className="muted">{message}</p>
      <p>
        <button type="button" onClick={() => router.back()}>
          {l("Kembali", "Back")}
        </button>{" "}
        <button type="button" onClick={() => window.location.reload()}>
          {l("Coba lagi", "Try again")}
        </button>
      </p>
    </div>
  );
}
