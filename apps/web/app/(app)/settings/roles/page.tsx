"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { errorText } from "../../../../components/hr/hr-panels";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

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
  const columns = useMemo<ViewColumn<Role>[]>(
    () => [
      { key: "name", label: l("Nama", "Name"), value: (r) => r.name },
      { key: "code", label: l("Kode", "Code"), value: (r) => r.code },
      { key: "description", label: l("Keterangan", "Description"), value: (r) => r.description },
      {
        key: "permissions",
        label: l("Hak", "Permissions"),
        type: "number",
        value: (r) => (r.permissions.includes("*") ? Number.MAX_SAFE_INTEGER : r.permissions.length),
        searchable: false,
      },
      { key: "userCount", label: l("Pengguna", "Users"), type: "number", value: (r) => r.userCount },
      {
        key: "isSystem",
        label: l("Jenis", "Kind"),
        type: "enum",
        value: (r) => (r.isSystem ? "1" : "0"),
        optionLabel: (v) => (v === "1" ? l("Bawaan", "Built-in") : l("Kustom", "Custom")),
        hidden: true,
      },
    ],
    [l],
  );
  const table = useTableView(roles, columns, { storageKey: "roles" });
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
      <TableTools view={table} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <SortTh view={table} col="name">
                {l("Nama", "Name")}
              </SortTh>
              <SortTh view={table} col="code">
                {l("Kode", "Code")}
              </SortTh>
              <SortTh view={table} col="description">
                {l("Keterangan", "Description")}
              </SortTh>
              <SortTh view={table} col="permissions" className="num">
                {l("Hak", "Permissions")}
              </SortTh>
              <SortTh view={table} col="userCount" className="num">
                {l("Pengguna", "Users")}
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
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
      <TablePager view={table} />
    </>
  );
}
