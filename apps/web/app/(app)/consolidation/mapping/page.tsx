"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Row {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  groupAccountId: string | null;
}
interface GroupAccount {
  id: string;
  code: string;
  name: string;
  accountType: string;
}

/** Pemetaan bagan akun tiap perusahaan ke bagan akun grup (dasar kertas kerja konsolidasi). */
export default function ConsolidationMappingPage() {
  const me = useMe();
  const { l } = useI18n();
  const manage = can(me.permissions, "consolidation.manage");
  const [companyId, setCompanyId] = useState(me.activeCompanyId);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [groups, setGroups] = useState<GroupAccount[]>([]);
  const [changed, setChanged] = useState<Record<string, string>>({});
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [m, g] = await Promise.all([
      api<Row[]>(`/consolidation/mapping?companyId=${companyId}`),
      api<{ items: GroupAccount[] }>("/group-accounts?limit=200"),
    ]);
    setRows(m);
    setGroups(g.items);
    setChanged({});
  }, [companyId]);
  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);

  async function act(action: () => Promise<string>) {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      setMessage(await action());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const value = (r: Row) => changed[r.accountId] ?? r.groupAccountId ?? "";
  const unmapped = rows?.filter((r) => !value(r)).length ?? 0;
  const shown = useMemo(
    () => (rows ?? []).filter((r) => !onlyUnmapped || !(changed[r.accountId] ?? r.groupAccountId)),
    [rows, onlyUnmapped, changed],
  );

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <h1>{l("Pemetaan Akun", "Account Mapping")}</h1>
          {manage && (
            <button
              className="primary"
              disabled={busy || Object.keys(changed).length === 0}
              onClick={() =>
                act(async () => {
                  await api("/consolidation/mapping", {
                    method: "PUT",
                    body: {
                      companyId,
                      items: Object.entries(changed).map(([accountId, g]) => ({
                        accountId,
                        groupAccountId: g || null,
                      })),
                    },
                  });
                  return l("Pemetaan disimpan.", "Mapping saved.");
                })
              }
            >
              {l("Simpan", "Save")}
            </button>
          )}
        </div>
        <div className="cp-right">
          {manage && (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const r = await api<{ created: number; mapped: number }>("/consolidation/bootstrap", {
                      method: "POST",
                    });
                    return l(
                      `${r.created} akun grup dibuat, ${r.mapped} akun dipetakan.`,
                      `${r.created} group accounts created, ${r.mapped} accounts mapped.`,
                    );
                  })
                }
              >
                {l("Buat bagan akun grup", "Create group chart")}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const r = await api<{ mapped: number; groupAccountsCreated: number }>(
                      "/consolidation/mapping/auto",
                      {
                        method: "POST",
                      },
                    );
                    return l(
                      `${r.mapped} akun dipetakan otomatis (${r.groupAccountsCreated} akun grup baru).`,
                      `${r.mapped} accounts auto-mapped (${r.groupAccountsCreated} new group accounts).`,
                    );
                  })
                }
              >
                {l("Petakan otomatis (kode sama)", "Auto-map (same code)")}
              </button>
            </>
          )}
        </div>
      </header>
      <p className="muted">
        {l(
          "Setiap akun perusahaan dalam grup harus dipetakan ke satu akun grup. Akun grup berperan khusus (investasi, goodwill, KNP, selisih kurs penjabaran, dll.) diatur di Bagan Akun Grup.",
          "Every company account in the group must map to one group account. Special-role group accounts (investment, goodwill, NCI, translation reserve, etc.) are set in the Group Chart of Accounts.",
        )}
      </p>
      {message && <div className="banner">{message}</div>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="inline-panel">
        <label className="field">
          <span>{l("Perusahaan", "Company")}</span>
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {me.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyUnmapped} onChange={(e) => setOnlyUnmapped(e.target.checked)} />{" "}
          {l("Hanya yang belum dipetakan", "Unmapped only")}
        </label>
        {rows && (
          <span className={unmapped ? "error" : "muted"}>
            {unmapped
              ? l(`${unmapped} akun belum dipetakan`, `${unmapped} accounts unmapped`)
              : l("Semua akun sudah dipetakan", "All accounts mapped")}
          </span>
        )}
      </div>
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Akun perusahaan", "Company account")}</th>
                <th>{l("Tipe", "Type")}</th>
                <th>{l("Akun grup", "Group account")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const g = groups.find((x) => x.id === value(r));
                return (
                  <tr key={r.accountId}>
                    <td>
                      {r.code} {r.name}
                    </td>
                    <td className="muted">{r.accountType}</td>
                    <td>
                      {manage ? (
                        <select
                          value={value(r)}
                          onChange={(e) => setChanged((c) => ({ ...c, [r.accountId]: e.target.value }))}
                        >
                          <option value="">{l("— belum dipetakan —", "— unmapped —")}</option>
                          {groups.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.code} {x.name}
                            </option>
                          ))}
                        </select>
                      ) : g ? (
                        `${g.code} ${g.name}`
                      ) : (
                        "—"
                      )}
                      {g && g.accountType !== r.accountType && (
                        <span
                          className="badge state-sent"
                          title={l("Tipe akun berbeda", "Account type differs")}
                        >
                          {" "}
                          ⚠ {g.accountType}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    {l("Tidak ada akun.", "No accounts.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
