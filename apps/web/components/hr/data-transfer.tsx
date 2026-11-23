"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { download } from "../accounting/download";
import { ExportDialog, type ExportColumn, type ExportFilter } from "../export-dialog";

interface DatasetInfo {
  key: string;
  label: string;
  description: string;
  app: "hr" | "payroll";
  canImport: boolean;
  canShare: boolean;
  needsRun: boolean;
  filters: ExportFilter[];
}

interface Result {
  dryRun: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; column: string; message: string }[];
}

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const today = () => new Date().toISOString().slice(0, 10);

/** Satu dataset: template, ekspor (pilih kolom), impor dengan pratinjau. */
function DatasetCard({ d, runId }: { d: DatasetInfo; runId: string }) {
  const { l } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [columns, setColumns] = useState<ExportColumn[]>([]);
  const [file, setFile] = useState<{ name: string; body: Record<string, string> } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [saved, setSaved] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = d.needsRun && !runId;
  const run = runId ? `runId=${runId}` : "";

  const openExport = async () => {
    setError(null);
    try {
      setColumns(await api<ExportColumn[]>(`/data-transfer/${d.key}/columns${run ? `?${run}` : ""}`));
      setExporting(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const send = async (body: Record<string, string>, dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<Result>(`/data-transfer/${d.key}/import`, {
        method: "POST",
        body: { ...body, dryRun, ...(runId ? { runId } : {}) },
      });
      if (dryRun) setResult(r);
      else {
        setSaved(r);
        setResult(null);
        setFile(null);
      }
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.body.errors))
        setResult({
          dryRun: false,
          created: 0,
          updated: 0,
          skipped: 0,
          errors: (e.body.errors as { row: number; path: string; message: string }[]).map((x) => ({
            row: x.row,
            column: x.path,
            message: x.message,
          })),
        });
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setSaved(null);
    setResult(null);
    const body: Record<string, string> = /\.xlsx$/i.test(f.name)
      ? { xlsx: await toBase64(f) }
      : { csv: await f.text() };
    setFile({ name: f.name, body });
    await send(body, true);
  };

  return (
    <section className="panel data-card">
      <h2>{d.label}</h2>
      <p className="muted">{d.description}</p>
      <div className="form-actions">
        {d.canImport && (
          <>
            <button
              type="button"
              disabled={blocked}
              onClick={() =>
                download(
                  `/data-transfer/${d.key}/template${run ? `?${run}` : ""}`,
                  `template-${d.key}.xlsx`,
                ).catch((e: Error) => setError(e.message))
              }
            >
              {l("Template Excel", "Excel template")}
            </button>
            <button
              type="button"
              disabled={blocked}
              onClick={() =>
                download(
                  `/data-transfer/${d.key}/template?format=csv${run ? `&${run}` : ""}`,
                  `template-${d.key}.csv`,
                ).catch((e: Error) => setError(e.message))
              }
            >
              {l("Template CSV", "CSV template")}
            </button>
          </>
        )}
        <button type="button" disabled={blocked} onClick={openExport}>
          {l("Ekspor…", "Export…")}
        </button>
        {d.canImport && (
          <>
            <button
              type="button"
              className="primary"
              disabled={blocked || busy}
              onClick={() => input.current?.click()}
            >
              {l("Impor…", "Import…")}
            </button>
            <input
              ref={input}
              type="file"
              hidden
              aria-label={l(`Impor ${d.label}`, `Import ${d.label}`)}
              accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                void pick(f);
              }}
            />
          </>
        )}
      </div>
      {blocked && (
        <small className="muted">
          {l("Pilih periode payroll terlebih dahulu.", "Choose a payroll period first.")}
        </small>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="notice">
          {l("Impor selesai", "Import finished")}: {saved.created} {l("dibuat", "created")}, {saved.updated}{" "}
          {l("diperbarui", "updated")}, {saved.skipped} {l("dilewati", "skipped")}.
        </p>
      )}
      {result && file && (
        <div className="import-preview">
          <strong>
            {l("Pratinjau", "Preview")} — {file.name}
          </strong>
          {result.errors.length === 0 ? (
            <>
              <p>
                {result.created} {l("akan dibuat", "to create")}, {result.updated}{" "}
                {l("akan diperbarui", "to update")}, {result.skipped}{" "}
                {l("dilewati (sudah ada)", "skipped (already exist)")}.
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => send(file.body, false)}
                >
                  {busy ? l("Menyimpan…", "Saving…") : l("Simpan impor", "Save import")}
                </button>
                <button type="button" className="link" onClick={() => setFile(null)}>
                  {l("Batal", "Cancel")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="error" role="alert">
                {l(
                  `${result.errors.length} kesalahan — perbaiki berkas lalu impor ulang (tidak ada data yang disimpan).`,
                  `${result.errors.length} errors — fix the file and import again (nothing was saved).`,
                )}
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="num">{l("Baris", "Row")}</th>
                      <th>{l("Kolom", "Column")}</th>
                      <th>{l("Pesan", "Message")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.slice(0, 100).map((x, i) => (
                      <tr key={i}>
                        <td className="num">{x.row || "—"}</td>
                        <td>{x.column || "—"}</td>
                        <td>{x.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
      {exporting && (
        <ExportDialog
          open
          onClose={() => setExporting(false)}
          title={`${l("Ekspor", "Export")} ${d.label}`}
          columns={columns}
          filters={d.filters}
          storageKey={`erp.export.${d.key}`}
          presetsPath={`/data-transfer/${d.key}/presets`}
          canShare={d.canShare}
          onExport={async ({ columns: cols, filters, format }) => {
            const params = new URLSearchParams({ ...filters, columns: cols.join(","), format });
            if (runId) params.set("runId", runId);
            await download(`/data-transfer/${d.key}/export?${params}`, `${d.key}-${today()}.${format}`);
          }}
        />
      )}
    </section>
  );
}

/** Halaman Impor & Ekspor untuk app SDM atau Payroll. */
export function DataTransferPanel({
  app,
  initialRunId = "",
}: {
  app: "hr" | "payroll";
  initialRunId?: string;
}) {
  const { l } = useI18n();
  const [datasets, setDatasets] = useState<DatasetInfo[] | null>(null);
  const [runs, setRuns] = useState<{ id: string; name: string; state: string }[]>([]);
  const [runId, setRunId] = useState(initialRunId);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<DatasetInfo[]>("/data-transfer").then(
      (all) => setDatasets(all.filter((d) => d.app === app)),
      (e: Error) => setError(e.message),
    );
    if (app === "payroll")
      api<{ id: string; name: string; state: string }[]>("/payroll-runs").then(
        (r) => {
          setRuns(r);
          setRunId((current) => current || r[0]?.id || "");
        },
        () => setRuns([]),
      );
  }, [app]);
  // Dibuka dari daftar (mis. Jatah Cuti › Impor & ekspor): gulir & sorot dataset yang dituju.
  useEffect(() => {
    if (!datasets || !window.location.hash) return;
    const el = document.getElementById(window.location.hash.slice(1));
    el?.scrollIntoView({ block: "start" });
    el?.classList.add("data-anchor-target");
  }, [datasets]);
  const STATE: Record<string, string> = {
    draft: l("draft", "draft"),
    done: l("diposting", "posted"),
    paid: l("dibayar", "paid"),
    cancel: l("batal", "cancelled"),
  };
  return (
    <div className="stack-wide">
      <section className="panel">
        <header className="toolbar">
          <h1>{l("Impor & Ekspor Data", "Data Import & Export")}</h1>
        </header>
        <p className="muted">
          {l(
            "Unduh template, isi di Excel, lalu impor: semua baris diperiksa dulu (pratinjau) dan baru disimpan setelah Anda konfirmasi. Saat mengekspor, pilih kolom & urutannya; simpan sebagai profil agar bisa dipakai lagi.",
            "Download a template, fill it in Excel, then import: every row is checked first (preview) and saved only after you confirm. When exporting, choose the columns and their order; save them as a profile to reuse.",
          )}
        </p>
        {app === "payroll" && (
          <label className="field" style={{ maxWidth: 360 }}>
            <span>{l("Periode payroll", "Payroll period")}</span>
            <select value={runId} onChange={(e) => setRunId(e.target.value)}>
              {runs.length === 0 && <option value="">{l("Belum ada periode", "No periods yet")}</option>}
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({STATE[r.state] ?? r.state})
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      {datasets === null ? (
        <p className="muted">{l("Memuat…", "Loading…")}</p>
      ) : datasets.length === 0 ? (
        <p className="muted">{l("Tidak ada data yang bisa diakses.", "No data you can access.")}</p>
      ) : (
        <div className="data-grid">
          {datasets.map((d) => (
            <div key={d.key} id={`ds-${d.key}`} className="data-anchor">
              <DatasetCard d={d} runId={runId} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
