"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { ask } from "../../../../components/feedback";

type Protocol = "oidc" | "saml";
interface Config {
  id?: string;
  protocol?: Protocol;
  label?: string;
  issuer?: string | null;
  clientId?: string | null;
  hasClientSecret?: boolean;
  samlEntryPoint?: string | null;
  samlIdpCert?: string | null;
  samlIdpIssuer?: string | null;
  samlEmailAttribute?: string | null;
  allowedDomains?: string[];
  autoProvision?: boolean;
  defaultRoleId?: string | null;
  enforce?: boolean;
  active?: boolean;
  redirectUri: string;
  saml: { entityId: string; acsUrl: string; metadataUrl: string };
}

const EMPTY = {
  protocol: "oidc" as Protocol,
  label: "Google Workspace",
  issuer: "",
  clientId: "",
  clientSecret: "",
  samlEntryPoint: "",
  samlIdpCert: "",
  samlIdpIssuer: "",
  samlEmailAttribute: "",
  allowedDomains: "",
  autoProvision: false,
  defaultRoleId: "",
  enforce: false,
  active: true,
};

/** SSO tenant: OpenID Connect (Google Workspace, Entra ID, Keycloak, Okta) atau SAML 2.0 (ADFS, Entra ID, Okta, …). */
export default function SsoSettingsPage() {
  const { l } = useI18n();
  const [config, setConfig] = useState<Config | null>(null);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ id: string; name: string }[]>("/roles")
      .then(setRoles)
      .catch(() => setRoles([]));
    api<Config>("/auth/sso/config")
      .then((c) => {
        setConfig(c);
        if (c.id)
          setForm({
            protocol: c.protocol ?? "oidc",
            label: c.label ?? "SSO",
            issuer: c.issuer ?? "",
            clientId: c.clientId ?? "",
            clientSecret: "",
            samlEntryPoint: c.samlEntryPoint ?? "",
            samlIdpCert: c.samlIdpCert ?? "",
            samlIdpIssuer: c.samlIdpIssuer ?? "",
            samlEmailAttribute: c.samlEmailAttribute ?? "",
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
    const common = {
      label: form.label,
      allowedDomains: form.allowedDomains
        .split(/[\s,]+/)
        .map((d) => d.trim())
        .filter(Boolean),
      autoProvision: form.autoProvision,
      defaultRoleId: form.defaultRoleId || null,
      enforce: form.enforce,
      active: form.active,
    };
    const body =
      form.protocol === "saml"
        ? {
            ...common,
            protocol: "saml",
            samlEntryPoint: form.samlEntryPoint,
            samlIdpCert: form.samlIdpCert,
            samlIdpIssuer: form.samlIdpIssuer || null,
            samlEmailAttribute: form.samlEmailAttribute || null,
          }
        : {
            ...common,
            protocol: "oidc",
            issuer: form.issuer,
            clientId: form.clientId,
            clientSecret: form.clientSecret || null,
          };
    try {
      const saved = await api<Config>("/auth/sso/config", { method: "PUT", body });
      setConfig(saved);
      setForm((f) => ({ ...f, clientSecret: "", samlIdpCert: saved.samlIdpCert ?? f.samlIdpCert }));
      setNotice(l("Pengaturan SSO disimpan.", "SSO settings saved."));
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : String(err));
    }
  }
  async function remove() {
    if (!(await ask(l("Hapus konfigurasi SSO?", "Remove the SSO configuration?")))) return;
    await api("/auth/sso/config", { method: "DELETE" });
    setConfig((c) => (c ? { redirectUri: c.redirectUri, saml: c.saml } : c));
    setForm(EMPTY);
    setNotice(l("SSO dihapus.", "SSO removed."));
  }

  if (!config) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  const set =
    (k: keyof typeof form) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
      setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? !!e.target.checked : e.target.value }));
  const copyField = (label: string, value: string) => (
    <label className="field">
      <span>{label}</span>
      <input readOnly value={value} onFocus={(e) => e.target.select()} />
    </label>
  );
  const saml = form.protocol === "saml";

  return (
    <form className="panel narrow stack" onSubmit={save}>
      <h1>Single Sign-On</h1>
      <label className="field">
        <span>{l("Protokol", "Protocol")}</span>
        <select value={form.protocol} onChange={set("protocol")}>
          <option value="oidc">OpenID Connect</option>
          <option value="saml">SAML 2.0</option>
        </select>
      </label>
      {saml ? (
        <>
          <p className="muted">
            {l(
              "Daftarkan ERP sebagai aplikasi SAML di penyedia identitas (ADFS, Microsoft Entra ID, Okta, OneLogin, JumpCloud) — unggah URL metadata di bawah atau isi entity ID dan ACS URL secara manual — lalu isi URL SSO dan sertifikat penandatanganan IdP. Assertion wajib ditandatangani; email diambil dari NameID atau atribut email.",
              "Register the ERP as a SAML application at your identity provider (ADFS, Microsoft Entra ID, Okta, OneLogin, JumpCloud) — upload the metadata URL below or enter the entity ID and ACS URL manually — then fill in the IdP SSO URL and signing certificate. Assertions must be signed; the email is taken from the NameID or an email attribute.",
            )}
          </p>
          {copyField(l("URL metadata SP", "SP metadata URL"), config.saml.metadataUrl)}
          {copyField("Entity ID (Identifier)", config.saml.entityId)}
          {copyField("ACS URL (Reply URL)", config.saml.acsUrl)}
        </>
      ) : (
        <>
          <p className="muted">
            {l(
              "Daftarkan aplikasi di penyedia identitas (Google Workspace, Microsoft Entra ID, Keycloak, Okta) dengan redirect URI berikut, lalu isi issuer, client ID, dan client secret. User dicocokkan lewat email terverifikasi; 2FA ditangani penyedia identitas.",
              "Register an app at your identity provider (Google Workspace, Microsoft Entra ID, Keycloak, Okta) with the redirect URI below, then fill in the issuer, client ID and client secret. Users are matched by verified email; 2FA is handled by the identity provider.",
            )}
          </p>
          {copyField("Redirect URI", config.redirectUri)}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="notice">{notice}</p>}
      <label className="field">
        <span>{l("Teks tombol", "Button label")}</span>
        <input required value={form.label} onChange={set("label")} />
      </label>
      {saml ? (
        <>
          <label className="field">
            <span>{l("URL SSO IdP (HTTP-Redirect)", "IdP SSO URL (HTTP-Redirect)")}</span>
            <input
              required
              placeholder="https://login.microsoftonline.com/<tenant>/saml2"
              value={form.samlEntryPoint}
              onChange={set("samlEntryPoint")}
            />
          </label>
          <label className="field">
            <span>
              {l(
                "Sertifikat penandatanganan IdP (PEM/base64; tempel beberapa saat rotasi)",
                "IdP signing certificate (PEM/base64; paste several during rotation)",
              )}
            </span>
            <textarea
              required
              rows={6}
              spellCheck={false}
              style={{ fontFamily: "monospace", fontSize: 12 }}
              placeholder="-----BEGIN CERTIFICATE-----"
              value={form.samlIdpCert}
              onChange={set("samlIdpCert")}
            />
          </label>
          <label className="field">
            <span>{l("Entity ID IdP (opsional, diverifikasi)", "IdP entity ID (optional, verified)")}</span>
            <input value={form.samlIdpIssuer} onChange={set("samlIdpIssuer")} />
          </label>
          <label className="field">
            <span>{l("Atribut email (opsional)", "Email attribute (optional)")}</span>
            <input
              placeholder="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
              value={form.samlEmailAttribute}
              onChange={set("samlEmailAttribute")}
            />
          </label>
        </>
      ) : (
        <>
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
            <input
              type="password"
              autoComplete="off"
              value={form.clientSecret}
              onChange={set("clientSecret")}
            />
          </label>
        </>
      )}
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
        {config.id && (
          <button type="button" className="danger" onClick={remove}>
            {l("Hapus SSO", "Remove SSO")}
          </button>
        )}
      </div>
    </form>
  );
}
