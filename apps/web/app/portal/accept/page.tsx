"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useI18n } from "../../../lib/i18n";
import { portalApi, portalSession } from "../../../lib/portal-api";

/** Terima undangan portal: token di fragment URL (#token=…) agar tidak terkirim ke server/log. */
export default function PortalAcceptPage() {
  const router = useRouter();
  const { l } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (!value) setError(l("Tautan undangan tidak valid.", "Invalid invitation link."));
    setToken(value);
  }, [l]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const password = new FormData(e.currentTarget).get("password");
      const res = await portalApi<{ token: string }>("/portal/auth/accept", {
        method: "POST",
        body: { token, password },
      });
      portalSession.set(res.token);
      router.replace("/portal");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <form className="panel" onSubmit={onSubmit}>
        <h1>{l("Aktifkan akses portal", "Activate portal access")}</h1>
        {token && (
          <>
            <label className="field">
              <span>{l("Buat password (min. 8 karakter)", "Create a password (min. 8 characters)")}</span>
              <input name="password" type="password" minLength={8} required autoComplete="new-password" />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? l("Memproses…", "Processing…") : l("Aktifkan & masuk", "Activate & sign in")}
            </button>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
