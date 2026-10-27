"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { errorText } from "../../../../../components/hr/hr-panels";
import { useMe } from "../../../../../components/me-context";
import { PermissionMatrix, useCatalog } from "../../../../../components/settings/access-panels";
import { ApprovalSummary } from "../../../../../components/settings/approval-panels";
import { api } from "../../../../../lib/api";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";

interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  users: { id: string; name: string; email: string; companyId: string | null }[];
}

export default function RoleFormPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const { l } = useI18n();
  const me = useMe();
  const catalog = useCatalog();
  const editable = can(me.permissions, "role.manage");
  const [role, setRole] = useState<Role | null>(null);
  const [form, setForm] = useState({ code: "", name: "", description: "", permissions: [] as string[] });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) return;
    api<Role>(`/roles/${id}`).then(
      (r) => {
        setRole(r);
        setForm({ code: r.code, name: r.name, description: r.description ?? "", permissions: r.permissions });
      },
      (e) => setError(errorText(e)),
    );
  }, [id, isNew]);

  const locked = !editable || (role?.isSystem && role.permissions.includes("*"));
  async function save() {
    setError(null);
    setNotice(null);
    try {
      const body = { ...form, description: form.description || null };
      if (isNew) {
        const created = await api<{ id: string }>("/roles", { method: "POST", body });
        router.replace(`/settings/roles/${created.id}`);
      } else {
        await api(`/roles/${id}`, { method: "PUT", body });
        setNotice(l("Peran disimpan.", "Role saved."));
      }
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function remove() {
    if (!confirm(l("Hapus peran ini?", "Delete this role?"))) return;
    try {
      await api(`/roles/${id}`, { method: "DELETE" });
      router.replace("/settings/roles");
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <>
      <header className="toolbar">
        <h1>
          <Link href="/settings/roles">{l("Peran", "Roles")}</Link> / {isNew ? l("Baru", "New") : form.name}
        </h1>
        {!locked && (
          <button type="button" className="primary" onClick={save}>
            {l("Simpan", "Save")}
          </button>
        )}
        {editable && !isNew && !role?.isSystem && (
          <button type="button" className="danger" onClick={remove}>
            {l("Hapus", "Delete")}
          </button>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}
      <section className="panel">
        <div className="fields">
          <label className="field">
            <span>{l("Nama peran", "Role name")} *</span>
            <input
              value={form.name}
              disabled={!editable}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Kode", "Code")} *</span>
            <input
              value={form.code}
              disabled={!editable || role?.isSystem}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Keterangan", "Description")}</span>
            <input
              value={form.description}
              disabled={!editable}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          {isNew && catalog && (
            <label className="field">
              <span>{l("Mulai dari templat", "Start from template")}</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  const t = catalog.templates.find((x) => x.code === e.target.value);
                  if (t)
                    setForm({
                      code: form.code || t.code,
                      name: form.name || l(...t.name),
                      description: form.description || l(...t.description),
                      permissions: [...t.permissions],
                    });
                }}
              >
                <option value="">—</option>
                {catalog.templates.map((t) => (
                  <option key={t.code} value={t.code}>
                    {l(...t.name)} — {l(...t.description)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>
      <section className="panel">
        <h2>{l("Hak akses", "Permissions")}</h2>
        <p className="muted">
          {l(
            "Centang aksi di baris modul untuk seluruh modul, atau di tabel fitur untuk fitur tertentu saja. Lihat menyertakan ekspor; ubah menyertakan hapus — cabut terpisah lewat hak khusus pengguna bila perlu.",
            "Tick an action on the module row for the whole module, or in the feature table for specific features only. View includes export; edit includes delete — revoke them separately via user-specific permissions if needed.",
          )}
        </p>
        {catalog && (
          <PermissionMatrix
            catalog={catalog}
            value={form.permissions}
            onChange={locked ? undefined : (permissions) => setForm({ ...form, permissions })}
          />
        )}
      </section>
      {role && editable && (
        <section className="panel">
          <h2>{l("Persetujuan", "Approvals")}</h2>
          <ApprovalSummary url={`/roles/${role.id}/approvals`} />
        </section>
      )}
      {role && role.users.length > 0 && (
        <section className="panel">
          <h2>{l("Pengguna dengan peran ini", "Users with this role")}</h2>
          <ul className="plain-list">
            {role.users.map((u) => (
              <li key={`${u.id}-${u.companyId ?? ""}`}>
                <Link href={`/settings/users/${u.id}`}>{u.name}</Link>{" "}
                <span className="muted">{u.email}</span>{" "}
                {u.companyId && (
                  <span className="badge">
                    {me.companies.find((c) => c.id === u.companyId)?.code ?? u.companyId}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
