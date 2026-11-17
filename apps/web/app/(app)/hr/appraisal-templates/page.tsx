"use client";

import { useEffect, useMemo, useState } from "react";
import { errorText } from "../../../../components/hr/hr-panels";
import { RefSelect } from "../../../../components/ref-select";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface Item {
  name: string;
  description: string | null;
  weight: number;
}
interface Template {
  id?: string;
  name: string;
  jobId: string | null;
  jobName?: string | null;
  active: boolean;
  items: Item[];
}

const empty = (): Template => ({
  name: "",
  jobId: null,
  active: true,
  items: [{ name: "", description: null, weight: 100 }],
});

/** Template KPI berbobot per jabatan (tanpa jabatan = template umum). */
export default function AppraisalTemplatesPage() {
  const { l } = useI18n();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [edit, setEdit] = useState<Template | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const columns = useMemo<ViewColumn<Template>[]>(
    () => [
      { key: "name", label: l("Nama", "Name"), value: (t) => t.name },
      {
        key: "job",
        label: l("Jabatan", "Job"),
        type: "enum",
        value: (t) => t.jobName ?? l("(umum)", "(general)"),
      },
      { key: "items", label: l("Indikator", "Indicators"), type: "number", value: (t) => t.items.length },
      {
        key: "active",
        label: l("Aktif", "Active"),
        type: "enum",
        value: (t) => (t.active ? "1" : "0"),
        optionLabel: (v) => (v === "1" ? l("Ya", "Yes") : l("Tidak", "No")),
        hidden: true,
      },
    ],
    [l],
  );
  const table = useTableView(templates, columns, { storageKey: "appraisal-templates" });
  useEffect(() => {
    api<Template[]>("/appraisal-templates").then(setTemplates, (e) => setError(errorText(e)));
  }, [version]);
  const setItem = (i: number, patch: Partial<Item>) =>
    setEdit((t) => (t ? { ...t, items: t.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) } : t));
  const total = edit?.items.reduce((s, x) => s + Number(x.weight || 0), 0) ?? 0;
  const save = async () => {
    if (!edit) return;
    setError(null);
    try {
      const { id, jobName: _jobName, ...body } = edit;
      await api(id ? `/appraisal-templates/${id}` : "/appraisal-templates", {
        method: id ? "PUT" : "POST",
        body: {
          ...body,
          jobId: body.jobId || null,
          items: body.items.map((x) => ({ ...x, weight: Number(x.weight) })),
        },
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
        <h1>{l("Template KPI", "KPI Templates")}</h1>
        {!edit && (
          <button type="button" className="primary" onClick={() => setEdit(empty())}>
            {l("Template baru", "New template")}
          </button>
        )}
      </header>
      <p className="muted">
        {l(
          "Skor akhir = rata-rata tertimbang skor 1–5 per indikator. Tanpa template, dipakai KPI bawaan (target, kualitas, kerja sama, disiplin).",
          "Final score = weighted average of 1–5 scores. Without a template the built-in KPIs are used.",
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
              <span>{l("Jabatan (kosong = umum)", "Job (empty = general)")}</span>
              <RefSelect
                name="jobId"
                resource="job-positions"
                display="name"
                value={edit.jobId ?? ""}
                onChange={(v) => setEdit({ ...edit, jobId: v || null })}
              />
            </label>
          </div>
          <div className="table-scroll">
            <table className="lines">
              <thead>
                <tr>
                  <th>{l("Indikator", "Indicator")}</th>
                  <th>{l("Keterangan", "Description")}</th>
                  <th className="num">{l("Bobot", "Weight")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {edit.items.map((x, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        aria-label={l("Indikator", "Indicator")}
                        value={x.name}
                        onChange={(e) => setItem(i, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={x.description ?? ""}
                        onChange={(e) => setItem(i, { description: e.target.value || null })}
                      />
                    </td>
                    <td>
                      <input
                        className="num"
                        type="number"
                        aria-label={l("Bobot", "Weight")}
                        value={x.weight}
                        onChange={(e) => setItem(i, { weight: Number(e.target.value) })}
                      />
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
                <tr>
                  <td colSpan={2} className="muted">
                    {l("Total bobot", "Total weight")}
                  </td>
                  <td className="num">{total}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="link"
              onClick={() =>
                setEdit({ ...edit, items: [...edit.items, { name: "", description: null, weight: 10 }] })
              }
            >
              + {l("Tambah indikator", "Add indicator")}
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
                  <SortTh view={table} col="job">
                    {l("Jabatan", "Job")}
                  </SortTh>
                  <SortTh view={table} col="items">
                    {l("Indikator", "Indicators")}
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
                    <td>{t.jobName ?? l("(umum)", "(general)")}</td>
                    <td>
                      {t.items.length} {l("indikator", "indicators")}
                    </td>
                  </tr>
                ))}
                {table.rows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">
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
