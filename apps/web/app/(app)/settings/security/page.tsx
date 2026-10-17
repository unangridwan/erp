"use client";

import QRCode from "qrcode";
import { useState, type FormEvent } from "react";
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
    </div>
  );
}
