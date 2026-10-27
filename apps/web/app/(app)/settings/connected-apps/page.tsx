"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

export interface ConnectedApp {
  id: string;
  name: string;
  clientId: string;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  allowedRoleIds: string[];
  allowedRoles: { id: string; name: string }[];
  serviceUser: { id: string; name: string; active: boolean; roles: { id: string; name: string }[] } | null;
  webhookUrl: string | null;
  webhookEvents: string[];
  hasWebhookSecret: boolean;
  active: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  deliveries: { pending: number; failed: number; lastSentAt: string | null };
  discoveryUrl: string;
}

/** Pengaturan › Aplikasi Terhubung: aplikasi luar yang login memakai akun ERP & memanggil API ERP. */
export default function ConnectedAppsPage() {
  const { l, locale } = useI18n();
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fmt = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  useEffect(() => {
    api<ConnectedApp[]>("/connected-apps")
      .then(setApps)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <header className="toolbar">
        <h1>{l("Aplikasi Terhubung", "Connected Apps")}</h1>
        <Link className="button primary" href="/settings/connected-apps/new">
          {l("Tambah aplikasi", "Add app")}
        </Link>
      </header>
      <p className="muted">
        {l(
          "Aplikasi lain (mis. aplikasi manajemen proyek) bisa memakai akun ERP untuk login (OpenID Connect), membaca data karyawan lewat API dengan akun layanan, dan menerima webhook saat data karyawan berubah.",
          "Other apps (e.g. a project management app) can use ERP accounts to sign in (OpenID Connect), read employee data through the API with a service account, and receive webhooks when employee data changes.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {apps && apps.length === 0 && (
        <p className="muted">{l("Belum ada aplikasi terhubung.", "No connected apps yet.")}</p>
      )}
      {apps && apps.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Nama", "Name")}</th>
                <th>{l("Login", "Sign-in")}</th>
                <th>API</th>
                <th>Webhook</th>
                <th>{l("Terakhir dipakai", "Last used")}</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/settings/connected-apps/${a.id}`}>{a.name}</Link>
                  </td>
                  <td>
                    {a.redirectUris.length
                      ? a.allowedRoles.length
                        ? a.allowedRoles.map((r) => r.name).join(", ")
                        : l("Semua pengguna", "All users")
                      : "—"}
                  </td>
                  <td>{a.serviceUser?.roles.map((r) => r.name).join(", ") || "—"}</td>
                  <td>
                    {a.webhookUrl ? (
                      <>
                        {a.webhookEvents.length} {l("event", "events")}
                        {a.deliveries.failed > 0 && (
                          <span className="badge danger">
                            {" "}
                            {a.deliveries.failed} {l("gagal", "failed")}
                          </span>
                        )}
                        {a.deliveries.pending > 0 && (
                          <span className="badge warn">
                            {" "}
                            {a.deliveries.pending} {l("antre", "queued")}
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{a.lastUsedAt ? fmt.format(new Date(a.lastUsedAt)) : "—"}</td>
                  <td>
                    <span className={`pill ${a.active ? "ok" : ""}`}>
                      {a.active ? l("Aktif", "Active") : l("Nonaktif", "Inactive")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
