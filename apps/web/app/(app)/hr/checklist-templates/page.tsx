"use client";

import { useEffect, useMemo, useState } from "react";
import { errorText } from "../../../../components/hr/hr-panels";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface Item {
  name: string;
  responsible: string;
  dueDays: number;
  action: string | null;
}
interface Template {
  id?: string;
  kind: "onboarding" | "offboarding";
  name: string;
  isDefault: boolean;
  active: boolean;
  items: Item[];
}

const emptyTemplate = (): Template => ({
  kind: "onboarding",
  name: "",
  isDefault: true,
  active: true,
  items: [{ name: "", responsible: "hr", dueDays: 0, action: null }],
});

/** Template checklist onboarding/offboarding (tenggat relatif tanggal masuk/keluar). */
export default function ChecklistTemplatesPage() {
  const { l } = useI18n();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [edit, setEdit] = useState<Template | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const columns = useMemo<ViewColumn<Template>[]>(
    () => [
      { key: "name", label: l("Nama", "Name"), value: (t) => t.name },
      {
        key: "kind",
        label: l("Jenis", "Kind"),
        type: "enum",
        value: (t) => t.kind,
        optionLabel: (v) => (v === "onboarding" ? "Onboarding" : "Offboarding"),
      },
      {
        key: "isDefault",
        label: l("Bawaan", "Default"),
        type: "enum",
        value: (t) => (t.isDefault ? "1" : "0"),
        optionLabel: (v) => (v === "1" ? l("Bawaan", "Default") : l("Bukan bawaan", "Not default")),
      },
      { key: "items", label: l("Tugas", "Tasks"), type: "number", value: (t) => t.items.length },
    ],
    [l],
  );
  const table = useTableView(templates, columns, { storageKey: "checklist-templates" });
  useEffect(() => {
    api<Template[]>("/hr-checklist-templates").then(setTemplates, (e) => setError(errorText(e)));
  }, [version]);
  const setItem = (i: number, patch: Partial<Item>) =>
    setEdit((t) => (t ? { ...t, items: t.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) } : t));
  const save = async () => {
    if (!edit) return;
    setError(null);
    try {
      const { id, ...body } = edit;
      await api(id ? `/hr-checklist-templates/${id}` : "/hr-checklist-templates", {
        method: id ? "PUT" : "POST",
        body,
      });
      setEdit(null);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Template Checklist", "Checklist Templates")}</h1>
        {!edit && (
          <button type="button" className="primary" onClick={() => setEdit(emptyTemplate())}>
            {l("Template baru", "New template")}
          </button>
        )}
      </header>
      <p className="muted">
        {l(
          "Tanpa template bawaan, sistem memakai checklist standar (kontrak, akun, orientasi, dokumen, BPJS / serah terima, exit interview, aset, pesangon, nonaktifkan akun).",
          "Without a default template the built-in checklist is used.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {edit ? (
        <div className="stack">
          <div className="inline-panel">
            <label className="field">
              <span>{l("Nama", "Name")}</span>
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </label>
            <label className="field">
              <span>{l("Jenis", "Kind")}</span>
              <select
                value={edit.kind}
                onChange={(e) => setEdit({ ...edit, kind: e.target.value as Template["kind"] })}
              >
                <option value="onboarding">Onboarding</option>
                <option value="offboarding">Offboarding</option>
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={edit.isDefault}
                onChange={(e) => setEdit({ ...edit, isDefault: e.target.checked })}
              />
              {l("Template bawaan (otomatis)", "Default (automatic)")}
            </label>
          </div>
          <div className="table-scroll">
            <table className="lines">
              <thead>
                <tr>
                  <th>{l("Tugas", "Task")}</th>
                  <th>{l("Penanggung jawab", "Owner")}</th>
                  <th className="num">{l("Tenggat (hari)", "Due (days)")}</th>
                  <th>{l("Aksi", "Action")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {edit.items.map((x, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        aria-label={l("Tugas", "Task")}
                        value={x.name}
                        onChange={(e) => setItem(i, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        value={x.responsible}
                        onChange={(e) => setItem(i, { responsible: e.target.value })}
                      >
                        <option value="hr">HR</option>
                        <option value="manager">{l("Atasan", "Manager")}</option>
                        <option value="employee">{l("Karyawan", "Employee")}</option>
                        <option value="it">IT</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className="num"
                        type="number"
                        value={x.dueDays}
                        onChange={(e) => setItem(i, { dueDays: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <select
                        value={x.action ?? ""}
                        onChange={(e) => setItem(i, { action: e.target.value || null })}
                      >
                        <option value="">—</option>
                        <option value="severance">{l("Hitung pesangon", "Severance")}</option>
                        <option value="deactivate_user">{l("Nonaktifkan akun", "Deactivate login")}</option>
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label="Hapus baris / Remove"
                        className="link"
                        onClick={() => setEdit({ ...edit, items: edit.items.filter((_, j) => j !== i) })}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="link"
              onClick={() =>
                setEdit({
                  ...edit,
                  items: [...edit.items, { name: "", responsible: "hr", dueDays: 0, action: null }],
                })
              }
            >
              + {l("Tambah tugas", "Add task")}
            </button>
            <button type="button" className="primary" onClick={save}>
              {l("Simpan", "Save")}
            </button>
            <button type="button" className="link" onClick={() => setEdit(null)}>
              {l("Batal", "Cancel")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <TableTools view={table} />
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortTh view={table} col="name">
                    {l("Nama", "Name")}
                  </SortTh>
                  <SortTh view={table} col="kind">
                    {l("Jenis", "Kind")}
                  </SortTh>
                  <SortTh view={table} col="isDefault">
                    {l("Bawaan", "Default")}
                  </SortTh>
                  <SortTh view={table} col="items">
                    {l("Tugas", "Tasks")}
                  </SortTh>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <button type="button" className="link" onClick={() => setEdit(t)}>
                        {t.name}
                      </button>
                    </td>
                    <td>{t.kind === "onboarding" ? "Onboarding" : "Offboarding"}</td>
                    <td>{t.isDefault ? l("bawaan", "default") : ""}</td>
                    <td>
                      {t.items.length} {l("tugas", "tasks")}
                    </td>
                  </tr>
                ))}
                {table.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      {templates.length
                        ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                        : l("Belum ada template.", "No templates yet.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <TablePager view={table} />
        </>
      )}
    </div>
  );
}
