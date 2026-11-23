"use client";

import { OFFER_PLACEHOLDERS } from "@erp/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorText } from "../../../../components/hr/hr-panels";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";
import { ask } from "../../../../components/feedback";

interface Reason {
  id: string;
  name: string;
  sequence: number;
  active: boolean;
}
interface Template {
  id: string;
  name: string;
  body: string;
  active: boolean;
}

/** Konfigurasi rekrutmen: master alasan penolakan pelamar & template surat penawaran kerja. */
export default function RecruitmentSettingsPage() {
  const { l } = useI18n();
  const manage = can(useMe().permissions, "hr.manage");
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [newReason, setNewReason] = useState("");
  const [edit, setEdit] = useState<Template | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reasonColumns = useMemo<ViewColumn<Reason>[]>(
    () => [
      { key: "name", label: l("Alasan", "Reason"), value: (r) => r.name },
      {
        key: "active",
        label: l("Status", "Status"),
        type: "enum",
        value: (r) => (r.active ? "1" : "0"),
        optionLabel: (v) => (v === "1" ? l("Aktif", "Active") : l("Nonaktif", "Inactive")),
      },
    ],
    [l],
  );
  const reasonTable = useTableView(reasons, reasonColumns, { storageKey: "refuse-reasons" });
  const load = useCallback(async () => {
    setReasons(await api<Reason[]>("/refuse-reasons"));
    setTemplates(await api<Template[]>("/offer-templates"));
  }, []);
  useEffect(() => {
    load().catch((e) => setError(errorText(e)));
  }, [load]);
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="stack-wide">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <header className="toolbar">
          <h1>{l("Alasan Penolakan Pelamar", "Applicant Refusal Reasons")}</h1>
        </header>
        <TableTools view={reasonTable} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh view={reasonTable} col="name">
                  {l("Alasan", "Reason")}
                </SortTh>
                <SortTh view={reasonTable} col="active">
                  {l("Status", "Status")}
                </SortTh>
                <th />
              </tr>
            </thead>
            <tbody>
              {reasonTable.rows.map((r) => (
                <tr key={r.id} className={r.active ? "" : "muted"}>
                  <td>{r.name}</td>
                  <td>{r.active ? "" : l("nonaktif", "inactive")}</td>
                  <td>
                    {manage && (
                      <>
                        <button
                          type="button"
                          className="link"
                          onClick={() =>
                            run(() =>
                              api(`/refuse-reasons/${r.id}`, {
                                method: "PUT",
                                body: { name: r.name, sequence: r.sequence, active: !r.active },
                              }),
                            )
                          }
                        >
                          {r.active ? l("Nonaktifkan", "Deactivate") : l("Aktifkan", "Activate")}
                        </button>{" "}
                        <button
                          type="button"
                          className="link"
                          onClick={async () =>
                            (await ask(l("Hapus alasan ini?", "Delete this reason?"))) &&
                            run(() => api(`/refuse-reasons/${r.id}`, { method: "DELETE" }))
                          }
                        >
                          {l("Hapus", "Delete")}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {reasonTable.rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    {reasons.length
                      ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                      : l("Belum ada alasan penolakan.", "No refusal reasons yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePager view={reasonTable} />
        {manage && (
          <form
            className="inline-panel"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api("/refuse-reasons", {
                  method: "POST",
                  body: { name: newReason, sequence: (reasons.length + 1) * 10 },
                });
                setNewReason("");
              });
            }}
          >
            <label className="field">
              <span>{l("Alasan baru", "New reason")}</span>
              <input
                required
                maxLength={200}
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
              />
            </label>
            <button className="primary">{l("Tambah", "Add")}</button>
          </form>
        )}
      </section>

      <section className="panel">
        <header className="toolbar">
          <h1>{l("Template Penawaran Kerja", "Job Offer Templates")}</h1>
          {manage && !edit && (
            <button type="button" onClick={() => setEdit({ id: "", name: "", body: "", active: true })}>
              {l("Template baru", "New template")}
            </button>
          )}
        </header>
        <ul className="plain-list">
          {templates.map((t) => (
            <li key={t.id}>
              <strong>{t.name}</strong>{" "}
              {!t.active && <small className="muted">{l("nonaktif", "inactive")}</small>}{" "}
              {manage && (
                <button type="button" className="link" onClick={() => setEdit(t)}>
                  {l("Ubah", "Edit")}
                </button>
              )}
            </li>
          ))}
        </ul>
        {edit && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const body = { name: edit.name, body: edit.body, active: edit.active };
                await api(edit.id ? `/offer-templates/${edit.id}` : "/offer-templates", {
                  method: edit.id ? "PUT" : "POST",
                  body,
                });
                setEdit(null);
              });
            }}
          >
            <label className="field">
              <span>{l("Nama", "Name")}</span>
              <input
                required
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("Isi surat", "Letter body")}</span>
              <textarea
                required
                rows={14}
                className="offer-letter-input"
                value={edit.body}
                onChange={(e) => setEdit({ ...edit, body: e.target.value })}
              />
            </label>
            <p className="muted">
              {l("Placeholder:", "Placeholders:")} {OFFER_PLACEHOLDERS.map((p) => `{${p}}`).join(" ")}
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={edit.active}
                onChange={(e) => setEdit({ ...edit, active: e.target.checked })}
              />
              {l("Aktif", "Active")}
            </label>
            <div className="toolbar">
              <button className="primary">{l("Simpan", "Save")}</button>
              <button type="button" onClick={() => setEdit(null)}>
                {l("Batal", "Cancel")}
              </button>
              {edit.id && (
                <button
                  type="button"
                  className="danger"
                  onClick={async () =>
                    (await ask(l("Hapus template ini?", "Delete this template?"))) &&
                    run(async () => {
                      await api(`/offer-templates/${edit.id}`, { method: "DELETE" });
                      setEdit(null);
                    })
                  }
                >
                  {l("Hapus", "Delete")}
                </button>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
