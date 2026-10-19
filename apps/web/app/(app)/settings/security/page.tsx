"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

export default function SecurityPage() {
  const me = useMe();
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(me.twoFactorEnabled);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    try {
      const { secret, otpauthUrl } = await api<{ secret: string; otpauthUrl: string }>("/auth/2fa/setup", {
        method: "POST",
      });
      setSetup({ secret, qr: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 200 }) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>, action: "enable" | "disable") {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    try {
      await api(`/auth/2fa/${action}`, { method: "POST", body: { code: new FormData(form).get("code") } });
      setEnabled(action === "enable");
      setSetup(null);
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const codeInput = (
    <input
      name="code"
      inputMode="numeric"
      pattern="\d{6}"
      maxLength={6}
      required
      autoComplete="one-time-code"
    />
  );

  return (
    <div className="panel narrow">
      <h1>{t("security.title")}</h1>
      <p>{enabled ? t("security.2faOn") : t("security.2faOff")}</p>
      {!enabled && !setup && (
        <button className="primary" onClick={start}>
          {t("security.setup")}
        </button>
      )}
      {setup && (
        <form className="stack" onSubmit={(e) => submit(e, "enable")}>
          <p className="muted">{t("security.scan")}</p>
          <img src={setup.qr} alt="QR 2FA" width={200} height={200} />
          <code>{setup.secret}</code>
          <label className="field">
            <span>{t("auth.code")}</span>
            {codeInput}
          </label>
          <button className="primary">{t("security.confirm")}</button>
        </form>
      )}
      {enabled && (
        <form className="stack" onSubmit={(e) => submit(e, "disable")}>
          <label className="field">
            <span>{t("auth.code")}</span>
            {codeInput}
          </label>
          <button className="danger">{t("security.disable")}</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      <Sessions />
    </div>
  );
}

interface LoginSession {
  id: string;
  startedAt: string;
  lastUsedAt: string;
  ip: string | null;
  userAgent: string | null;
}

/** Perangkat yang sedang login; bisa dicabut satu per satu atau semuanya. */
function Sessions() {
  const { l, locale } = useI18n();
  const [sessions, setSessions] = useState<LoginSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<LoginSession[]>("/auth/sessions")
      .then(setSessions)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  const when = (v: string) =>
    new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(v));
  async function revoke(path: string) {
    setError(null);
    try {
      await api(path, { method: "DELETE" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section>
      <h2>{l("Sesi login aktif", "Active sessions")}</h2>
      <p className="muted small">
        {l(
          "Cabut sesi yang tidak Anda kenali. Perangkat tersebut harus login ulang (paling lambat saat token aksesnya habis).",
          "Revoke sessions you don't recognise. That device must sign in again (at the latest when its access token expires).",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      <ul className="steps">
        {(sessions ?? []).map((s) => (
          <li key={s.id}>
            <span className="grow">
              {s.userAgent ?? l("Perangkat tidak dikenal", "Unknown device")}
              <div className="muted small">
                {s.ip ?? ""} · {l("terakhir", "last")} {when(s.lastUsedAt)} · {l("mulai", "since")}{" "}
                {when(s.startedAt)}
              </div>
            </span>
            <button className="link danger" onClick={() => revoke(`/auth/sessions/${s.id}`)}>
              {l("Cabut", "Revoke")}
            </button>
          </li>
        ))}
      </ul>
      {sessions && sessions.length > 1 && (
        <button className="danger" onClick={() => revoke("/auth/sessions")}>
          {l("Keluar dari semua perangkat", "Sign out everywhere")}
        </button>
      )}
    </section>
  );
}
