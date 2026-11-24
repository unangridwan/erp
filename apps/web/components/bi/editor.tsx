"use client";

import {
  biMeasureSchema,
  BI_AGGREGATE_LABEL,
  FORMULA_FUNCTIONS,
  formulaRefs,
  parseFormula,
  BI_FILTER_OPS,
  DATE_LEVEL_LABEL,
  REPORT_OPERATOR_LABEL,
  SHOW_AS,
  SHOW_AS_LABEL,
  VALUE_FORMATS,
  VISUAL_TYPE_LABEL,
  type BiAggregate,
  type BiField,
  type BiFilter,
  type BiFilterOp,
  type BiMeasure,
  type BiPage,
  type BiVisual,
  type DateLevel,
  type ShowAs,
  type ValueFormat,
  type VisualType,
} from "@erp/shared";
import { useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { DATE_LEVEL_ORDER, isDateColumn, isMonthColumn, type BiDatasetInfo } from "../../lib/bi-format";
import { DATASET_APPS } from "../../lib/bi";
import { useI18n } from "../../lib/i18n";
import { ask } from "../feedback";

/** Jenis visual yang tersedia di editor (sisanya menyusul). */
export const EDITOR_VISUALS: VisualType[] = [
  "card",
  "kpi",
  "multi_card",
  "gauge",
  "column",
  "bar",
  "line",
  "area",
  "combo",
  "pie",
  "donut",
  "funnel",
  "treemap",
  "scatter",
  "table",
  "matrix",
  "slicer",
  "text",
];
const VISUAL_ICON: Partial<Record<VisualType, string>> = {
  card: "123",
  kpi: "▲%",
  multi_card: "≡",
  column: "▮▮",
  bar: "▬",
  line: "∿",
  area: "◭",
  pie: "◔",
  donut: "◎",
  table: "▦",
  matrix: "⊞",
  text: "T",
  gauge: "◠",
  combo: "▮∿",
  funnel: "⏷",
  treemap: "▤",
  scatter: "⁘",
  slicer: "☑",
};
const SINGLE: VisualType[] = ["card", "kpi", "multi_card", "gauge"];
/** Ukuran awal visual baru (kolom × baris grid). */
export const DEFAULT_SIZE: Record<VisualType, [number, number]> = {
  card: [3, 3],
  kpi: [3, 3],
  multi_card: [4, 4],
  gauge: [3, 4],
  column: [6, 7],
  bar: [6, 7],
  line: [6, 7],
  area: [6, 7],
  combo: [6, 7],
  pie: [4, 7],
  donut: [4, 7],
  funnel: [4, 7],
  treemap: [6, 7],
  scatter: [6, 7],
  table: [6, 8],
  matrix: [6, 8],
  slicer: [3, 5],
  text: [4, 3],
};

/** Ukuran baru dengan nilai bawaan skema. */
export const newMeasure = (p: Partial<BiMeasure>): BiMeasure =>
  biMeasureSchema.parse({ id: newId("m"), ...p });
/** Nama ukuran seperti di mesin (dipakai rumus): label, atau "Jumlah <kolom>". */
export const measureName = (m: BiMeasure, header: (key: string) => string) =>
  m.label ||
  (m.formula !== null && m.formula !== undefined
    ? m.id
    : `${BI_AGGREGATE_LABEL[m.fn][0]} ${!m.column || m.column === "*" ? "data" : header(m.column)}`);

export const newId = (prefix = "v") =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Field yang diseret dari panel Kolom. */
interface FieldDrag {
  column: string;
  numeric: boolean;
  date: boolean;
  month: boolean;
  level?: DateLevel;
}
const DRAG_TYPE = "application/x-bi-field";

const readDrag = (e: DragEvent): FieldDrag | null => {
  try {
    return JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as FieldDrag;
  } catch {
    return null;
  }
};

/** Tambahkan field ke visual: angka → nilai (jumlah), tanggal → sumbu tahun → bulan, lainnya → sumbu/legenda. */
export function addField(
  v: BiVisual,
  f: FieldDrag,
  well?: "axis" | "legend" | "values" | "columns",
): BiVisual {
  const target =
    well ??
    (v.type === "slicer" ? "axis" : f.numeric ? "values" : SINGLE.includes(v.type) ? "values" : "axis");
  if (target === "values") {
    const id = newId("m");
    const fn: BiAggregate = f.numeric ? "sum" : "count";
    return {
      ...v,
      values: [...v.values, newMeasure({ id, column: f.column, fn })],
    };
  }
  if (target === "columns")
    return v.columns.includes(f.column) ? v : { ...v, columns: [...v.columns, f.column] };
  // Kolom tanggal tanpa level dipilih → per bulan (level lain bisa diganti/ditambah di kotak isian).
  const fields: BiField[] = [{ column: f.column, level: f.level ?? (f.date ? "month" : null) }];
  if (target === "legend") return { ...v, legend: fields[fields.length > 1 ? 1 : 0] };
  if (v.type === "slicer") return { ...v, axis: fields.slice(0, 1) };
  const axis = [
    ...v.axis,
    ...fields.filter((x) => !v.axis.some((a) => a.column === x.column && a.level === x.level)),
  ];
  return { ...v, axis: axis.slice(0, 4) };
}

// ---- Panel Kolom ----

export function FieldsPane({
  datasets,
  dataset,
  onDataset,
  onAdd,
}: {
  datasets: BiDatasetInfo[];
  dataset: string;
  onDataset: (key: string) => void;
  onAdd: (f: FieldDrag) => void;
}) {
  const { l } = useI18n();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const ds = datasets.find((d) => d.key === dataset);
  const cols = (ds?.columns ?? []).filter((c) => !q || c.header.toLowerCase().includes(q.toLowerCase()));
  const groups: [string, typeof cols][] = [
    [l("Tanggal", "Dates"), cols.filter((c) => isDateColumn(c))],
    [l("Dimensi", "Dimensions"), cols.filter((c) => !c.numeric && !isDateColumn(c))],
    [l("Angka (Σ)", "Numbers (Σ)"), cols.filter((c) => c.numeric)],
  ];
  const drag = (f: FieldDrag) => (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(f));
    e.dataTransfer.effectAllowed = "copy";
  };
  return (
    <aside className="bi-pane bi-fields" aria-label={l("Kolom data", "Data fields")}>
      <h2>{l("Data", "Data")}</h2>
      <select
        aria-label={l("Dataset", "Dataset")}
        value={dataset}
        onChange={(e) => onDataset(e.target.value)}
      >
        {[...new Set(datasets.map((d) => d.app))].map((app) => (
          <optgroup key={app} label={l(...(DATASET_APPS[app] ?? [app, app]))}>
            {datasets
              .filter((d) => d.app === app)
              .map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <input
        type="search"
        placeholder={l("Cari kolom…", "Search fields…")}
        aria-label={l("Cari kolom", "Search fields")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <p className="muted small">
        {l(
          "Seret kolom ke kotak isian visual, atau klik untuk menambahkannya.",
          "Drag a field onto a visual's wells, or click to add it.",
        )}
      </p>
      {groups.map(([title, list]) =>
        list.length ? (
          <div key={title} className="bi-field-group">
            <h3>{title}</h3>
            <ul>
              {list.map((c) => {
                const date = isDateColumn(c);
                const month = date && isMonthColumn(c);
                const base: FieldDrag = { column: c.key, numeric: c.numeric, date, month };
                return (
                  <li key={c.key}>
                    <button
                      type="button"
                      draggable
                      onDragStart={drag(base)}
                      onClick={() => onAdd(base)}
                      className={`bi-field${c.numeric ? " numeric" : ""}`}
                      title={c.group}
                    >
                      <span aria-hidden="true">{c.numeric ? "Σ" : date ? "📅" : "Aa"}</span> {c.header}
                    </button>
                    {date && (
                      <button
                        type="button"
                        className="link small"
                        aria-expanded={open === c.key}
                        onClick={() => setOpen(open === c.key ? null : c.key)}
                        title={l("Level tanggal", "Date levels")}
                      >
                        {open === c.key ? "▾" : "▸"}
                      </button>
                    )}
                    {date && open === c.key && (
                      <ul className="bi-levels">
                        {DATE_LEVEL_ORDER.filter(
                          (lv) => !month || ["year", "quarter", "month"].includes(lv),
                        ).map((lv) => (
                          <li key={lv}>
                            <button
                              type="button"
                              draggable
                              className="bi-field"
                              onDragStart={drag({ ...base, level: lv })}
                              onClick={() => onAdd({ ...base, level: lv })}
                            >
                              {l(...DATE_LEVEL_LABEL[lv])}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null,
      )}
    </aside>
  );
}

// ---- Kotak isian ----

function Well({
  title,
  hint,
  onDropField,
  children,
}: {
  title: string;
  hint?: string;
  onDropField: (f: FieldDrag) => void;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`bi-well${over ? " over" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = readDrag(e);
        if (f) onDropField(f);
      }}
    >
      <h3>{title}</h3>
      {children}
      <p className="bi-well-drop muted small">{hint}</p>
    </div>
  );
}

function Chip({
  children,
  onRemove,
  onUp,
  onDown,
}: {
  children: ReactNode;
  onRemove: () => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const { l } = useI18n();
  return (
    <div className="bi-chip">
      <div className="bi-chip-main">{children}</div>
      <span className="bi-chip-tools">
        {onUp && (
          <button type="button" className="link" title={l("Naik", "Up")} onClick={onUp}>
            ↑
          </button>
        )}
        {onDown && (
          <button type="button" className="link" title={l("Turun", "Down")} onClick={onDown}>
            ↓
          </button>
        )}
        <button
          type="button"
          className="link"
          title={l("Hapus", "Remove")}
          aria-label={l("Hapus", "Remove")}
          onClick={onRemove}
        >
          ×
        </button>
      </span>
    </div>
  );
}

const swap = <T,>(list: T[], i: number, j: number) => {
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
};

// ---- Panel Visual ----

export function VisualPane({
  visual,
  datasets,
  reports,
  onChange,
}: {
  visual: BiVisual;
  datasets: BiDatasetInfo[];
  reports: { id: string; name: string }[];
  onChange: (v: BiVisual) => void;
}) {
  const { l } = useI18n();
  const [tab, setTab] = useState<"data" | "format" | "filter">("data");
  const ds = datasets.find((d) => d.key === visual.dataset);
  const header = (key: string) => ds?.columns.find((c) => c.key === key)?.header ?? key;
  const colInfo = (key: string) => ds?.columns.find((c) => c.key === key);
  const single = SINGLE.includes(visual.type);
  const set = (p: Partial<BiVisual>) => onChange({ ...visual, ...p });
  const setOpt = (p: Partial<BiVisual["options"]>) =>
    onChange({ ...visual, options: { ...visual.options, ...p } });
  const fieldLabel = (f: BiField) =>
    `${header(f.column)}${f.level ? ` · ${l(...DATE_LEVEL_LABEL[f.level])}` : ""}`;
  const levelSelect = (f: BiField, update: (f: BiField) => void) => {
    const c = colInfo(f.column);
    if (!c || !isDateColumn(c)) return null;
    const month = isMonthColumn(c);
    return (
      <select
        aria-label={l("Level tanggal", "Date level")}
        value={f.level ?? ""}
        onChange={(e) => update({ ...f, level: (e.target.value || null) as DateLevel | null })}
      >
        <option value="">{l("Nilai asli", "Raw value")}</option>
        {DATE_LEVEL_ORDER.filter((lv) => !month || ["year", "quarter", "month"].includes(lv)).map((lv) => (
          <option key={lv} value={lv}>
            {l(...DATE_LEVEL_LABEL[lv])}
          </option>
        ))}
      </select>
    );
  };
  const axisTitle =
    visual.type === "slicer"
      ? l("Kolom slicer", "Slicer field")
      : visual.type === "scatter"
        ? l("Detail (satu titik per nilai)", "Details (one point per value)")
        : visual.type === "table"
          ? l("Kelompok (baris)", "Group by (rows)")
          : visual.type === "matrix"
            ? l("Baris", "Rows")
            : l("Sumbu", "Axis");
  const measureIds = visual.values.map((m) => m.id);

  return (
    <aside className="bi-pane bi-visual-pane" aria-label={l("Pengaturan visual", "Visual settings")}>
      <div className="bi-types" role="radiogroup" aria-label={l("Jenis visual", "Visual type")}>
        {EDITOR_VISUALS.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={visual.type === t}
            className={visual.type === t ? "active" : ""}
            title={l(...VISUAL_TYPE_LABEL[t])}
            onClick={() => set({ type: t })}
          >
            <span aria-hidden="true">{VISUAL_ICON[t]}</span>
            <span className="sr-only">{l(...VISUAL_TYPE_LABEL[t])}</span>
          </button>
        ))}
      </div>
      <p className="muted small bi-type-name">{l(...VISUAL_TYPE_LABEL[visual.type])}</p>
      <div className="tabs" role="tablist">
        {(
          [
            ["data", l("Data", "Data")],
            ["format", l("Format", "Format")],
            [
              "filter",
              `${l("Filter", "Filters")}${visual.filters.length ? ` (${visual.filters.length})` : ""}`,
            ],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? "active" : ""}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "data" && visual.type !== "text" && (
        <div className="bi-wells">
          <label className="field">
            <span>{l("Sumber", "Source")}</span>
            <select
              value={visual.reportId ? `r:${visual.reportId}` : "dataset"}
              onChange={(e) =>
                e.target.value === "dataset"
                  ? set({ reportId: null, dataset: visual.dataset || datasets[0]?.key || "" })
                  : set({
                      reportId: e.target.value.slice(2),
                      dataset: "",
                      axis: [],
                      legend: null,
                      values: [],
                      columns: [],
                      filters: [],
                    })
              }
            >
              <option value="dataset">{l("Dataset (atur sendiri)", "Dataset (custom)")}</option>
              {reports.map((r) => (
                <option key={r.id} value={`r:${r.id}`}>
                  {l("Laporan", "Report")}: {r.name}
                </option>
              ))}
            </select>
          </label>
          {visual.reportId ? (
            <p className="muted small">
              {l("Data & grafik mengikuti laporan tersimpan.", "Data & chart follow the saved report.")}
            </p>
          ) : (
            <>
              {(ds?.filters ?? [])
                .filter((f) => f.type === "select" && f.options)
                .map((f) => (
                  <label key={f.key} className="field">
                    <span>{f.label}</span>
                    <select
                      value={visual.params[f.key] ?? ""}
                      onChange={(e) => {
                        const params = { ...visual.params };
                        if (e.target.value) params[f.key] = e.target.value;
                        else delete params[f.key];
                        set({ params });
                      }}
                    >
                      <option value="">{l("Semua", "All")}</option>
                      {f.options!.map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              {!single && (
                <Well
                  title={axisTitle}
                  hint={l("Seret kolom ke sini", "Drop a field here")}
                  onDropField={(f) => onChange(addField(visual, f, "axis"))}
                >
                  {visual.axis.map((f, i) => (
                    <Chip
                      key={`${f.column}@${f.level ?? ""}`}
                      onRemove={() => set({ axis: visual.axis.filter((_, j) => j !== i) })}
                      onUp={i > 0 ? () => set({ axis: swap(visual.axis, i, i - 1) }) : undefined}
                      onDown={
                        i < visual.axis.length - 1
                          ? () => set({ axis: swap(visual.axis, i, i + 1) })
                          : undefined
                      }
                    >
                      <span>{fieldLabel(f)}</span>
                      {levelSelect(f, (nf) => set({ axis: visual.axis.map((x, j) => (j === i ? nf : x)) }))}
                    </Chip>
                  ))}
                  {visual.axis.length > 1 && visual.type !== "table" && visual.type !== "matrix" && (
                    <p className="muted small">
                      {l(
                        "Lebih dari satu field = hierarki (drill turun).",
                        "More than one field = hierarchy (drill down).",
                      )}
                    </p>
                  )}
                </Well>
              )}
              {!single &&
                !["table", "pie", "donut", "funnel", "treemap", "scatter", "slicer"].includes(
                  visual.type,
                ) && (
                  <Well
                    title={visual.type === "matrix" ? l("Kolom", "Columns") : l("Legenda", "Legend")}
                    hint={l("Satu kolom untuk memecah seri", "One field to split series")}
                    onDropField={(f) => onChange(addField(visual, f, "legend"))}
                  >
                    {visual.legend && (
                      <Chip onRemove={() => set({ legend: null })}>
                        <span>{fieldLabel(visual.legend)}</span>
                        {levelSelect(visual.legend, (nf) => set({ legend: nf }))}
                      </Chip>
                    )}
                  </Well>
                )}
              {visual.type !== "slicer" && (
                <>
                  <Well
                    title={
                      visual.type === "scatter"
                        ? l("Nilai: X, Y, ukuran titik", "Values: X, Y, bubble size")
                        : visual.type === "gauge"
                          ? l("Nilai (kedua = target)", "Value (second = target)")
                          : l("Nilai", "Values")
                    }
                    hint={l("Seret kolom angka ke sini", "Drop a numeric field here")}
                    onDropField={(f) => onChange(addField(visual, f, "values"))}
                  >
                    {visual.values.map((m, i) => (
                      <MeasureChip
                        key={m.id}
                        m={m}
                        names={visual.values.filter((x) => x.id !== m.id).map((x) => measureName(x, header))}
                        columns={ds?.columns ?? []}
                        header={m.column === "*" ? l("data", "rows") : header(m.column ?? "")}
                        numeric={!!colInfo(m.column ?? "")?.numeric}
                        onChange={(nm) => set({ values: visual.values.map((x, j) => (j === i ? nm : x)) })}
                        onRemove={() => set({ values: visual.values.filter((_, j) => j !== i) })}
                        onUp={i > 0 ? () => set({ values: swap(visual.values, i, i - 1) }) : undefined}
                      />
                    ))}
                    <p className="bi-well-actions">
                      <button
                        type="button"
                        className="link"
                        onClick={() =>
                          set({
                            values: [
                              ...visual.values,
                              newMeasure({
                                label: l("Banyaknya data", "Row count"),
                                column: "*",
                                fn: "count",
                              }),
                            ],
                          })
                        }
                      >
                        + {l("Banyaknya data", "Row count")}
                      </button>{" "}
                      ·{" "}
                      <button
                        type="button"
                        className="link"
                        onClick={() =>
                          set({
                            values: [
                              ...visual.values,
                              newMeasure({ label: l("Ukuran baru", "New measure"), formula: "" }),
                            ],
                          })
                        }
                      >
                        + {l("Rumus", "Formula")}
                      </button>
                      {visual.values.length > 0 && (
                        <QuickMeasure
                          measures={visual.values}
                          name={(x) => measureName(x, header)}
                          onAdd={(m) => set({ values: [...visual.values, m] })}
                        />
                      )}
                    </p>
                  </Well>
                </>
              )}
              {visual.type === "table" && (
                <Well
                  title={l("Kolom rincian (tanpa ringkasan)", "Detail columns (no summary)")}
                  hint={l("Dipakai bila tidak ada Nilai", "Used when there are no Values")}
                  onDropField={(f) => onChange(addField(visual, f, "columns"))}
                >
                  {visual.columns.map((c, i) => (
                    <Chip
                      key={c}
                      onRemove={() => set({ columns: visual.columns.filter((_, j) => j !== i) })}
                      onUp={i > 0 ? () => set({ columns: swap(visual.columns, i, i - 1) }) : undefined}
                    >
                      <span>{header(c)}</span>
                    </Chip>
                  ))}
                </Well>
              )}
            </>
          )}
        </div>
      )}

      {(tab === "format" || visual.type === "text") && (
        <div className="fields bi-format">
          <label className="field">
            <span>{l("Judul", "Title")}</span>
            <input
              value={visual.title}
              maxLength={120}
              placeholder={l("Tanpa judul", "Untitled")}
              onChange={(e) => set({ title: e.target.value })}
            />
          </label>
          {visual.type === "text" && (
            <label className="field">
              <span>{l("Teks", "Text")}</span>
              <textarea
                rows={6}
                maxLength={5000}
                value={visual.options.text ?? ""}
                onChange={(e) => setOpt({ text: e.target.value })}
              />
            </label>
          )}
          {["column", "bar", "line", "area"].includes(visual.type) && (
            <>
              <label className="field check">
                <span>{l("Bertumpuk", "Stacked")}</span>
                <input
                  type="checkbox"
                  checked={!!visual.options.stacked}
                  onChange={(e) => setOpt({ stacked: e.target.checked })}
                />
              </label>
              <label className="field check">
                <span>{l("Bertumpuk 100%", "100% stacked")}</span>
                <input
                  type="checkbox"
                  checked={!!visual.options.percent}
                  onChange={(e) => setOpt({ percent: e.target.checked })}
                />
              </label>
              <label className="field check">
                <span>{l("Label data", "Data labels")}</span>
                <input
                  type="checkbox"
                  checked={!!visual.options.dataLabels}
                  onChange={(e) => setOpt({ dataLabels: e.target.checked })}
                />
              </label>
            </>
          )}
          {visual.type === "combo" && (
            <>
              <fieldset className="bi-fieldset">
                <legend>{l("Digambar sebagai garis", "Drawn as lines")}</legend>
                {visual.values
                  .filter((m) => !m.hidden)
                  .map((m, i, arr) => {
                    const chosen = visual.options.lineMeasures ?? [];
                    const checked = chosen.length ? chosen.includes(m.id) : i === arr.length - 1 && i > 0;
                    return (
                      <label key={m.id} className="field check">
                        <span>
                          {m.label ||
                            (m.column === "*" ? l("Banyaknya data", "Row count") : header(m.column ?? m.id))}
                        </span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const base = chosen.length
                              ? chosen
                              : arr.filter((_, j) => j === arr.length - 1 && j > 0).map((x) => x.id);
                            setOpt({
                              lineMeasures: e.target.checked
                                ? [...base, m.id]
                                : base.filter((x) => x !== m.id),
                            });
                          }}
                        />
                      </label>
                    );
                  })}
              </fieldset>
              <label className="field check">
                <span>{l("Garis pada sumbu kedua (kanan)", "Lines on a secondary (right) axis")}</span>
                <input
                  type="checkbox"
                  checked={!!visual.options.secondaryAxis}
                  onChange={(e) => setOpt({ secondaryAxis: e.target.checked })}
                />
              </label>
              <label className="field check">
                <span>{l("Kolom bertumpuk", "Stacked columns")}</span>
                <input
                  type="checkbox"
                  checked={!!visual.options.stacked}
                  onChange={(e) => setOpt({ stacked: e.target.checked })}
                />
              </label>
            </>
          )}
          {visual.type === "slicer" && (
            <>
              <label className="field">
                <span>{l("Gaya slicer", "Slicer style")}</span>
                <select
                  value={visual.options.slicer ?? "list"}
                  onChange={(e) => setOpt({ slicer: e.target.value as "list" | "dropdown" | "range" })}
                >
                  <option value="list">{l("Daftar centang", "Checkbox list")}</option>
                  <option value="dropdown">{l("Dropdown", "Dropdown")}</option>
                  <option value="range">{l("Rentang (dari–sampai)", "Range (from–to)")}</option>
                </select>
              </label>
              <label className="field">
                <span>{l("Berlaku untuk", "Applies to")}</span>
                <select
                  value={visual.options.slicerScope ?? "page"}
                  onChange={(e) => setOpt({ slicerScope: e.target.value as "page" | "all" })}
                >
                  <option value="page">{l("Halaman ini", "This page")}</option>
                  <option value="all">{l("Semua halaman", "All pages")}</option>
                </select>
              </label>
            </>
          )}
          {!single && !["slicer", "text"].includes(visual.type) && !visual.reportId && (
            <label className="field check">
              <span>
                {l("Klik visual ini memfilter visual lain", "Clicking this visual filters other visuals")}
              </span>
              <input
                type="checkbox"
                checked={visual.crossFilter}
                onChange={(e) => set({ crossFilter: e.target.checked })}
              />
            </label>
          )}
          {visual.type === "gauge" &&
            (["min", "max", "target"] as const).map((k) => (
              <label key={k} className="field">
                <span>
                  {
                    {
                      min: l("Minimum", "Minimum"),
                      max: l("Maksimum", "Maximum"),
                      target: l("Target", "Target"),
                    }[k]
                  }
                </span>
                <input
                  inputMode="decimal"
                  value={visual.options[k] ?? ""}
                  placeholder={l("Otomatis", "Auto")}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d.-]/g, "");
                    setOpt({ [k]: v === "" ? undefined : Number(v) });
                  }}
                />
              </label>
            ))}
          {(visual.type === "table" || visual.type === "matrix") && visual.values.some((m) => !m.hidden) && (
            <fieldset className="bi-fieldset">
              <legend>{l("Format bersyarat", "Conditional formatting")}</legend>
              {visual.values
                .filter((m) => !m.hidden)
                .map((m) => {
                  const rule = (visual.options.conditional ?? []).find((c) => c.measure === m.id);
                  return (
                    <label key={m.id} className="field">
                      <span>
                        {m.label ||
                          (m.column === "*" ? l("Banyaknya data", "Row count") : header(m.column ?? m.id))}
                      </span>
                      <select
                        value={rule?.kind ?? ""}
                        onChange={(e) => {
                          const rest = (visual.options.conditional ?? []).filter((c) => c.measure !== m.id);
                          const kind = e.target.value as "scale" | "bar" | "icon" | "";
                          setOpt({ conditional: kind ? [...rest, { measure: m.id, kind }] : rest });
                        }}
                      >
                        <option value="">{l("Tidak ada", "None")}</option>
                        <option value="scale">{l("Skala warna", "Color scale")}</option>
                        <option value="bar">{l("Bar data", "Data bars")}</option>
                        <option value="icon">{l("Ikon naik/turun", "Up/down icons")}</option>
                      </select>
                    </label>
                  );
                })}
            </fieldset>
          )}
          {visual.type !== "text" && !visual.reportId && (
            <>
              {!single && (
                <>
                  <label className="field">
                    <span>{l("Urutkan menurut", "Sort by")}</span>
                    <select
                      value={visual.sort?.by ?? ""}
                      onChange={(e) =>
                        set({
                          sort: e.target.value
                            ? { by: e.target.value, dir: visual.sort?.dir ?? "desc" }
                            : null,
                        })
                      }
                    >
                      <option value="">{l("Otomatis", "Automatic")}</option>
                      {visual.axis.map((f) => (
                        <option
                          key={`${f.column}@${f.level ?? ""}`}
                          value={f.level ? `${f.column}@${f.level}` : f.column}
                        >
                          {fieldLabel(f)}
                        </option>
                      ))}
                      {visual.values
                        .filter((m) => !m.hidden)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label ||
                              (m.column === "*"
                                ? l("Banyaknya data", "Row count")
                                : header(m.column ?? m.id))}
                          </option>
                        ))}
                    </select>
                  </label>
                  {visual.sort && (
                    <label className="field">
                      <span>{l("Arah", "Direction")}</span>
                      <select
                        value={visual.sort.dir}
                        onChange={(e) =>
                          set({ sort: { ...visual.sort!, dir: e.target.value as "asc" | "desc" } })
                        }
                      >
                        <option value="desc">{l("Menurun", "Descending")}</option>
                        <option value="asc">{l("Menaik", "Ascending")}</option>
                      </select>
                    </label>
                  )}
                  <label className="field">
                    <span>{l("Tampilkan N teratas", "Show top N")}</span>
                    <input
                      inputMode="numeric"
                      value={visual.topN ?? ""}
                      placeholder={l("Semua", "All")}
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(/\D/g, ""));
                        set({ topN: n ? Math.min(n, 5000) : null });
                      }}
                    />
                  </label>
                </>
              )}
              {(visual.type === "kpi" || visual.type === "card") && (
                <>
                  <label className="field">
                    <span>{l("Bandingkan dengan", "Compare with")}</span>
                    <select
                      value={visual.options.compare ?? (visual.type === "kpi" ? "prev_period" : "none")}
                      onChange={(e) =>
                        setOpt({ compare: e.target.value as "none" | "prev_period" | "last_year" })
                      }
                    >
                      <option value="none">{l("Tidak ada", "None")}</option>
                      <option value="prev_period">{l("Periode lalu", "Previous period")}</option>
                      <option value="last_year">
                        {l("Periode sama tahun lalu", "Same period last year")}
                      </option>
                    </select>
                  </label>
                  <label className="field">
                    <span>{l("Target", "Target")}</span>
                    <input
                      inputMode="decimal"
                      value={visual.options.target ?? ""}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^\d.-]/g, "");
                        setOpt({ target: v === "" ? undefined : Number(v) });
                      }}
                    />
                  </label>
                </>
              )}
              <label className="field check">
                <span>{l("Abaikan periode dashboard", "Ignore the dashboard period")}</span>
                <input
                  type="checkbox"
                  checked={visual.ignorePeriod}
                  onChange={(e) => set({ ignorePeriod: e.target.checked })}
                />
              </label>
            </>
          )}
        </div>
      )}

      {tab === "filter" && visual.type !== "text" && (
        <FilterList
          filters={visual.filters}
          columns={ds?.columns ?? []}
          onChange={(filters) => set({ filters })}
          empty={l("Belum ada filter untuk visual ini.", "No filters on this visual yet.")}
        />
      )}
      {measureIds.length === 0 && tab === "data" && !visual.reportId && visual.type !== "text" && (
        <p className="muted small">{l("Tambahkan minimal satu Nilai.", "Add at least one value.")}</p>
      )}
    </aside>
  );
}

function MeasureChip({
  m,
  header,
  numeric,
  names,
  columns,
  onChange,
  onRemove,
  onUp,
}: {
  m: BiMeasure;
  header: string;
  numeric: boolean;
  /** Nama ukuran lain di visual (untuk rumus). */
  names: string[];
  columns: { key: string; header: string; numeric: boolean }[];
  onChange: (m: BiMeasure) => void;
  onRemove: () => void;
  onUp?: () => void;
}) {
  const { l } = useI18n();
  const [open, setOpen] = useState(false);
  const formula = m.formula !== null && m.formula !== undefined;
  const fns = (Object.keys(BI_AGGREGATE_LABEL) as BiAggregate[]).filter(
    (f) => numeric || f === "count" || f === "distinct",
  );
  return (
    <Chip onRemove={onRemove} onUp={onUp}>
      <div className="bi-measure">
        <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
          {m.label || (formula ? l("Rumus", "Formula") : `${l(...BI_AGGREGATE_LABEL[m.fn])} ${header}`)}
          {m.hidden ? ` (${l("tersembunyi", "hidden")})` : ""}
        </button>
        {open && (
          <div className="bi-measure-edit">
            <label className="field">
              <span>{l("Nama", "Name")}</span>
              <input
                value={m.label}
                maxLength={120}
                placeholder={formula ? "" : `${l(...BI_AGGREGATE_LABEL[m.fn])} ${header}`}
                onChange={(e) => onChange({ ...m, label: e.target.value })}
              />
            </label>
            {formula ? (
              <FormulaInput
                value={m.formula ?? ""}
                names={names}
                onChange={(formula) => onChange({ ...m, formula })}
              />
            ) : (
              m.column !== "*" && (
                <label className="field">
                  <span>{l("Hitung", "Aggregate")}</span>
                  <select
                    value={m.fn}
                    onChange={(e) => onChange({ ...m, fn: e.target.value as BiAggregate })}
                  >
                    {fns.map((f) => (
                      <option key={f} value={f}>
                        {l(...BI_AGGREGATE_LABEL[f])}
                      </option>
                    ))}
                  </select>
                </label>
              )
            )}
            <label className="field">
              <span>{l("Tampilkan sebagai", "Show value as")}</span>
              <select value={m.showAs} onChange={(e) => onChange({ ...m, showAs: e.target.value as ShowAs })}>
                {SHOW_AS.map((s) => (
                  <option key={s} value={s}>
                    {l(...SHOW_AS_LABEL[s])}
                  </option>
                ))}
              </select>
              {(m.showAs === "yoy" || m.showAs === "last_year") && (
                <small className="muted">
                  {l(
                    "Dibandingkan dengan periode yang sama tahun lalu (berdasarkan periode dashboard, atau sumbu tanggal bila tanpa periode).",
                    "Compared with the same period last year (from the dashboard period, or the date axis when there is no period).",
                  )}
                </small>
              )}
              {m.showAs === "vs_prev_period" && (
                <small className="muted">
                  {l(
                    "Sumbu tanggal: dibanding titik sebelumnya; selain itu: dibanding periode dashboard sebelumnya.",
                    "Date axis: versus the previous point; otherwise versus the previous dashboard period.",
                  )}
                </small>
              )}
            </label>
            {!formula && (
              <fieldset className="bi-fieldset">
                <legend>{l("Filter khusus ukuran ini", "Filters for this measure only")}</legend>
                <FilterList
                  filters={m.filters}
                  columns={columns}
                  onChange={(filters) => onChange({ ...m, filters })}
                  empty={l(
                    'Contoh: Pendapatan = jumlah nilai dengan kelompok "Pendapatan".',
                    'Example: Revenue = sum of amount where group is "Revenue".',
                  )}
                />
              </fieldset>
            )}
            <label className="field">
              <span>{l("Format", "Format")}</span>
              <select
                value={m.format}
                onChange={(e) => onChange({ ...m, format: e.target.value as ValueFormat })}
              >
                {VALUE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {
                      {
                        auto: l("Otomatis", "Auto"),
                        number: l("Angka", "Number"),
                        percent: l("Persen", "Percent"),
                        currency: l("Rupiah", "Currency"),
                        compact: l("Ringkas (jt/M)", "Compact"),
                      }[f]
                    }
                  </option>
                ))}
              </select>
            </label>
            <label className="field check">
              <span>{l("Sembunyikan (dipakai rumus)", "Hide (used by formulas)")}</span>
              <input
                type="checkbox"
                checked={m.hidden}
                onChange={(e) => onChange({ ...m, hidden: e.target.checked })}
              />
            </label>
          </div>
        )}
      </div>
    </Chip>
  );
}

// ---- Filter ----

export function FilterList({
  filters,
  columns,
  onChange,
  empty,
}: {
  filters: BiFilter[];
  columns: { key: string; header: string; numeric: boolean }[];
  onChange: (f: BiFilter[]) => void;
  empty: string;
}) {
  const { l } = useI18n();
  const update = (i: number, p: Partial<BiFilter>) =>
    onChange(filters.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const OPS: BiFilterOp[] = BI_FILTER_OPS.filter((o) => o !== "notIn");
  const opLabel = (o: BiFilterOp) =>
    o === "in"
      ? l("salah satu dari", "is any of")
      : o === "between"
        ? l("antara", "between")
        : o === "notIn"
          ? l("bukan salah satu", "is none of")
          : l(...REPORT_OPERATOR_LABEL[o]);
  return (
    <div className="bi-filters">
      {!filters.length && <p className="muted small">{empty}</p>}
      {filters.map((f, i) => {
        const c = columns.find((x) => x.key === f.column);
        return (
          <div key={i} className="bi-filter">
            <select
              aria-label={l("Kolom", "Field")}
              value={f.column}
              onChange={(e) => update(i, { column: e.target.value, level: null })}
            >
              {!c && <option value={f.column}>{f.column}</option>}
              {columns.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.header}
                </option>
              ))}
            </select>
            {c && isDateColumn(c) && (
              <select
                aria-label={l("Level tanggal", "Date level")}
                value={f.level ?? ""}
                onChange={(e) => update(i, { level: (e.target.value || null) as DateLevel | null })}
              >
                <option value="">{l("Tanggal", "Date")}</option>
                {DATE_LEVEL_ORDER.map((lv) => (
                  <option key={lv} value={lv}>
                    {l(...DATE_LEVEL_LABEL[lv])}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label={l("Operator", "Operator")}
              value={f.op}
              onChange={(e) => update(i, { op: e.target.value as BiFilterOp })}
            >
              {OPS.map((o) => (
                <option key={o} value={o}>
                  {opLabel(o)}
                </option>
              ))}
            </select>
            {f.op === "in" ? (
              <input
                aria-label={l("Nilai (pisahkan dengan koma)", "Values (comma separated)")}
                placeholder={l("nilai1, nilai2", "value1, value2")}
                value={f.values.join(", ")}
                onChange={(e) =>
                  update(i, {
                    values: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            ) : f.op === "between" ? (
              <>
                <input
                  aria-label={l("Dari", "From")}
                  value={f.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                />
                <input
                  aria-label={l("Sampai", "To")}
                  value={f.value2}
                  onChange={(e) => update(i, { value2: e.target.value })}
                />
              </>
            ) : f.op === "empty" || f.op === "notEmpty" ? null : (
              <input
                aria-label={l("Nilai", "Value")}
                value={f.value}
                onChange={(e) => update(i, { value: e.target.value })}
              />
            )}
            <button
              type="button"
              className="link"
              aria-label={l("Hapus filter", "Remove filter")}
              onClick={() => onChange(filters.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        );
      })}
      {columns.length > 0 && (
        <button
          type="button"
          className="link"
          onClick={() =>
            onChange([
              ...filters,
              { column: columns[0]!.key, op: "in", value: "", value2: "", values: [], level: null },
            ])
          }
        >
          + {l("Tambah filter", "Add filter")}
        </button>
      )}
    </div>
  );
}

// ---- Halaman ----

export function PageTabs({
  pages,
  current,
  editing,
  onSelect,
  onChange,
}: {
  pages: BiPage[];
  current: string;
  editing: boolean;
  onSelect: (id: string) => void;
  onChange?: (pages: BiPage[], select?: string) => void;
}) {
  const { l } = useI18n();
  const [renaming, setRenaming] = useState<string | null>(null);
  const index = pages.findIndex((p) => p.id === current);
  const names = useMemo(() => new Set(pages.map((p) => p.name)), [pages]);
  if (pages.length < 2 && !editing) return null;
  const add = () => {
    let n = pages.length + 1;
    while (names.has(`${l("Halaman", "Page")} ${n}`)) n++;
    const page: BiPage = { id: newId("p"), name: `${l("Halaman", "Page")} ${n}`, filters: [], visuals: [] };
    onChange?.([...pages, page], page.id);
  };
  const remove = async () => {
    const page = pages[index];
    if (!page || pages.length < 2) return;
    if (
      !(await ask({
        message: l(`Hapus halaman "${page.name}"?`, `Delete page "${page.name}"?`),
        danger: true,
      }))
    )
      return;
    const next = pages.filter((p) => p.id !== page.id);
    onChange?.(next, next[Math.max(0, index - 1)]!.id);
  };
  return (
    <nav className="bi-pages" aria-label={l("Halaman dashboard", "Dashboard pages")}>
      <div className="tabs" role="tablist">
        {pages.map((p) =>
          renaming === p.id ? (
            <input
              key={p.id}
              autoFocus
              aria-label={l("Nama halaman", "Page name")}
              defaultValue={p.name}
              maxLength={60}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name) onChange?.(pages.map((x) => (x.id === p.id ? { ...x, name } : x)));
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setRenaming(null);
              }}
            />
          ) : (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={p.id === current}
              className={p.id === current ? "active" : ""}
              onClick={() => onSelect(p.id)}
              onDoubleClick={editing ? () => setRenaming(p.id) : undefined}
            >
              {p.name}
            </button>
          ),
        )}
      </div>
      {editing && (
        <span className="bi-page-tools">
          <button type="button" onClick={add}>
            + {l("Halaman", "Page")}
          </button>
          <button type="button" onClick={() => setRenaming(current)}>
            {l("Ganti nama", "Rename")}
          </button>
          <button
            type="button"
            disabled={index <= 0}
            title={l("Geser ke kiri", "Move left")}
            onClick={() => onChange?.(swap(pages, index, index - 1))}
          >
            ←
          </button>
          <button
            type="button"
            disabled={index >= pages.length - 1}
            title={l("Geser ke kanan", "Move right")}
            onClick={() => onChange?.(swap(pages, index, index + 1))}
          >
            →
          </button>
          <button type="button" className="danger" disabled={pages.length < 2} onClick={() => void remove()}>
            {l("Hapus halaman", "Delete page")}
          </button>
        </span>
      )}
    </nav>
  );
}

// ---- Rumus & ukuran cepat ----

/** Masukan rumus dengan saran nama ukuran saat mengetik "[", tombol fungsi, dan validasi langsung. */
function FormulaInput({
  value,
  names,
  onChange,
}: {
  value: string;
  names: string[];
  onChange: (v: string) => void;
}) {
  const { l } = useI18n();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const before = value.slice(0, caret);
  const open = /\[([^\]]*)$/.exec(before);
  const suggestions = open
    ? [...new Set(names)].filter((n) => n.toLowerCase().includes(open[1]!.toLowerCase())).slice(0, 8)
    : [];
  const error = (() => {
    if (!value.trim()) return l("Tulis rumus.", "Write a formula.");
    try {
      const tree = parseFormula(value);
      const known = new Set(names.map((n) => n.toLowerCase()));
      const missing = [...formulaRefs(tree)].filter((r) => !known.has(r.toLowerCase()));
      return missing.length
        ? l(`Ukuran tidak ditemukan: [${missing.join("], [")}]`, `Unknown measure: [${missing.join("], [")}]`)
        : null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  })();
  const insert = (text: string, replaceFrom = caret) => {
    const next = value.slice(0, replaceFrom) + text + value.slice(caret);
    onChange(next);
    const pos = replaceFrom + text.length;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };
  return (
    <div className="field bi-formula">
      <span>{l("Rumus", "Formula")}</span>
      <textarea
        ref={ref}
        rows={2}
        value={value}
        maxLength={500}
        spellCheck={false}
        placeholder="DIVIDE([Laba], [Omzet]) * 100"
        aria-invalid={!!error}
        aria-label={l("Rumus", "Formula")}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && suggestions.length && open) {
            e.preventDefault();
            insert(`[${suggestions[0]}]`, caret - open[0].length);
          }
        }}
      />
      {suggestions.length > 0 && open && (
        <ul className="bi-suggest" role="listbox" aria-label={l("Ukuran", "Measures")}>
          {suggestions.map((n, i) => (
            <li key={i}>
              <button type="button" className="link" onClick={() => insert(`[${n}]`, caret - open[0].length)}>
                [{n}]
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="bi-formula-tools">
        {[...new Set(names)].slice(0, 6).map((n) => (
          <button key={n} type="button" className="chip-btn" onClick={() => insert(`[${n}]`)}>
            [{n}]
          </button>
        ))}
        {FORMULA_FUNCTIONS.map((f) => (
          <button key={f} type="button" className="chip-btn" onClick={() => insert(`${f}(`)}>
            {f}
          </button>
        ))}
      </span>
      {error ? (
        <small className="error" role="alert">
          {error}
        </small>
      ) : (
        <small className="muted">{l("Rumus valid.", "Formula is valid.")}</small>
      )}
    </div>
  );
}

type QuickKind = "diff" | "ratio" | "margin" | "pct_total" | "running_total" | "yoy" | "last_year";

/** Ukuran cepat: selisih, rasio, margin dari dua ukuran; atau tampilan % total / berjalan / YoY dari satu ukuran. */
function QuickMeasure({
  measures,
  name,
  onAdd,
}: {
  measures: BiMeasure[];
  name: (m: BiMeasure) => string;
  onAdd: (m: BiMeasure) => void;
}) {
  const { l } = useI18n();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<QuickKind>("ratio");
  const [a, setA] = useState(measures[0]?.id ?? "");
  const [b, setB] = useState(measures[1]?.id ?? measures[0]?.id ?? "");
  const pair = kind === "diff" || kind === "ratio" || kind === "margin";
  const ma = measures.find((m) => m.id === a) ?? measures[0];
  const mb = measures.find((m) => m.id === b) ?? measures[0];
  const create = () => {
    if (!ma || !mb) return;
    const na = name(ma);
    const nb = name(mb);
    const made =
      kind === "diff"
        ? newMeasure({ label: `${na} − ${nb}`, formula: `[${na}] - [${nb}]` })
        : kind === "ratio"
          ? newMeasure({ label: `${na} ÷ ${nb}`, formula: `DIVIDE([${na}], [${nb}])` })
          : kind === "margin"
            ? newMeasure({
                label: `Margin ${na}`,
                formula: `DIVIDE([${na}] - [${nb}], [${na}]) * 100`,
                format: "percent",
              })
            : newMeasure({
                ...ma,
                id: newId("m"),
                hidden: false,
                label: `${na} (${l(...SHOW_AS_LABEL[kind])})`,
                showAs: kind,
              });
    onAdd(made);
    setOpen(false);
  };
  if (!open)
    return (
      <>
        {" "}
        ·{" "}
        <button type="button" className="link" onClick={() => setOpen(true)}>
          + {l("Ukuran cepat", "Quick measure")}
        </button>
      </>
    );
  return (
    <span className="bi-quick">
      <label className="field">
        <span>{l("Ukuran cepat", "Quick measure")}</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as QuickKind)}>
          <option value="ratio">{l("Rasio (A ÷ B)", "Ratio (A ÷ B)")}</option>
          <option value="diff">{l("Selisih (A − B)", "Difference (A − B)")}</option>
          <option value="margin">{l("Margin % ((A − B) ÷ A)", "Margin % ((A − B) ÷ A)")}</option>
          <option value="pct_total">{l("% dari total (A)", "% of grand total (A)")}</option>
          <option value="running_total">{l("Total berjalan (A)", "Running total (A)")}</option>
          <option value="yoy">{l("Pertumbuhan YoY (A)", "Year-over-year growth (A)")}</option>
          <option value="last_year">{l("Nilai tahun lalu (A)", "Last year's value (A)")}</option>
        </select>
      </label>
      <label className="field">
        <span>A</span>
        <select value={a} onChange={(e) => setA(e.target.value)}>
          {measures.map((m) => (
            <option key={m.id} value={m.id}>
              {name(m)}
            </option>
          ))}
        </select>
      </label>
      {pair && (
        <label className="field">
          <span>B</span>
          <select value={b} onChange={(e) => setB(e.target.value)}>
            {measures.map((m) => (
              <option key={m.id} value={m.id}>
                {name(m)}
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="bi-quick-actions">
        <button type="button" className="primary" onClick={create}>
          {l("Tambah", "Add")}
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          {l("Batal", "Cancel")}
        </button>
      </span>
    </span>
  );
}
