"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface User {
  id: string;
  name: string;
  email: string;
  active: boolean;
  twoFactorEnabled: boolean;
  roles: string[];
}
interface Invitation {
  id: string;
  name: string;
  email: string;
  expiresAt: string;
}
interface Role {
  id: string;
  code: string;
  name: string;
}

export default function UsersPage() {
  const me = useMe();
  const { t, locale } = useI18n();
  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const writable = can(me.permissions, "user.write");
  const dateFmt = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { dateStyle: "medium" });

  useEffect(() => {
    api<User[]>("/users")
      .then(setUsers)
      .catch((e: Error) => setError(e.message));
    api<Invitation[]>("/invitations")
      .then(setInvitations)
      .catch(() => setInvitations([]));
    api<Role[]>("/roles")
      .then(setRoles)
      .catch(() => setRoles([]));
  }, [reload]);

  const columns = useMemo<ViewColumn<User>[]>(
    () => [
      { key: "name", label: t("auth.name"), value: (u) => u.name },
      { key: "email", label: t("auth.email"), value: (u) => u.email },
      { key: "roles", label: t("users.roles"), value: (u) => u.roles.join(", ") },
      {
        key: "twoFactor",
        label: "2FA",
        type: "enum",
        value: (u) => (u.twoFactorEnabled ? "1" : "0"),
        optionLabel: (v) => (v === "1" ? "✓" : "—"),
      },
      {
        key: "active",
        label: t("users.status"),
        type: "enum",
        value: (u) => (u.active ? "1" : "0"),
        optionLabel: (v) => (v === "1" ? t("users.active") : t("users.inactive")),
      },
    ],
    [t],
  );
  const table = useTableView(users, columns, { storageKey: "users" });

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setFieldErrors({});
    const form = e.currentTarget;
    const data = new FormData(form);
    try {
      const body = {
        name: data.get("name"),
        email: data.get("email"),
        roleIds: data.getAll("roleIds"),
        companyIds: data.getAll("companyIds"),
      };
      await api("/users/invite", { method: "POST", body });
      setNotice(t("users.sent", { email: String(body.email) }));
      form.reset();
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
    }
  }

  return (
    <>
      <header className="toolbar">
        <h1>{t("users.title")}</h1>
      </header>
      <TableTools view={table} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <SortTh view={table} col="name">
                {t("auth.name")}
              </SortTh>
              <SortTh view={table} col="email">
                {t("auth.email")}
              </SortTh>
              <SortTh view={table} col="roles">
                {t("users.roles")}
              </SortTh>
              <SortTh view={table} col="twoFactor">
                2FA
              </SortTh>
              <SortTh view={table} col="active">
                {t("users.status")}
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((u) => (
              <tr key={u.id}>
                <td>
                  <Link href={`/settings/users/${u.id}`}>{u.name}</Link>
                </td>
                <td>{u.email}</td>
                <td>{u.roles.join(", ")}</td>
                <td>{u.twoFactorEnabled ? "✓" : "—"}</td>
                <td>{u.active ? t("users.active") : <span className="muted">{t("users.inactive")}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePager view={table} />

      {invitations.length > 0 && (
        <>
          <h2>{t("users.pending")}</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {invitations.map((i) => (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td>{i.email}</td>
                    <td className="muted">
                      {t("users.expires")} {dateFmt.format(new Date(i.expiresAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {writable && (
        <form className="panel stack invite" onSubmit={invite}>
          <h2>{t("users.invite")}</h2>
          <div className="fields">
            <label className="field">
              <span>{t("auth.name")} *</span>
              <input name="name" required />
              {fieldErrors.name && <small className="error">{fieldErrors.name}</small>}
            </label>
            <label className="field">
              <span>{t("auth.email")} *</span>
              <input name="email" type="email" required />
              {fieldErrors.email && <small className="error">{fieldErrors.email}</small>}
            </label>
          </div>
          <fieldset className="choices">
            <legend>{t("users.roles")}</legend>
            {roles.map((r) => (
              <label key={r.id}>
                <input type="checkbox" name="roleIds" value={r.id} defaultChecked={r.code === "user"} />{" "}
                {r.name}
              </label>
            ))}
          </fieldset>
          <fieldset className="choices">
            <legend>{t("users.companies")} *</legend>
            {me.companies.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  name="companyIds"
                  value={c.id}
                  defaultChecked={c.id === me.activeCompanyId}
                />{" "}
                {c.code} — {c.name}
              </label>
            ))}
            {fieldErrors.companyIds && <small className="error">{fieldErrors.companyIds}</small>}
          </fieldset>
          <button className="primary">{t("users.send")}</button>
          {notice && <p className="notice">{notice}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </>
  );
}
