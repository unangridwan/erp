"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, API_URL, ApiError, pendingNext, safeNext, session, type Session } from "../../lib/api";
import { LocaleSwitch, useI18n, type MessageKey } from "../../lib/i18n";
import { ThemeSwitch } from "../../lib/theme";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const { t, l } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [needCode, setNeedCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tenant, setTenant] = useState("");
  const [sso, setSso] = useState<{ enabled: boolean; label?: string; enforce?: boolean } | null>(null);
  const [next, setNext] = useState<string | null>(null);

  // Kembali dari SSO yang gagal: tampilkan pesannya dan isi ulang tenant.
  useEffect(() => {
    if (mode !== "login") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("ssoError")) setError(params.get("ssoError"));
    if (params.get("tenant")) setTenant(params.get("tenant")!);
    setNext(safeNext(params.get("next")));
  }, [mode]);
  // Tombol SSO muncul bila tenant mengaktifkannya.
  useEffect(() => {
    if (mode !== "login" || !tenant.trim()) return setSso(null);
    const timer = setTimeout(() => {
      api<{ enabled: boolean; label?: string; enforce?: boolean }>(
        `/auth/sso/provider?tenant=${encodeURIComponent(tenant.trim())}`,
      )
        .then(setSso)
        .catch(() => setSso(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [mode, tenant]);

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
      // Tujuan dari aplikasi terhubung (/oauth/authorize) dibuka ulang penuh agar parameternya terbaca.
      if (next) window.location.assign(next);
      else router.push("/");
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
        {...(name === "tenantSlug" ? { value: tenant, onChange: (e) => setTenant(e.target.value) } : {})}
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
        {mode === "login" && sso?.enabled && !needCode && (
          <>
            <button
              type="button"
              className={sso.enforce ? "primary" : ""}
              onClick={() => {
                pendingNext.set(next);
                window.location.href = `${API_URL}/auth/sso/start/${encodeURIComponent(tenant.trim())}`;
              }}
            >
              {l(`Masuk dengan ${sso.label}`, `Sign in with ${sso.label}`)}
            </button>
            <p className="muted small">
              {sso.enforce
                ? l(
                    "Tenant ini mewajibkan SSO; login password hanya untuk administrator.",
                    "This tenant requires SSO; password sign-in is for administrators only.",
                  )
                : l("atau masuk dengan password:", "or sign in with a password:")}
            </p>
          </>
        )}
        <button className={mode === "login" && sso?.enforce ? "" : "primary"} disabled={busy}>
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
        <div className="auth-prefs">
          <LocaleSwitch />
          <ThemeSwitch />
        </div>
      </form>
    </main>
  );
}
