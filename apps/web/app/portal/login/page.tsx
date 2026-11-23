"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useI18n } from "../../../lib/i18n";
import { portalApi, portalSession } from "../../../lib/portal-api";

export default function PortalLoginPage() {
  const router = useRouter();
  const { l } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await portalApi<{ token: string }>("/portal/auth/login", {
        method: "POST",
        body: {
          tenantSlug: form.get("tenantSlug"),
          email: form.get("email"),
          password: form.get("password"),
        },
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
        <h1>{l("Portal Pelanggan", "Customer Portal")}</h1>
        <label className="field">
          <span>{l("Kode perusahaan (tenant)", "Company code (tenant)")}</span>
          <input name="tenantSlug" required autoComplete="organization" />
        </label>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? l("Memproses…", "Processing…") : l("Masuk", "Sign in")}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
