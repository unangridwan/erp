"use client";

import { useEffect } from "react";
import { reportClientError } from "../lib/error-reporting";
import { useI18n } from "../lib/i18n";

/** Batas error halaman: laporkan error render lalu tawarkan muat ulang bagian halaman. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { l } = useI18n();
  useEffect(() => reportClientError(error), [error]);
  return (
    <main className="shell stack">
      <h1>{l("Terjadi kesalahan", "Something went wrong")}</h1>
      <p className="muted">
        {l(
          "Halaman ini gagal ditampilkan. Kesalahan sudah dicatat; coba muat ulang.",
          "This page failed to render. The error has been recorded; try reloading.",
        )}
        {error.digest && <small> ({error.digest})</small>}
      </p>
      <div className="form-actions">
        <button className="primary" onClick={reset}>
          {l("Coba lagi", "Try again")}
        </button>
      </div>
    </main>
  );
}
