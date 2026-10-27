"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { errorText } from "../../../../components/hr/hr-panels";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
}

export default function RolesPage() {
  const { l } = useI18n();
  const me = useMe();
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Role[]>("/roles").then(setRoles, (e) => setError(errorText(e)));
  }, []);
  return (
    <>
      <header className="toolbar">
        {can(me.permissions, "role.manage") && (
          <Link className="button primary" href="/settings/roles/new">
            {l("Peran baru", "New role")}
          </Link>
        )}
        <h1>{l("Peran & Hak Akses", "Roles & Permissions")}</h1>
      </header>
      <p className="muted">
        {l(
          "Peran menentukan modul, fitur, dan aksi (lihat, ekspor, ubah, hapus, kelola) yang boleh dipakai. Peran bisa diberikan per perusahaan di halaman pengguna, dan hak tiap akun bisa ditambah atau dicabut secara khusus.",
          "Roles define which modules, features and actions (view, export, edit, delete, manage) can be used. Roles can be assigned per company on the user page, and each account's permissions can be granted or revoked individually.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Nama", "Name")}</th>
              <th>{l("Kode", "Code")}</th>
              <th>{l("Keterangan", "Description")}</th>
              <th className="num">{l("Hak", "Permissions")}</th>
              <th className="num">{l("Pengguna", "Users")}</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/settings/roles/${r.id}`}>{r.name}</Link>{" "}
                  {r.isSystem && <span className="badge">{l("bawaan", "built-in")}</span>}
                </td>
                <td className="muted">{r.code}</td>
                <td>{r.description ?? ""}</td>
                <td className="num">
                  {r.permissions.includes("*") ? l("Semua", "All") : r.permissions.length}
                </td>
                <td className="num">{r.userCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
