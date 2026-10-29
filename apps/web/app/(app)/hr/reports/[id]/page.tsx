"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  REPORT_AGGREGATE_LABEL,
  REPORT_AGGREGATES,
  REPORT_FREQUENCY_LABEL,
  REPORT_OPERATOR_LABEL,
  REPORT_OPERATORS,
  type ReportAggregate,
  type ReportFrequency,
  type ReportOperator,
} from "@erp/shared";
import { RefSelect } from "../../../../../components/ref-select";
import { ReportChart } from "../../../../../components/reports/report-chart";
import { api, ApiError } from "../../../../../lib/api";
import { download } from "../../../../../lib/download";
import { useI18n } from "../../../../../lib/i18n";

interface DatasetInfo {
  key: string;
  label: string;
  description: string;
  app: string;
  needsRun: boolean;
  filters: {
    key: string;
    label: string;
    type: "date" | "select" | "ref";
    options?: [string, string][];
    resource?: string;
  }[];
  columns: { key: string; header: string; group: string; numeric: boolean }[];
}
interface Config {
  columns: string[];
  filters: Record<string, string>;
  conditions: { column: string; op: ReportOperator; value: string }[];
  groupBy: string[];
  aggregates: { column: string; fn: ReportAggregate }[];
  sort: { column: string; dir: "asc" | "desc" } | null;
  limit: number | null;
  chart: { type: "bar" | "line" | "pie"; x: string; y: string } | null;
}
interface Result {
  columns: { key: string; header: string; numeric?: boolean }[];
  rows: Record<string, unknown>[];
  total: number;
  totals: Record<string, number>;
}
interface Schedule {
  id: string;
  frequency: ReportFrequency;
  hour: number;
  weekday: number | null;
  monthday: number | null;
  format: "xlsx" | "csv" | "pdf";
  recipients: string[];
  active: boolean;
  lastSentAt: string | null;
  nextRunAt: string | null;
}
interface Delivery {
  id: string;
  period: string;
  sentAt: string;
  status: "sent" | "failed";
  rows: number | null;
  error: string | null;
  manual: boolean;
}

const EMPTY: Config = {
  columns: [],
  filters: {},
  conditions: [],
  groupBy: [],
  aggregates: [],
  sort: null,
  limit: null,
  chart: null,
};
const WEEKDAYS: [string, string][] = [
  ["Senin", "Monday"],
  ["Selasa", "Tuesday"],
  ["Rabu", "Wednesday"],
  ["Kamis", "Thursday"],
  ["Jumat", "Friday"],
  ["Sabtu", "Saturday"],
  ["Minggu", "Sunday"],
];

