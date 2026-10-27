"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABEL, type WebhookEvent } from "@erp/shared";
import { api, ApiError } from "../../../../../lib/api";
import { useI18n } from "../../../../../lib/i18n";
import type { ConnectedApp } from "../page";

interface Delivery {
  id: string;
  event: string;
  state: "pending" | "sent" | "failed";
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

const lines = (v: string) =>
  v
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

const EMPTY = {
  name: "",
  redirectUris: "",
  postLogoutRedirectUris: "",
  allowedRoleIds: [] as string[],
  serviceRoleIds: [] as string[],
  webhookUrl: "",
  webhookEvents: [] as WebhookEvent[],
  active: true,
};

/** Tambah / ubah aplikasi terhubung: login OIDC, akun layanan API, webhook. */
export default function ConnectedAppPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { l, locale } = useI18n();
  const [id, setId] = useState(params.id === "new" ? null : params.id);
  const [app, setApp] = useState<ConnectedApp | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [secrets, setSecrets] = useState<{ clientSecret?: string | null; webhookSecret?: string | null }>({});
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fmt = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
    dateStyle: "short",
    timeStyle: "medium",
  });

  useEffect(() => {
    api<{ id: string; name: string }[]>("/roles/options")
      .then(setRoles)
      .catch(() => setRoles([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    api<ConnectedApp>(`/connected-apps/${id}`)
      .then((a) => {
        setApp(a);
        setForm({
          name: a.name,
          redirectUris: a.redirectUris.join("\n"),
          postLogoutRedirectUris: a.postLogoutRedirectUris.join("\n"),
          allowedRoleIds: a.allowedRoleIds,
          serviceRoleIds: [],
          webhookUrl: a.webhookUrl ?? "",
          webhookEvents: a.webhookEvents as WebhookEvent[],
          active: a.active,
        });
      })
      .catch((e: Error) => setError(e.message));
    loadDeliveries(id);
  }, [id]);

  function loadDeliveries(appId: string) {
    api<Delivery[]>(`/connected-apps/${appId}/deliveries`)
      .then(setDeliveries)
      .catch(() => setDeliveries([]));
  }

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : String(err));
    if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});
    const body = {
      name: form.name,
      redirectUris: lines(form.redirectUris),
      postLogoutRedirectUris: lines(form.postLogoutRedirectUris),
      allowedRoleIds: form.allowedRoleIds,
      webhookUrl: form.webhookUrl.trim() || null,
      webhookEvents: form.webhookEvents,
      active: form.active,
    };
    try {
      if (!id) {
        const created = await api<ConnectedApp & { clientSecret: string; webhookSecret: string | null }>(
          "/connected-apps",
          { method: "POST", body: { ...body, serviceRoleIds: form.serviceRoleIds } },
        );
        setSecrets({ clientSecret: created.clientSecret, webhookSecret: created.webhookSecret });
        // Ganti URL tanpa memuat ulang agar secret yang hanya tampil sekali tidak hilang.
        window.history.replaceState(null, "", `/settings/connected-apps/${created.id}`);
        setId(created.id);
      } else {
        const saved = await api<ConnectedApp & { webhookSecret: string | null }>(`/connected-apps/${id}`, {
          method: "PATCH",
          body,
        });
        setApp(saved);
        if (saved.webhookSecret) setSecrets((s) => ({ ...s, webhookSecret: saved.webhookSecret }));
        setNotice(l("Tersimpan.", "Saved."));
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function rotate(kind: "secret" | "webhook-secret") {
    const what = kind === "secret" ? "client secret" : l("secret webhook", "webhook secret");
    if (
      !confirm(
        l(
          `Ganti ${what}? Secret lama langsung tidak berlaku; perbarui konfigurasi aplikasi.`,
          `Replace the ${what}? The old secret stops working immediately; update the app's configuration.`,
        ),
      )
    )
      return;
    try {
      const res = await api<{ clientSecret?: string; webhookSecret?: string }>(
        `/connected-apps/${id}/rotate-${kind}`,
        { method: "POST" },
      );
      setSecrets((s) => ({ ...s, ...res }));
    } catch (err) {
      fail(err);
    }
  }

  async function testWebhook() {
    setNotice(null);
    setError(null);
    try {
      const r = await api<{ ok: boolean; status: number | null; error: string | null }>(
        `/connected-apps/${id}/webhook-test`,
        { method: "POST" },
      );
      if (r.ok) setNotice(l(`Webhook berhasil (HTTP ${r.status}).`, `Webhook succeeded (HTTP ${r.status}).`));
      else setError(l(`Webhook gagal: ${r.error}`, `Webhook failed: ${r.error}`));
    } catch (err) {
      fail(err);
    }
  }

  async function retry(deliveryId: string) {
    await api(`/webhook-deliveries/${deliveryId}/retry`, { method: "POST" }).catch(fail);
    if (id) loadDeliveries(id);
  }

  async function remove() {
    if (
      !confirm(
        l(
          "Hapus aplikasi ini? Login & token API aplikasi langsung berhenti.",
          "Delete this app? Its sign-in and API tokens stop working immediately.",
        ),
      )
    )
      return;
    try {
      await api(`/connected-apps/${id}`, { method: "DELETE" });
      router.replace("/settings/connected-apps");
    } catch (err) {
      fail(err);
    }
  }

  if (id && !app) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;

  const toggle = (key: "allowedRoleIds" | "serviceRoleIds", roleId: string) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(roleId) ? f[key].filter((x) => x !== roleId) : [...f[key], roleId],
    }));
  const toggleEvent = (ev: WebhookEvent) =>
    setForm((f) => ({
      ...f,
      webhookEvents: f.webhookEvents.includes(ev)
        ? f.webhookEvents.filter((x) => x !== ev)
        : [...f.webhookEvents, ev],
    }));
  const copyField = (label: string, value: string) => (
    <label className="field">
      <span>{label}</span>
      <input readOnly value={value} onFocus={(e) => e.target.select()} />
    </label>
  );
  const err = (name: string) => {
    const msg = Object.entries(fieldErrors).find(([k]) => k === name || k.startsWith(`${name}.`))?.[1];
    return msg && <small className="error">{msg}</small>;
  };

  return (
    <>
      <header className="toolbar">
        <nav className="breadcrumb">
          <Link href="/settings/connected-apps">{l("Aplikasi Terhubung", "Connected Apps")}</Link>
          <span>/</span>
          <h1>{app?.name ?? l("Aplikasi baru", "New app")}</h1>
        </nav>
      </header>

      {(secrets.clientSecret || secrets.webhookSecret) && (
        <div className="panel stack secret-box">
          <strong>
            {l(
              "Simpan secret berikut sekarang — hanya ditampilkan sekali.",
              "Store these secrets now — they are shown only once.",
            )}
          </strong>
          {secrets.clientSecret && copyField("Client secret", secrets.clientSecret)}
          {secrets.webhookSecret && copyField(l("Secret webhook", "Webhook secret"), secrets.webhookSecret)}
        </div>
      )}

      <form className="panel stack narrow" onSubmit={save}>
        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        <label className="field">
          <span>{l("Nama aplikasi", "App name")} *</span>
          <input
            required
            maxLength={100}
            placeholder={l("mis. Aplikasi Proyek", "e.g. Project app")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          {err("name")}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          {l("Aktif", "Active")}
        </label>

        {app && (
          <>
            <h2>{l("Kredensial", "Credentials")}</h2>
            {copyField("Client ID", app.clientId)}
            {copyField(l("URL discovery (issuer)", "Discovery URL (issuer)"), app.discoveryUrl)}
            <div>
              <button type="button" onClick={() => rotate("secret")}>
                {l("Ganti client secret", "Replace client secret")}
              </button>
            </div>
          </>
        )}

        <h2>{l("Login dengan akun ERP", "Sign in with ERP")}</h2>
        <label className="field">
          <span>{l("Redirect URI (satu per baris)", "Redirect URIs (one per line)")}</span>
          <textarea
            rows={3}
            spellCheck={false}
            placeholder="https://proyek.perusahaan.co.id/api/auth/callback/erp"
            value={form.redirectUris}
            onChange={(e) => setForm({ ...form, redirectUris: e.target.value })}
          />
          {err("redirectUris")}
        </label>
        <label className="field">
          <span>{l("URL kembali setelah logout (opsional)", "Post-logout redirect URIs (optional)")}</span>
          <textarea
            rows={2}
            spellCheck={false}
            placeholder="https://proyek.perusahaan.co.id/"
            value={form.postLogoutRedirectUris}
            onChange={(e) => setForm({ ...form, postLogoutRedirectUris: e.target.value })}
          />
          {err("postLogoutRedirectUris")}
        </label>
        <fieldset className="field">
          <legend>
            {l(
              "Peran yang boleh masuk (kosong = semua pengguna aktif)",
              "Roles allowed to sign in (none = all active users)",
            )}
          </legend>
          <div className="check-grid">
            {roles.map((r) => (
              <label key={r.id} className="check">
                <input
                  type="checkbox"
                  checked={form.allowedRoleIds.includes(r.id)}
                  onChange={() => toggle("allowedRoleIds", r.id)}
                />
                {r.name}
              </label>
            ))}
          </div>
        </fieldset>

        <h2>{l("Akses API (akun layanan)", "API access (service account)")}</h2>
        <p className="muted">
          {l(
            "Aplikasi mengambil token dengan grant client_credentials. Hak API = peran akun layanan, misalnya peran yang hanya punya Karyawan › Lihat.",
            "The app gets a token with the client_credentials grant. API rights = the service account's roles, e.g. a role with only Employees › View.",
          )}
        </p>
        {app ? (
          app.serviceUser ? (
            <p>
              {app.serviceUser.name}:{" "}
              {app.serviceUser.roles.map((r) => r.name).join(", ") || l("belum ada peran", "no roles yet")} ·{" "}
              <Link href={`/settings/users/${app.serviceUser.id}`}>
                {l("Atur hak akun layanan", "Manage service account access")}
              </Link>
            </p>
          ) : (
            <p className="muted">—</p>
          )
        ) : (
          <div className="check-grid">
            {roles.map((r) => (
              <label key={r.id} className="check">
                <input
                  type="checkbox"
                  checked={form.serviceRoleIds.includes(r.id)}
                  onChange={() => toggle("serviceRoleIds", r.id)}
                />
                {r.name}
              </label>
            ))}
          </div>
        )}

        <h2>Webhook</h2>
        <label className="field">
          <span>{l("URL penerima (opsional)", "Receiver URL (optional)")}</span>
          <input
            type="url"
            placeholder="https://proyek.perusahaan.co.id/api/erp/webhook"
            value={form.webhookUrl}
            onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
          />
          {err("webhookUrl")}
        </label>
        <div className="check-grid">
          {WEBHOOK_EVENTS.map((ev) => (
            <label key={ev} className="check">
              <input
                type="checkbox"
                checked={form.webhookEvents.includes(ev)}
                onChange={() => toggleEvent(ev)}
              />
              {l(...WEBHOOK_EVENT_LABEL[ev])}
            </label>
          ))}
        </div>
        {app?.webhookUrl && (
          <div className="form-actions">
            <button type="button" onClick={testWebhook}>
              {l("Tes webhook", "Test webhook")}
            </button>
            <button type="button" onClick={() => rotate("webhook-secret")}>
              {l("Ganti secret webhook", "Replace webhook secret")}
            </button>
          </div>
        )}

        <div className="form-actions">
          <button className="primary" disabled={busy}>
            {busy ? l("Menyimpan…", "Saving…") : id ? l("Simpan", "Save") : l("Buat aplikasi", "Create app")}
          </button>
          {app && (
            <button type="button" className="danger" onClick={remove}>
              {l("Hapus aplikasi", "Delete app")}
            </button>
          )}
        </div>
      </form>

      {app?.webhookUrl && (
        <>
          <h2>{l("Pengiriman webhook terakhir", "Recent webhook deliveries")}</h2>
          {deliveries.length === 0 ? (
            <p className="muted">{l("Belum ada pengiriman.", "No deliveries yet.")}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{l("Waktu", "Time")}</th>
                    <th>Event</th>
                    <th>Status</th>
                    <th>{l("Percobaan", "Attempts")}</th>
                    <th>{l("Respons", "Response")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id}>
                      <td>{fmt.format(new Date(d.createdAt))}</td>
                      <td>{d.event}</td>
                      <td>
                        <span
                          className={`pill ${d.state === "sent" ? "ok" : d.state === "failed" ? "bad" : "warn"}`}
                        >
                          {d.state === "sent"
                            ? l("Terkirim", "Sent")
                            : d.state === "failed"
                              ? l("Gagal", "Failed")
                              : l("Antre", "Queued")}
                        </span>
                      </td>
                      <td>{d.attempts}</td>
                      <td className="muted">
                        {d.lastError ?? (d.responseStatus ? `HTTP ${d.responseStatus}` : "—")}
                      </td>
                      <td>
                        {d.state !== "sent" && (
                          <button type="button" onClick={() => retry(d.id)}>
                            {l("Kirim ulang", "Retry")}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
