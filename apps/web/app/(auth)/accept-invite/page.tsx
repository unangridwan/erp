"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, session, type Session } from "../../../lib/api";
import { useI18n } from "../../../lib/i18n";

interface Info {
  email: string;
  name: string;
  tenantName: string;
}

/** Token undangan dibawa di fragment URL (#token=…) agar tidak terkirim ke server/log. */
export default function AcceptInvitePage() {
  const router = useRouter();
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (!value) return setError(t("invite.invalid"));
    setToken(value);
    api<Info>("/auth/invitation", { method: "POST", body: { token: value } })
      .then(setInfo)
      .catch(() => setError(t("invite.invalid")));
  }, [t]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const password = new FormData(e.currentTarget).get("password");
      const result = await api<Session>("/auth/accept-invite", { method: "POST", body: { token, password } });
      session.clear();
      session.set(result);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <form className="panel" onSubmit={onSubmit}>
        <h1>{t("invite.title")}</h1>
        {info && (
          <>
            <p>
              {t("invite.intro")} <strong>{info.tenantName}</strong> — {info.name} ({info.email})
            </p>
            <label className="field">
              <span>{t("invite.setPassword")}</span>
              <input name="password" type="password" minLength={8} required autoComplete="new-password" />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? t("auth.processing") : t("invite.title")}
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
