"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

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

  const columns = useMemo<ViewColumn<ConnectedApp>[]>(
    () => [
      { key: "name", label: l("Nama", "Name"), value: (a) => a.name, text: (a) => `${a.name} ${a.clientId}` },
      {
        key: "login",
        label: l("Login", "Sign-in"),
        value: (a) =>
          a.redirectUris.length
            ? a.allowedRoles.length
              ? a.allowedRoles.map((r) => r.name).join(", ")
              : l("Semua pengguna", "All users")
            : null,
      },
      { key: "api", label: "API", value: (a) => a.serviceUser?.roles.map((r) => r.name).join(", ") || null },
      {
        key: "webhook",
        label: "Webhook",
        type: "enum",
        value: (a) => (!a.webhookUrl ? "none" : a.deliveries.failed > 0 ? "failed" : "ok"),
        optionLabel: (v) =>
          v === "none"
            ? l("Tanpa webhook", "No webhook")
            : v === "failed"
              ? l("Ada yang gagal", "Has failures")
              : l("Lancar", "Healthy"),
      },
      {
        key: "lastUsedAt",
        label: l("Terakhir dipakai", "Last used"),
        type: "date",
        value: (a) => a.lastUsedAt,
      },
      {
        key: "active",
        label: "Status",
        type: "enum",
        value: (a) => (a.active ? "1" : "0"),
        optionLabel: (v) => (v === "1" ? l("Aktif", "Active") : l("Nonaktif", "Inactive")),
      },
    ],
    [l],
  );
  const table = useTableView(apps ?? [], columns, { storageKey: "connected-apps" });

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
      {apps && apps.length > 0 && <TableTools view={table} />}
      {apps && apps.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh view={table} col="name">
                  {l("Nama", "Name")}
                </SortTh>
                <SortTh view={table} col="login">
                  {l("Login", "Sign-in")}
                </SortTh>
                <SortTh view={table} col="api">
                  API
                </SortTh>
                <SortTh view={table} col="webhook">
                  Webhook
                </SortTh>
                <SortTh view={table} col="lastUsedAt">
                  {l("Terakhir dipakai", "Last used")}
                </SortTh>
                <SortTh view={table} col="active">
                  Status
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((a) => (
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
      {apps && apps.length > 0 && <TablePager view={table} />}
    </>
  );
}
