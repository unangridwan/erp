"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

interface Config {
  label?: string;
  issuer?: string;
  clientId?: string;
  hasClientSecret?: boolean;
  allowedDomains?: string[];
  autoProvision?: boolean;
  defaultRoleId?: string | null;
  enforce?: boolean;
  active?: boolean;
  redirectUri: string;
}

/** SSO OpenID Connect tenant: Google Workspace, Microsoft Entra ID, Keycloak, Okta, dsb. */
export default function SsoSettingsPage() {
  const { l } = useI18n();
  const [config, setConfig] = useState<Config | null>(null);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    label: "Google Workspace",
    issuer: "",
    clientId: "",
    clientSecret: "",
    allowedDomains: "",
    autoProvision: false,
    defaultRoleId: "",
    enforce: false,
    active: true,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ id: string; name: string }[]>("/roles")
      .then(setRoles)
      .catch(() => setRoles([]));
    api<Config>("/auth/sso/config")
      .then((c) => {
        setConfig(c);
        if (c.issuer)
          setForm({
            label: c.label ?? "SSO",
            issuer: c.issuer,
            clientId: c.clientId ?? "",
            clientSecret: "",
            allowedDomains: (c.allowedDomains ?? []).join(", "),
            autoProvision: !!c.autoProvision,
            defaultRoleId: c.defaultRoleId ?? "",
            enforce: !!c.enforce,
            active: c.active !== false,
          });
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const saved = await api<Config>("/auth/sso/config", {
        method: "PUT",
        body: {
          ...form,
          clientSecret: form.clientSecret || null,
          defaultRoleId: form.defaultRoleId || null,
          allowedDomains: form.allowedDomains
            .split(/[\s,]+/)
            .map((d) => d.trim())
            .filter(Boolean),
        },
      });
      setConfig(saved);
      setForm((f) => ({ ...f, clientSecret: "" }));
      setNotice(l("Pengaturan SSO disimpan.", "SSO settings saved."));
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : String(err));
    }
  }
  async function remove() {
    if (!confirm(l("Hapus konfigurasi SSO?", "Remove the SSO configuration?"))) return;
    await api("/auth/sso/config", { method: "DELETE" });
    setConfig((c) => (c ? { redirectUri: c.redirectUri } : c));
    setNotice(l("SSO dihapus.", "SSO removed."));
  }

  if (!config) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  const set =
    (k: keyof typeof form) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
      setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? !!e.target.checked : e.target.value }));

  return (
    <form className="panel narrow stack" onSubmit={save}>
      <h1>{l("Single Sign-On (OpenID Connect)", "Single Sign-On (OpenID Connect)")}</h1>
      <p className="muted">
        {l(
          "Daftarkan aplikasi di penyedia identitas (Google Workspace, Microsoft Entra ID, Keycloak, Okta) dengan redirect URI berikut, lalu isi issuer, client ID, dan client secret. User dicocokkan lewat email terverifikasi; 2FA ditangani penyedia identitas.",
          "Register an app at your identity provider (Google Workspace, Microsoft Entra ID, Keycloak, Okta) with the redirect URI below, then fill in the issuer, client ID and client secret. Users are matched by verified email; 2FA is handled by the identity provider.",
        )}
      </p>
      <label className="field">
        <span>Redirect URI</span>
        <input readOnly value={config.redirectUri} onFocus={(e) => e.target.select()} />
      </label>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      <label className="field">
        <span>{l("Teks tombol", "Button label")}</span>
        <input required value={form.label} onChange={set("label")} />
      </label>
      <label className="field">
        <span>Issuer</span>
        <input
          required
          placeholder="https://accounts.google.com"
          value={form.issuer}
          onChange={set("issuer")}
        />
      </label>
      <label className="field">
        <span>Client ID</span>
        <input required value={form.clientId} onChange={set("clientId")} />
      </label>
      <label className="field">
        <span>
          Client secret{" "}
          {config.hasClientSecret && (
            <small className="muted">
              ({l("tersimpan; kosongkan bila tidak diubah", "stored; leave empty to keep")})
            </small>
          )}
        </span>
        <input type="password" autoComplete="off" value={form.clientSecret} onChange={set("clientSecret")} />
      </label>
      <label className="field">
        <span>
          {l(
            "Domain email yang diizinkan (pisahkan dengan koma; kosong = semua)",
            "Allowed email domains (comma separated; empty = any)",
          )}
        </span>
        <input placeholder="perusahaan.co.id" value={form.allowedDomains} onChange={set("allowedDomains")} />
      </label>
      <label className="check">
        <input type="checkbox" checked={form.autoProvision} onChange={set("autoProvision")} />
        {l("Buat user otomatis saat login SSO pertama", "Create users automatically on first SSO sign-in")}
      </label>
      {form.autoProvision && (
        <label className="field">
          <span>{l("Peran bawaan user baru", "Default role for new users")}</span>
          <select required value={form.defaultRoleId} onChange={set("defaultRoleId")}>
            <option value="">—</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={form.enforce} onChange={set("enforce")} />
        {l(
          "Wajibkan SSO (login password hanya untuk administrator sebagai akses darurat)",
          "Require SSO (password sign-in only for administrators as break-glass access)",
        )}
      </label>
      <label className="check">
        <input type="checkbox" checked={form.active} onChange={set("active")} />
        {l("Aktif", "Active")}
      </label>
      <div className="form-actions">
        <button className="primary">{l("Simpan", "Save")}</button>
        {config.issuer && (
          <button type="button" className="danger" onClick={remove}>
            {l("Hapus SSO", "Remove SSO")}
          </button>
        )}
      </div>
    </form>
  );
}