/** Editor laporan kustom: data → kolom/kelompok → syarat → urutan → grafik → pratinjau → simpan, ekspor, jadwal. */
export default function ReportEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const { l, locale } = useI18n();
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [runs, setRuns] = useState<{ id: string; name: string; state: string }[]>([]);
  const [meta, setMeta] = useState({ name: "", description: "", dataset: "", visibility: "private" });
  const [config, setConfig] = useState<Config>(EMPTY);
  const [mode, setMode] = useState<"detail" | "summary">("detail");
  const [mine, setMine] = useState(true);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(isNew);

  useEffect(() => {
    api<DatasetInfo[]>("/reports/datasets")
      .then((d) => {
        setDatasets(d);
        if (isNew && d[0]) setMeta((m) => ({ ...m, dataset: m.dataset || d[0]!.key }));
      })
      .catch((e: Error) => setError(e.message));
  }, [isNew]);
  const loadReport = useCallback(() => {
    if (isNew) return;
    api<{
      name: string;
      description: string | null;
      dataset: string;
      visibility: string;
      config: Partial<Config>;
      mine: boolean;
      schedules: Schedule[];
    }>(`/saved-reports/${id}`)
      .then((r) => {
        setMeta({
          name: r.name,
          description: r.description ?? "",
          dataset: r.dataset,
          visibility: r.visibility,
        });
        const c = { ...EMPTY, ...r.config };
        setConfig(c);
        setMode(c.groupBy.length || c.aggregates.length ? "summary" : "detail");
        setMine(r.mine);
        setSchedules(r.schedules);
        setLoaded(true);
      })
      .catch((e: Error) => setError(e.message));
  }, [id, isNew]);
  useEffect(loadReport, [loadReport]);

  const ds = datasets.find((d) => d.key === meta.dataset);
  useEffect(() => {
    if (ds?.needsRun && !runs.length)
      api<{ id: string; name: string; state: string }[]>("/payroll-runs")
        .then((r) => setRuns(r.filter((x) => x.state === "done" || x.state === "paid")))
        .catch(() => setRuns([]));
  }, [ds?.needsRun, runs.length]);

  const payload = (): Config => {
    const c = { ...config };
    if (mode === "detail") {
      c.groupBy = [];
      c.aggregates = [];
    } else c.columns = [];
    if (ds?.needsRun && !c.filters.runId) c.filters = { ...c.filters, runId: "latest" };
    return c;
  };
  const preview = useCallback(async () => {
    if (!meta.dataset) return;
    setError(null);
    try {
      setResult(
        await api<Result>("/saved-reports/preview", {
          method: "POST",
          body: { dataset: meta.dataset, config: payload() },
        }),
      );
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [meta.dataset, config, mode, ds]);
  // Pratinjau otomatis setelah konfigurasi berhenti berubah sejenak.
  useEffect(() => {
    if (!loaded || !meta.dataset || !ds) return;
    const t = setTimeout(() => void preview(), 400);
    return () => clearTimeout(t);
  }, [loaded, meta.dataset, ds, preview]);

  const save = async () => {
    setError(null);
    setNotice(null);
    const body = {
      name: meta.name,
      description: meta.description || null,
      dataset: meta.dataset,
      visibility: meta.visibility,
      config: payload(),
    };
    try {
      if (isNew) {
        const created = await api<{ id: string }>("/saved-reports", { method: "POST", body });
        router.replace(`/hr/reports/${created.id}`);
      } else {
        await api(`/saved-reports/${id}`, { method: "PATCH", body });
        setNotice(l("Laporan tersimpan.", "Report saved."));
      }
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : String(e));
    }
  };
  const remove = async () => {
    if (!confirm(l("Hapus laporan ini beserta jadwalnya?", "Delete this report and its schedules?"))) return;
    try {
      await api(`/saved-reports/${id}`, { method: "DELETE" });
      router.push("/hr/reports");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const set = <K extends keyof Config>(k: K, v: Config[K]) => setConfig((c) => ({ ...c, [k]: v }));
  const columns = ds?.columns ?? [];
  const numeric = columns.filter((c) => c.numeric);
  const groups = [...new Set(columns.map((c) => c.group))];
  const resultColumns = result?.columns ?? [];
  const fmt = (v: unknown, isNum?: boolean) =>
    isNum && v !== "" && v !== null && v !== undefined && !Number.isNaN(Number(v))
      ? Number(v).toLocaleString(locale === "id" ? "id-ID" : "en", { maximumFractionDigits: 2 })
      : String(v ?? "");
  const readOnly = !isNew && !mine;

  return (
    <>
      <header className="toolbar">
        <nav className="breadcrumb">
          <Link href="/hr/reports">{l("Pembuat Laporan", "Report Builder")}</Link>
          <span>/</span>
          <h1>{isNew ? l("Laporan baru", "New report") : meta.name}</h1>
        </nav>
        {!readOnly && (
          <button type="button" className="primary" onClick={save} disabled={!meta.name || !meta.dataset}>
            {l("Simpan", "Save")}
          </button>
        )}
        {!isNew &&
          (["xlsx", "csv", "pdf"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() =>
                download(`/saved-reports/${id}/export?format=${f}`, undefined, `laporan.${f}`).catch(
                  (e: Error) => setError(e.message),
                )
              }
            >
              {f.toUpperCase()}
            </button>
          ))}
        {!isNew && mine && (
          <button type="button" className="danger" onClick={remove}>
            {l("Hapus", "Delete")}
          </button>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <section className="panel stack proj-panel report-editor">
        <fieldset
          disabled={readOnly}
          className="stack"
          style={{ alignSelf: "stretch", border: 0, padding: 0, margin: 0 }}
        >
          <div className="row-fields">
            <label className="field">
              <span>{l("Nama laporan", "Report name")}</span>
              <input value={meta.name} onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))} />
            </label>
            <label className="field">
              <span>{l("Data", "Data")}</span>
              <select
                value={meta.dataset}
                onChange={(e) => {
                  setMeta((m) => ({ ...m, dataset: e.target.value }));
                  setConfig(EMPTY);
                }}
              >
                {datasets.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Dibagikan", "Sharing")}</span>
              <select
                value={meta.visibility}
                onChange={(e) => setMeta((m) => ({ ...m, visibility: e.target.value }))}
              >
                <option value="private">{l("Pribadi", "Private")}</option>
                <option value="shared">
                  {l("Semua yang berhak melihat data ini", "Everyone allowed to see this data")}
                </option>
              </select>
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>{l("Keterangan", "Description")}</span>
              <input
                value={meta.description}
                onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))}
              />
            </label>
          </div>
          {ds && <p className="muted">{ds.description}</p>}

          {ds && (ds.filters.length > 0 || ds.needsRun) && (
            <div className="row-fields">
              {ds.needsRun && (
                <label className="field">
                  <span>{l("Periode payroll", "Payroll period")}</span>
                  <select
                    value={config.filters.runId ?? "latest"}
                    onChange={(e) => set("filters", { ...config.filters, runId: e.target.value })}
                  >
                    <option value="latest">
                      {l("Terakhir diposting (otomatis)", "Latest posted (automatic)")}
                    </option>
                    {runs.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {ds.filters.map((f) => (
                <label key={f.key} className="field">
                  <span>{f.label}</span>
                  {f.type === "date" ? (
                    <input
                      type="date"
                      value={config.filters[f.key] ?? ""}
                      onChange={(e) => set("filters", { ...config.filters, [f.key]: e.target.value })}
                    />
                  ) : f.type === "ref" ? (
                    <RefSelect
                      name={f.key}
                      resource={f.resource!}
                      display="name"
                      value={config.filters[f.key] ?? ""}
                      onChange={(v) => set("filters", { ...config.filters, [f.key]: v })}
                    />
                  ) : (
                    <select
                      value={config.filters[f.key] ?? ""}
                      onChange={(e) => set("filters", { ...config.filters, [f.key]: e.target.value })}
                    >
                      <option value="">—</option>
                      {f.options?.map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              ))}
            </div>
          )}

          <nav className="tabs" role="tablist">
            {(
              [
                ["detail", l("Rincian (pilih kolom)", "Detail (choose columns)")],
                ["summary", l("Ringkasan (kelompok & total)", "Summary (group & totals)")],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={mode === k}
                className={mode === k ? "active" : ""}
                onClick={() => setMode(k)}
              >
                {label}
              </button>
            ))}
          </nav>

          {mode === "detail" ? (
            <div className="column-picker">
              {groups.map((g) => (
                <div key={g}>
                  <strong className="muted">{g}</strong>
                  {columns
                    .filter((c) => c.group === g)
                    .map((c) => (
                      <label key={c.key} className="check">
                        <input
                          type="checkbox"
                          checked={config.columns.includes(c.key)}
                          onChange={(e) =>
                            set(
                              "columns",
                              e.target.checked
                                ? [...config.columns, c.key]
                                : config.columns.filter((k) => k !== c.key),
                            )
                          }
                        />
                        {c.header}
                      </label>
                    ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="stack" style={{ alignSelf: "stretch" }}>
              <div className="row-fields">
                {[0, 1, 2].map((i) => (
                  <label key={i} className="field">
                    <span>
                      {l("Kelompokkan menurut", "Group by")} {i + 1}
                    </span>
                    <select
                      value={config.groupBy[i] ?? ""}
                      onChange={(e) => {
                        const next = [...config.groupBy];
                        next[i] = e.target.value;
                        set("groupBy", next.filter(Boolean).slice(0, 3));
                      }}
                    >
                      <option value="">—</option>
                      {columns
                        .filter((c) => !c.numeric)
                        .map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.header}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
              </div>
              {config.aggregates.map((a, i) => (
                <div key={i} className="row-fields">
                  <label className="field">
                    <span>{l("Hitung", "Measure")}</span>
                    <select
                      value={a.fn}
                      onChange={(e) =>
                        set(
                          "aggregates",
                          config.aggregates.map((x, j) =>
                            j === i
                              ? {
                                  fn: e.target.value as ReportAggregate,
                                  column:
                                    e.target.value === "count"
                                      ? "*"
                                      : x.column === "*"
                                        ? (numeric[0]?.key ?? "*")
                                        : x.column,
                                }
                              : x,
                          ),
                        )
                      }
                    >
                      {REPORT_AGGREGATES.map((f) => (
                        <option key={f} value={f}>
                          {l(...REPORT_AGGREGATE_LABEL[f])}
                        </option>
                      ))}
                    </select>
                  </label>
                  {a.fn !== "count" && (
                    <label className="field">
                      <span>{l("Kolom angka", "Numeric column")}</span>
                      <select
                        value={a.column}
                        onChange={(e) =>
                          set(
                            "aggregates",
                            config.aggregates.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)),
                          )
                        }
                      >
                        {numeric.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.header}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button
                    type="button"
                    className="link danger"
                    onClick={() =>
                      set(
                        "aggregates",
                        config.aggregates.filter((_, j) => j !== i),
                      )
                    }
                  >
                    {l("Hapus", "Remove")}
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="link"
                onClick={() => set("aggregates", [...config.aggregates, { fn: "count", column: "*" }])}
              >
                + {l("Tambah perhitungan", "Add measure")}
              </button>
            </div>
          )}

          <h3>{l("Syarat", "Conditions")}</h3>
          {config.conditions.map((c, i) => (
            <div key={i} className="row-fields">
              <select
                aria-label={l("Kolom", "Column")}
                value={c.column}
                onChange={(e) =>
                  set(
                    "conditions",
                    config.conditions.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)),
                  )
                }
              >
                {columns.map((col) => (
                  <option key={col.key} value={col.key}>
                    {col.header}
                  </option>
                ))}
              </select>
              <select
                aria-label={l("Operator", "Operator")}
                value={c.op}
                onChange={(e) =>
                  set(
                    "conditions",
                    config.conditions.map((x, j) =>
                      j === i ? { ...x, op: e.target.value as ReportOperator } : x,
                    ),
                  )
                }
              >
                {REPORT_OPERATORS.map((op) => (
                  <option key={op} value={op}>
                    {l(...REPORT_OPERATOR_LABEL[op])}
                  </option>
                ))}
              </select>
              {c.op !== "empty" && c.op !== "notEmpty" && (
                <input
                  aria-label={l("Nilai", "Value")}
                  value={c.value}
                  onChange={(e) =>
                    set(
                      "conditions",
                      config.conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                    )
                  }
                />
              )}
              <button
                type="button"
                className="link danger"
                onClick={() =>
                  set(
                    "conditions",
                    config.conditions.filter((_, j) => j !== i),
                  )
                }
              >
                {l("Hapus", "Remove")}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="link"
            disabled={!columns.length}
            onClick={() =>
              set("conditions", [...config.conditions, { column: columns[0]!.key, op: "eq", value: "" }])
            }
          >
            + {l("Tambah syarat", "Add condition")}
          </button>

          <div className="row-fields">
            <label className="field">
              <span>{l("Urutkan", "Sort by")}</span>
              <select
                value={config.sort?.column ?? ""}
                onChange={(e) =>
                  set(
                    "sort",
                    e.target.value ? { column: e.target.value, dir: config.sort?.dir ?? "asc" } : null,
                  )
                }
              >
                <option value="">—</option>
                {resultColumns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.header}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Arah", "Direction")}</span>
              <select
                value={config.sort?.dir ?? "asc"}
                disabled={!config.sort}
                onChange={(e) =>
                  config.sort && set("sort", { ...config.sort, dir: e.target.value as "asc" | "desc" })
                }
              >
                <option value="asc">{l("Naik (A→Z, kecil→besar)", "Ascending")}</option>
                <option value="desc">{l("Turun (Z→A, besar→kecil)", "Descending")}</option>
              </select>
            </label>
            <label className="field">
              <span>{l("Batas baris", "Row limit")}</span>
              <input
                className="num"
                inputMode="numeric"
                value={config.limit ?? ""}
                onChange={(e) =>
                  set("limit", e.target.value ? Math.max(1, Number(e.target.value) || 1) : null)
                }
              />
            </label>
            <label className="field">
              <span>{l("Grafik", "Chart")}</span>
              <select
                value={config.chart?.type ?? ""}
                onChange={(e) => {
                  const type = e.target.value as "bar" | "line" | "pie" | "";
                  const x = resultColumns.find((c) => !c.numeric)?.key ?? "";
                  const y = resultColumns.find((c) => c.numeric)?.key ?? "";
                  set("chart", type ? { type, x: config.chart?.x ?? x, y: config.chart?.y ?? y } : null);
                }}
              >
                <option value="">{l("Tanpa grafik", "No chart")}</option>
                <option value="bar">{l("Batang", "Bar")}</option>
                <option value="line">{l("Garis (tren)", "Line (trend)")}</option>
                <option value="pie">{l("Donat (komposisi)", "Donut (composition)")}</option>
              </select>
            </label>
            {config.chart && (
              <>
                <label className="field">
                  <span>{l("Label (sumbu X)", "Labels (X axis)")}</span>
                  <select
                    value={config.chart.x}
                    onChange={(e) => set("chart", { ...config.chart!, x: e.target.value })}
                  >
                    {resultColumns.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.header}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{l("Nilai (sumbu Y)", "Values (Y axis)")}</span>
                  <select
                    value={config.chart.y}
                    onChange={(e) => set("chart", { ...config.chart!, y: e.target.value })}
                  >
                    {resultColumns
                      .filter((c) => c.numeric)
                      .map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.header}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
          </div>
        </fieldset>
      </section>

      {result && (
        <section className="panel stack proj-panel">
          <h2>
            {l("Pratinjau", "Preview")}{" "}
            <small className="muted">
              ({result.total} {l("baris", "rows")}
              {result.rows.length < result.total && `, ${l("tampil", "showing")} ${result.rows.length}`})
            </small>
          </h2>
          {config.chart && result.columns.some((c) => c.key === config.chart!.y) && (
            <ReportChart
              type={config.chart.type}
              rows={result.rows.slice(0, 60)}
              x={config.chart.x}
              y={config.chart.y}
              yLabel={result.columns.find((c) => c.key === config.chart!.y)?.header ?? ""}
              locale={locale}
              empty={l("Tidak ada data untuk grafik.", "No data to chart.")}
              other={l("Lainnya", "Other")}
            />
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {result.columns.map((c) => (
                    <th key={c.key} className={c.numeric ? "num" : ""}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i}>
                    {result.columns.map((c) => (
                      <td key={c.key} className={c.numeric ? "num" : ""}>
                        {fmt(r[c.key], c.numeric)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {Object.keys(result.totals).length > 0 && (
                <tfoot>
                  <tr>
                    {result.columns.map((c, i) => (
                      <th key={c.key} className={c.numeric ? "num" : ""}>
                        {c.key in result.totals ? fmt(result.totals[c.key], true) : i === 0 ? "Total" : ""}
                      </th>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      )}

      {!isNew && mine && <Schedules reportId={id} schedules={schedules} onChange={loadReport} />}
    </>
  );
}

/** Jadwal kirim email laporan + riwayat pengiriman. */
function Schedules({
  reportId,
  schedules,
  onChange,
}: {
  reportId: string;
  schedules: Schedule[];
  onChange: () => void;
}) {
  const { l } = useI18n();
  const [form, setForm] = useState({
    frequency: "weekly" as ReportFrequency,
    hour: 7,
    weekday: 1,
    monthday: 1,
    format: "xlsx",
    recipients: "",
  });
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<{ id: string; rows: Delivery[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const call = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : String(e));
    }
  };
  const describe = (s: Schedule) =>
    `${l(...REPORT_FREQUENCY_LABEL[s.frequency])}${
      s.frequency === "weekly"
        ? ` · ${l(...WEEKDAYS[(s.weekday ?? 1) - 1]!)}`
        : s.frequency === "monthly"
          ? ` · ${l("tgl", "day")} ${s.monthday}`
          : ""
    } · ${String(s.hour).padStart(2, "0")}:00 · ${s.format.toUpperCase()}`;
  const when = (v: string | null) =>
    v ? new Date(v).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—";

  return (
    <section className="panel stack proj-panel">
      <header className="toolbar">
        <h2>{l("Jadwal kirim email", "Email schedule")}</h2>
        {!open && (
          <button type="button" onClick={() => setOpen(true)}>
            {l("Tambah jadwal", "Add schedule")}
          </button>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {open && (
        <div className="inline-panel">
          <label className="field">
            <span>{l("Frekuensi", "Frequency")}</span>
            <select
              value={form.frequency}
              onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as ReportFrequency }))}
            >
              {(["daily", "weekly", "monthly"] as const).map((f) => (
                <option key={f} value={f}>
                  {l(...REPORT_FREQUENCY_LABEL[f])}
                </option>
              ))}
            </select>
          </label>
          {form.frequency === "weekly" && (
            <label className="field">
              <span>{l("Hari", "Day")}</span>
              <select
                value={form.weekday}
                onChange={(e) => setForm((f) => ({ ...f, weekday: Number(e.target.value) }))}
              >
                {WEEKDAYS.map((w, i) => (
                  <option key={i} value={i + 1}>
                    {l(...w)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {form.frequency === "monthly" && (
            <label className="field">
              <span>{l("Tanggal", "Day of month")}</span>
              <select
                value={form.monthday}
                onChange={(e) => setForm((f) => ({ ...f, monthday: Number(e.target.value) }))}
              >
                {Array.from({ length: 28 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>{l("Jam", "Hour")}</span>
            <select
              value={form.hour}
              onChange={(e) => setForm((f) => ({ ...f, hour: Number(e.target.value) }))}
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {String(i).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Format</span>
            <select value={form.format} onChange={(e) => setForm((f) => ({ ...f, format: e.target.value }))}>
              <option value="xlsx">Excel</option>
              <option value="csv">CSV</option>
              <option value="pdf">PDF</option>
            </select>
          </label>
          <label className="field wide">
            <span>{l("Penerima (pisahkan dengan koma)", "Recipients (comma-separated)")}</span>
            <input
              value={form.recipients}
              onChange={(e) => setForm((f) => ({ ...f, recipients: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="primary"
            onClick={() =>
              call(async () => {
                await api(`/saved-reports/${reportId}/schedules`, {
                  method: "POST",
                  body: {
                    ...form,
                    recipients: form.recipients
                      .split(/[,;\s]+/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                });
                setOpen(false);
              })
            }
          >
            {l("Simpan jadwal", "Save schedule")}
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            {l("Batal", "Cancel")}
          </button>
        </div>
      )}
      {schedules.length === 0 ? (
        <p className="muted">{l("Belum ada jadwal.", "No schedules yet.")}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Jadwal", "Schedule")}</th>
                <th>{l("Penerima", "Recipients")}</th>
                <th>{l("Terakhir kirim", "Last sent")}</th>
                <th>{l("Berikutnya", "Next")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} className={s.active ? "" : "muted"}>
                  <td>{describe(s)}</td>
                  <td>{s.recipients.join(", ")}</td>
                  <td>{when(s.lastSentAt)}</td>
                  <td>{s.active ? when(s.nextRunAt) : l("nonaktif", "inactive")}</td>
                  <td className="nowrap">
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        call(() => api(`/report-schedules/${s.id}/send-now`, { method: "POST" }))
                      }
                    >
                      {l("Kirim sekarang", "Send now")}
                    </button>
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        log?.id === s.id
                          ? setLog(null)
                          : api<Delivery[]>(`/report-schedules/${s.id}/deliveries`)
                              .then((rows) => setLog({ id: s.id, rows }))
                              .catch((e: Error) => setError(e.message))
                      }
                    >
                      {l("Riwayat", "History")}
                    </button>
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        call(() =>
                          api(`/report-schedules/${s.id}`, { method: "PATCH", body: { active: !s.active } }),
                        )
                      }
                    >
                      {s.active ? l("Nonaktifkan", "Pause") : l("Aktifkan", "Resume")}
                    </button>
                    <button
                      type="button"
                      className="link danger"
                      onClick={() =>
                        confirm(l("Hapus jadwal ini?", "Delete this schedule?")) &&
                        call(() => api(`/report-schedules/${s.id}`, { method: "DELETE" }))
                      }
                    >
                      {l("Hapus", "Delete")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {log && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Waktu", "Time")}</th>
                <th>{l("Periode", "Period")}</th>
                <th>Status</th>
                <th className="num">{l("Baris", "Rows")}</th>
              </tr>
            </thead>
            <tbody>
              {log.rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    {l("Belum pernah dikirim.", "Not sent yet.")}
                  </td>
                </tr>
              ) : (
                log.rows.map((d) => (
                  <tr key={d.id}>
                    <td>{when(d.sentAt)}</td>
                    <td>{d.manual ? l("manual", "manual") : d.period}</td>
                    <td>
                      <span className={`pill ${d.status === "sent" ? "ok" : "bad"}`}>
                        {d.status === "sent" ? l("Terkirim", "Sent") : l("Gagal", "Failed")}
                      </span>
                      {d.error && <small className="muted"> · {d.error}</small>}
                    </td>
                    <td className="num">{d.rows ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
