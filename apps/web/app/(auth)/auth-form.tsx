"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError, session, type Session } from "../../lib/api";
import { LocaleSwitch, useI18n, type MessageKey } from "../../lib/i18n";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [needCode, setNeedCode] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const body = Object.fromEntries(new FormData(e.currentTarget));
      const result = await api<Session>(`/auth/${mode}`, { method: "POST", body });
      session.clear();
      session.set(result);
      router.push("/");
    } catch (err) {
      if (err instanceof ApiError && err.body.twoFactorRequired && !needCode) {
        setNeedCode(true);
      } else {
        setError(err instanceof Error ? err.message : String(err));
        if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
      }
    } finally {
      setBusy(false);
    }
  }

  const field = (name: string, label: MessageKey, type = "text", hidden = false) => (
    <label className="field" hidden={hidden}>
      <span>{t(label)}</span>
      <input
        name={name}
        type={type}
        required
        autoComplete={type === "password" ? "current-password" : name}
      />
      {fieldErrors[name] && <small className="error">{fieldErrors[name]}</small>}
    </label>
  );

  return (
    <main className="auth">
      <form className="panel" onSubmit={onSubmit}>
        <h1>{mode === "login" ? t("auth.login") : t("auth.signup")}</h1>
        {/* Field tetap di DOM saat meminta kode 2FA agar nilainya ikut terkirim. */}
        {field("tenantSlug", "auth.tenant", "text", needCode)}
        {mode === "signup" && field("companyName", "auth.companyName")}
        {mode === "signup" && field("name", "auth.name")}
        {field("email", "auth.email", "email", needCode)}
        {field("password", "auth.password", "password", needCode)}
        {needCode && (
          <label className="field">
            <span>{t("auth.code")}</span>
            <input
              name="code"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
              autoFocus
            />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? t("auth.processing") : mode === "login" ? t("auth.login") : t("auth.signupButton")}
        </button>
        <p className="muted">
          {mode === "login" ? (
            <>
              {t("auth.noAccount")} <Link href="/signup">{t("auth.signupButton")}</Link>
            </>
          ) : (
            <>
              {t("auth.haveAccount")} <Link href="/login">{t("auth.login")}</Link>
            </>
          )}
        </p>
        <LocaleSwitch />
      </form>
    </main>
  );
}
