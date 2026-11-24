"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, pendingNext, session, type Session } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

/** Kembali dari penyedia identitas: tukar refresh token sekali pakai di fragmen URL menjadi sesi. */
export default function SsoReturnPage() {
  const router = useRouter();
  const { l } = useI18n();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const refreshToken = new URLSearchParams(window.location.hash.slice(1)).get("refresh");
    // Hapus token dari riwayat peramban segera.
    window.history.replaceState(null, "", "/login/sso");
    if (!refreshToken) {
      setError("missing");
      return;
    }
    api<Session>("/auth/refresh", { method: "POST", body: { refreshToken } })
      .then((s) => {
        session.clear();
        session.set(s);
        const next = pendingNext.take();
        if (next) window.location.replace(next);
        else router.replace("/");
      })
      .catch((e: Error) => setError(e.message));
  }, [router]);

  return (
    <main className="auth">
      <div className="panel">
        <h1>{l("Masuk dengan SSO", "Single sign-on")}</h1>
        {error ? (
          <>
            <p className="error" role="alert">
              {error === "missing" ? l("Tautan SSO tidak lengkap.", "The SSO link is incomplete.") : error}
            </p>
            <Link href="/login">{l("Kembali ke halaman masuk", "Back to sign in")}</Link>
          </>
        ) : (
          <p className="muted">{l("Memproses…", "Signing you in…")}</p>
        )}
      </div>
    </main>
  );
}
