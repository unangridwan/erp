"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorText } from "../../../../../components/hr/hr-panels";
import { useMe } from "../../../../../components/me-context";
import {
  PermissionMatrix,
  permissionOptions,
  useCatalog,
  usePermissionLabel,
} from "../../../../../components/settings/access-panels";
import { ApprovalSummary } from "../../../../../components/settings/approval-panels";
import { api } from "../../../../../lib/api";
import { formatDate } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";
import { ask } from "../../../../../components/feedback";

interface Detail {
  id: string;
  name: string;
  email: string;
  active: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  companies: { companyId: string; isDefault: boolean; name: string }[];
  roles: { id: string; roleId: string; roleName: string; companyId: string | null }[];
  overrides: {
    permission: string;
    effect: "grant" | "deny";
    companyId: string | null;
    note: string | null;
  }[];
}
interface Access {
  company: { id: string; code: string; name: string };
  permissions: string[];
  sources: Record<string, string[]>;
  denied: string[];
}
interface Role {
  id: string;
  name: string;
}
interface LogRow {
  id: string;
  message: string | null;
  changes: unknown;
  createdAt: string;
  by: string | null;
}

type Tab = "roles" | "overrides" | "effective" | "approvals" | "log";

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { l, locale } = useI18n();
  const me = useMe();
  const catalog = useCatalog();
  const label = usePermissionLabel(catalog);
  const writable = can(me.permissions, "user.write") && id !== me.userId;
  const [user, setUser] = useState<Detail | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [access, setAccess] = useState<Access[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [tab, setTab] = useState<Tab>("roles");
  const [company, setCompany] = useState("");
  const [assignments, setAssignments] = useState<{ roleId: string; companyId: string }[]>([]);
  const [overrides, setOverrides] = useState<Detail["overrides"]>([]);
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [defaultCompany, setDefaultCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [u, a, lg] = await Promise.all([
      api<Detail>(`/users/${id}`),
      api<Access[]>(`/users/${id}/access`),
      api<LogRow[]>(`/users/${id}/access-log`),
    ]);
    setUser(u);
    setAccess(a);
    setLog(lg);
    setAssignments(u.roles.map((r) => ({ roleId: r.roleId, companyId: r.companyId ?? "" })));
    setOverrides(u.overrides);
    setCompanyIds(u.companies.map((c) => c.companyId));
    setDefaultCompany(u.companies.find((c) => c.isDefault)?.companyId ?? u.companies[0]?.companyId ?? "");
    setCompany((c) => c || a[0]?.company.id || "");
  }, [id]);
  useEffect(() => {
    load().catch((e) => setError(errorText(e)));
    api<Role[]>("/roles").then(setRoles, () => setRoles([]));
  }, [load]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      await load();
      setNotice(done);
    } catch (e) {
      setError(errorText(e));
    }
  }
  const options = useMemo(() => (catalog ? permissionOptions(catalog) : []), [catalog]);
  const current = access.find((a) => a.company.id === company);

  if (!user)
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : null;
  return (
    <>
      <header className="toolbar">
        <h1>
          <Link href="/settings/users">{l("Pengguna", "Users")}</Link> / {user.name}
        </h1>
        {writable &&
          (user.active ? (
            <button
              type="button"
              className="danger"
              onClick={async () =>
                (await ask(
                  l(
                    "Nonaktifkan akun ini? Semua sesinya akan keluar.",
                    "Deactivate this account? All its sessions end.",
                  ),
                )) &&
                run(
                  () => api(`/users/${id}/deactivate`, { method: "POST" }),
                  l("Akun dinonaktifkan.", "Account deactivated."),
                )
              }
            >
              {l("Nonaktifkan", "Deactivate")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                run(
                  () => api(`/users/${id}/activate`, { method: "POST" }),
                  l("Akun diaktifkan.", "Account activated."),
                )
              }
            >
              {l("Aktifkan", "Activate")}
            </button>
          ))}
        {writable && user.twoFactorEnabled && (
          <button
            type="button"
            onClick={async () =>
              (await ask(
                l(
                  "Reset verifikasi dua langkah pengguna ini?",
                  "Reset this user's two-factor authentication?",
                ),
              )) &&
              run(() => api(`/users/${id}/reset-2fa`, { method: "POST" }), l("2FA direset.", "2FA reset."))
            }
          >
            {l("Reset 2FA", "Reset 2FA")}
          </button>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="success">{notice}</p>}

      <section className="panel">
        <div className="cards">
          <div className="card">
            <span>{l("Email", "Email")}</span>
            <strong>{user.email}</strong>
          </div>
          <div className="card">
            <span>{l("Status", "Status")}</span>
            <strong>{user.active ? l("Aktif", "Active") : l("Nonaktif", "Inactive")}</strong>
          </div>
          <div className="card">
            <span>2FA</span>
            <strong>{user.twoFactorEnabled ? l("Aktif", "On") : l("Tidak", "Off")}</strong>
          </div>
          <div className="card">
            <span>{l("Login terakhir", "Last login")}</span>
            <strong>{user.lastLoginAt ? formatDate(user.lastLoginAt, locale) : "—"}</strong>
          </div>
        </div>
        <h2>{l("Perusahaan yang boleh diakses", "Companies this user can access")}</h2>
        <div className="choices">
          {me.companies.map((c) => (
            <label key={c.id}>
              <input
                type="checkbox"
                disabled={!writable}
                checked={companyIds.includes(c.id)}
                onChange={(e) =>
                  setCompanyIds(
                    e.target.checked ? [...companyIds, c.id] : companyIds.filter((x) => x !== c.id),
                  )
                }
              />{" "}
              {c.code} — {c.name}{" "}
              <input
                type="radio"
                name="default-company"
                disabled={!writable || !companyIds.includes(c.id)}
                checked={defaultCompany === c.id}
                onChange={() => setDefaultCompany(c.id)}
                aria-label={l("Default", "Default")}
              />{" "}
              <small className="muted">{l("default", "default")}</small>
            </label>
          ))}
        </div>
        {writable && (
          <button
            type="button"
            onClick={() =>
              run(
                () =>
                  api(`/users/${id}`, {
                    method: "PATCH",
                    body: { companyIds, defaultCompanyId: defaultCompany },
                  }),
                l("Akses perusahaan disimpan.", "Company access saved."),
              )
            }
          >
            {l("Simpan perusahaan", "Save companies")}
          </button>
        )}
      </section>

      <nav role="tablist" className="tabs">
        {(
          [
            ["roles", l("Peran", "Roles")],
            ["overrides", l("Hak khusus", "Specific permissions")],
            ["effective", l("Hak efektif", "Effective permissions")],
            ["approvals", l("Persetujuan", "Approvals")],
            ["log", l("Riwayat akses", "Access history")],
          ] as [Tab, string][]
        ).map(([k, t]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? "active" : ""}
            onClick={() => setTab(k)}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "roles" && (
        <section className="panel">
          <p className="muted">
            {l(
              "Peran bisa berlaku di semua perusahaan atau hanya satu perusahaan.",
              "A role can apply to all companies or to one company only.",
            )}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Peran", "Role")}</th>
                  <th>{l("Berlaku di", "Applies to")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {assignments.map((a, i) => (
                  <tr key={i}>
                    <td>
                      <select
                        disabled={!writable}
                        value={a.roleId}
                        onChange={(e) =>
                          setAssignments(
                            assignments.map((x, j) => (j === i ? { ...x, roleId: e.target.value } : x)),
                          )
                        }
                      >
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        disabled={!writable}
                        value={a.companyId}
                        onChange={(e) =>
                          setAssignments(
                            assignments.map((x, j) => (j === i ? { ...x, companyId: e.target.value } : x)),
                          )
                        }
                      >
                        <option value="">{l("Semua perusahaan", "All companies")}</option>
                        {user.companies.map((c) => (
                          <option key={c.companyId} value={c.companyId}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {writable && (
                        <button
                          type="button"
                          className="link"
                          onClick={() => setAssignments(assignments.filter((_, j) => j !== i))}
                        >
                          {l("Lepas", "Remove")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {writable && (
            <div className="form-actions">
              <button
                type="button"
                onClick={() =>
                  roles[0] && setAssignments([...assignments, { roleId: roles[0].id, companyId: "" }])
                }
              >
                {l("+ Tambah peran", "+ Add role")}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() =>
                  run(
                    () =>
                      api(`/users/${id}/roles`, {
                        method: "PUT",
                        body: {
                          roles: assignments.map((a) => ({
                            roleId: a.roleId,
                            companyId: a.companyId || null,
                          })),
                        },
                      }),
                    l("Peran disimpan.", "Roles saved."),
                  )
                }
              >
                {l("Simpan peran", "Save roles")}
              </button>
            </div>
          )}
        </section>
      )}

      {tab === "overrides" && (
        <section className="panel">
          <p className="muted">
            {l(
              "Tambahkan hak tertentu di luar peran (mis. hanya Laporan Keuangan), atau cabut satu fitur/aksi dari peran yang dimiliki (mis. cabut Ekspor data karyawan). Cabutan selalu menang atas peran.",
              "Grant a specific permission outside the roles (e.g. Financial reports only), or revoke one feature/action from the user's roles (e.g. revoke exporting employee data). Revocations always win over roles.",
            )}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Hak", "Permission")}</th>
                  <th>{l("Tindakan", "Action")}</th>
                  <th>{l("Berlaku di", "Applies to")}</th>
                  <th>{l("Catatan", "Note")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {overrides.map((o, i) => {
                  const set = (patch: Partial<Detail["overrides"][number]>) =>
                    setOverrides(overrides.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  return (
                    <tr key={i}>
                      <td>
                        <select
                          disabled={!writable}
                          value={o.permission}
                          onChange={(e) => set({ permission: e.target.value })}
                        >
                          {options.map((c) => (
                            <option key={c} value={c}>
                              {label(c)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          disabled={!writable}
                          value={o.effect}
                          onChange={(e) => set({ effect: e.target.value as "grant" | "deny" })}
                        >
                          <option value="grant">{l("Tambah", "Grant")}</option>
                          <option value="deny">{l("Cabut", "Revoke")}</option>
                        </select>
                      </td>
                      <td>
                        <select
                          disabled={!writable}
                          value={o.companyId ?? ""}
                          onChange={(e) => set({ companyId: e.target.value || null })}
                        >
                          <option value="">{l("Semua perusahaan", "All companies")}</option>
                          {user.companies.map((c) => (
                            <option key={c.companyId} value={c.companyId}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          disabled={!writable}
                          value={o.note ?? ""}
                          onChange={(e) => set({ note: e.target.value })}
                        />
                      </td>
                      <td>
                        {writable && (
                          <button
                            type="button"
                            className="link"
                            onClick={() => setOverrides(overrides.filter((_, j) => j !== i))}
                          >
                            {l("Hapus", "Remove")}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {writable && (
            <div className="form-actions">
              <button
                type="button"
                onClick={() =>
                  options[0] &&
                  setOverrides([
                    ...overrides,
                    { permission: options[0], effect: "deny", companyId: null, note: null },
                  ])
                }
              >
                {l("+ Tambah hak khusus", "+ Add specific permission")}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() =>
                  run(
                    () => api(`/users/${id}/overrides`, { method: "PUT", body: { overrides } }),
                    l("Hak khusus disimpan.", "Specific permissions saved."),
                  )
                }
              >
                {l("Simpan hak khusus", "Save specific permissions")}
              </button>
            </div>
          )}
        </section>
      )}

      {tab === "effective" && (
        <section className="panel">
          <label className="field">
            <span>{l("Perusahaan", "Company")}</span>
            <select value={company} onChange={(e) => setCompany(e.target.value)}>
              {access.map((a) => (
                <option key={a.company.id} value={a.company.id}>
                  {a.company.code} — {a.company.name}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            {l(
              "Hasil gabungan peran yang berlaku di perusahaan ini dan hak khusus akun. Arahkan kursor ke kotak untuk melihat asal hak.",
              "The combination of roles that apply in this company and account-specific permissions. Hover a box to see where it comes from.",
            )}
          </p>
          {current && current.denied.length > 0 && (
            <p>
              {l("Dicabut khusus:", "Revoked:")} {current.denied.map(label).join(" · ")}
            </p>
          )}
          {catalog && current && (
            <PermissionMatrix
              catalog={catalog}
              value={current.permissions}
              sources={current.sources}
              denied={current.denied}
            />
          )}
        </section>
      )}

      {tab === "approvals" && (
        <section className="panel">
          <ApprovalSummary url={`/users/${id}/approvals`} />
        </section>
      )}

      {tab === "log" && (
        <section className="panel">
          {log.length ? (
            <ul className="plain-list">
              {log.map((r) => (
                <li key={r.id}>
                  <strong>{r.message}</strong> · {r.by ?? "—"} ·{" "}
                  <span className="muted">
                    {new Date(r.createdAt).toLocaleString(locale === "id" ? "id-ID" : "en-GB")}
                  </span>
                  {r.changes != null && (
                    <pre className="small muted">{JSON.stringify(r.changes, null, 1)}</pre>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{l("Belum ada perubahan akses.", "No access changes yet.")}</p>
          )}
        </section>
      )}
    </>
  );
}
