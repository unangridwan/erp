"use client";

import type { BiResult, BiResultField, BiVisual } from "@erp/shared";
import Link from "next/link";
import { useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import { categoryLabel, formatValue, prettyKey } from "../../lib/bi-format";
import { useI18n } from "../../lib/i18n";
import { rowHref } from "../drilldown-panel";
import { AxisChart, FunnelChart, GaugeChart, PieChart, ScatterChart, TreemapChart } from "./charts";

/** Titik visual yang diklik: nilai field (untuk rincian & filter silang). */
export interface VisualPoint {
  match: { column: string; level?: BiResultField["level"]; value: string }[];
  label: string;
}

const OTHER_KEY = "\u0000other";
const splitField = (key: string) => {
  const [column, level] = key.split("@") as [string, BiResultField["level"] | undefined];
  return { column, level: level ?? null };
};

/** Nilai field dimensi (dan legenda) pada kategori/seri hasil → kecocokan rincian. */
function pointFor(
  visual: BiVisual,
  result: BiResult,
  categoryIndex: number,
  seriesIndex: number,
  locale: string,
): VisualPoint {
  const dims = result.fields.filter((f) => f.kind === "dimension");
  const row = result.rows[categoryIndex] ?? {};
  const match = dims.map((f) => ({ ...splitField(f.key), value: String(row[f.key] ?? "") }));
  const parts = [categoryLabel(result.categories[categoryIndex]?.label ?? "", locale)];
  // Seri legenda: id `ukuran:nilaiLegenda`.
  const series = result.series[seriesIndex];
  if (visual.legend && series?.id.includes(":")) {
    const value = series.id.slice(series.id.indexOf(":") + 1);
    if (value !== OTHER_KEY)
      match.push({ column: visual.legend.column, level: visual.legend.level ?? null, value });
    parts.push(series.label);
  }
  return { match, label: parts.join(" · ") };
}

export function VisualBody({
  visual,
  result,
  onPoint,
}: {
  visual: BiVisual;
  result?: BiResult;
  /** Klik titik/baris: rincian (fase berikut: filter silang). */
  onPoint?: (p: VisualPoint, e: MouseEvent) => void;
}) {
  const { l, locale } = useI18n();
  if (visual.type === "text")
    return (
      <div className="bi-text">
        {(visual.options.text ?? "").split(/\n{2,}/).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    );
  if (!result) return <div className="skeleton-block" aria-busy="true" />;
  if (result.hidden)
    return (
      <p className="muted small">{l("Anda tidak berhak melihat data ini.", "You cannot view this data.")}</p>
    );
  if (result.error) return <p className="error small">{result.error}</p>;

  const fieldFormat = (key: string) => result.fields.find((f) => f.key === key)?.format;
  const firstMeasure = result.fields.find((f) => f.kind === "measure");
  const fmt = (v: number | null, key = firstMeasure?.key, compact = false) =>
    formatValue(v, key ? fieldFormat(key) : undefined, locale, compact);

  switch (visual.type) {
    case "gauge":
      return (
        <GaugeChart
          value={result.card?.value ?? null}
          min={visual.options.min}
          max={visual.options.max}
          target={result.card?.target ?? null}
          format={(v) => fmt(v, firstMeasure?.key, true)}
          ariaLabel={visual.title || l("Pengukur", "Gauge")}
        />
      );
    case "card":
    case "kpi":
      return <CardView visual={visual} result={result} fmt={fmt} onPoint={onPoint} />;
    case "multi_card":
      return (
        <dl className="bi-multicard">
          {result.fields
            .filter((f) => f.kind === "measure")
            .map((f) => (
              <div key={f.key}>
                <dt>{f.header}</dt>
                <dd>{fmt((result.rows[0]?.[f.key] as number | null) ?? null, f.key, true)}</dd>
              </div>
            ))}
        </dl>
      );
    case "table":
      return <TableView visual={visual} result={result} onPoint={onPoint} />;
    case "matrix":
      return <MatrixView visual={visual} result={result} />;
    default:
      break;
  }

  if (!result.categories.length) return <p className="muted small">{l("Tidak ada data.", "No data.")}</p>;
  const categories = result.categories.map((c) => ({ key: c.key, label: categoryLabel(c.label, locale) }));
  const seriesFormat = (si: number) => fieldFormat(result.series[si]?.measure ?? "");
  const select = onPoint
    ? (ci: number, si: number, e: MouseEvent) => {
        onPoint(pointFor(visual, result, ci, si, locale), e);
      }
    : undefined;
  const common = {
    categories,
    series: result.series,
    format: (v: number | null) => formatValue(v, seriesFormat(0), locale),
    formatAxis: (v: number) => formatValue(v, seriesFormat(0), locale, true),
    ariaLabel: `${visual.title || l("Grafik", "Chart")}: ${result.series.map((s) => s.label).join(", ")}`,
    dataLabels: visual.options.dataLabels,
    showLegend: visual.options.legend,
    highlight: result.highlight,
    onSelect: select,
  };
  if (visual.type === "pie" || visual.type === "donut")
    return <PieChart {...common} donut={visual.type === "donut"} otherLabel={l("Lainnya", "Other")} />;
  if (visual.type === "funnel") return <FunnelChart {...common} />;
  if (visual.type === "treemap") return <TreemapChart {...common} otherLabel={l("Lainnya", "Other")} />;
  if (visual.type === "scatter")
    return (
      <ScatterChart
        {...common}
        xLabel={result.series[0]?.label ?? "x"}
        yLabel={result.series[1]?.label ?? "y"}
      />
    );
  if (visual.type === "combo") {
    // Garis: ukuran yang dipilih, atau ukuran terakhir bila belum dipilih.
    const chosen = visual.options.lineMeasures ?? [];
    const lines = result.series
      .map((s, i) =>
        chosen.length
          ? chosen.includes(s.measure)
            ? i
            : -1
          : i === result.series.length - 1 && i > 0
            ? i
            : -1,
      )
      .filter((i) => i >= 0);
    return (
      <AxisChart
        {...common}
        kind="column"
        stacked={visual.options.stacked}
        lineSeries={lines}
        dualAxis={visual.options.secondaryAxis}
      />
    );
  }
  const kind =
    visual.type === "bar"
      ? "bar"
      : visual.type === "line"
        ? "line"
        : visual.type === "area"
          ? "area"
          : "column";
  return (
    <AxisChart {...common} kind={kind} stacked={visual.options.stacked} percent={visual.options.percent} />
  );
}

function CardView({
  visual,
  result,
  fmt,
  onPoint,
}: {
  visual: BiVisual;
  result: BiResult;
  fmt: (v: number | null, key?: string, compact?: boolean) => string;
  onPoint?: (p: VisualPoint, e: MouseEvent) => void;
}) {
  const { l, locale } = useI18n();
  const card = result.card ?? { value: null };
  const measure = result.fields.find((f) => f.kind === "measure");
  const value = fmt(card.value, measure?.key, true);
  const compareLabel =
    visual.options.compare === "last_year"
      ? l("vs tahun lalu", "vs last year")
      : l("vs periode lalu", "vs previous period");
  return (
    <div className="kpi">
      {onPoint ? (
        <button
          type="button"
          className="link kpi-value"
          title={fmt(card.value, measure?.key)}
          onClick={(e) => onPoint({ match: [], label: "" }, e)}
        >
          {value}
        </button>
      ) : (
        <strong className="kpi-value" title={fmt(card.value, measure?.key)}>
          {value}
        </strong>
      )}
      {visual.type !== "card" && measure && !visual.title && (
        <span className="muted small">{measure.header}</span>
      )}
      {card.previous !== undefined && (
        <span
          className={`kpi-change ${card.change === null || card.change === undefined ? "" : card.change >= 0 ? "up" : "down"}`}
        >
          {card.change === null || card.change === undefined
            ? `${l("Pembanding", "Previous")}: ${fmt(card.previous ?? null, measure?.key, true)}`
            : `${card.change >= 0 ? "▲" : "▼"} ${Math.abs(card.change).toLocaleString(locale === "id" ? "id-ID" : "en-US")}% ${compareLabel}`}
        </span>
      )}
      {card.target !== null && card.target !== undefined && visual.type !== "card" && (
        <span className="muted small">
          {l("Target", "Target")}: {fmt(card.target, measure?.key, true)}
          {card.value !== null && card.target
            ? ` (${Math.round((card.value / card.target) * 1000) / 10}%)`
            : ""}
        </span>
      )}
    </div>
  );
}

/** Format bersyarat sel angka: skala warna, bar data, atau ikon ▲▼ (relatif terhadap nilai kolom). */
function useConditional(visual: BiVisual, values: (key: string) => (number | null)[]) {
  return useMemo(() => {
    const rules = new Map((visual.options.conditional ?? []).map((c) => [c.measure, c.kind]));
    const ranges = new Map<string, [number, number]>();
    for (const key of rules.keys()) {
      const nums = values(key).filter((v): v is number => v !== null && Number.isFinite(v));
      ranges.set(key, [Math.min(0, ...nums), Math.max(0, ...nums)]);
    }
    return (key: string, v: number | null): { style?: CSSProperties; icon?: string } => {
      const kind = rules.get(key);
      if (!kind || v === null) return {};
      const [lo, hi] = ranges.get(key)!;
      const pct = Math.round((hi === lo ? 0 : (v - lo) / (hi - lo)) * 100);
      if (kind === "icon") return { icon: v > 0 ? "▲" : v < 0 ? "▼" : "●" };
      if (kind === "bar")
        return {
          style: {
            background: `linear-gradient(to right, color-mix(in srgb, var(--series-1) 28%, transparent) ${pct}%, transparent ${pct}%)`,
          },
        };
      return {
        style: {
          background: `color-mix(in srgb, var(--series-3) ${Math.round(8 + pct * 0.47)}%, transparent)`,
        },
      };
    };
  }, [visual.options.conditional, values]);
}

function CondIcon({ icon }: { icon?: string }) {
  if (!icon) return null;
  return <span className={`bi-icon ${icon === "▲" ? "up" : icon === "▼" ? "down" : ""}`}>{icon} </span>;
}
const num = (v: unknown) => (typeof v === "number" ? v : null);

function TableView({
  visual,
  result,
  onPoint,
}: {
  visual: BiVisual;
  result: BiResult;
  onPoint?: (p: VisualPoint, e: MouseEvent) => void;
}) {
  const { l, locale } = useI18n();
  const values = useMemo(() => (key: string) => result.rows.map((r) => num(r[key])), [result.rows]);
  const cond = useConditional(visual, values);
  if (!result.rows.length) return <p className="muted small">{l("Tidak ada data.", "No data.")}</p>;
  const dims = result.fields.filter((f) => f.kind === "dimension");
  const grouped = result.fields.some((f) => f.kind === "measure") && result.categories.length > 0;
  const cell = (f: BiResultField, v: unknown) =>
    f.kind === "measure"
      ? formatValue(typeof v === "number" ? v : v === null || v === "" ? null : Number(v), f.format, locale)
      : f.level
        ? prettyKey(String(v ?? ""), locale) || "—"
        : String(v ?? "") || "—";
  return (
    <div className="table-wrap bi-table">
      <table>
        <thead>
          <tr>
            {result.fields.map((f) => (
              <th key={f.key} className={f.kind === "measure" ? "num" : undefined}>
                {f.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r, i) => {
            const href = rowHref(r);
            return (
              <tr key={i}>
                {result.fields.map((f, j) => {
                  const cf = f.kind === "measure" ? cond(f.key, num(r[f.key])) : {};
                  return (
                    <td key={f.key} className={f.kind === "measure" ? "num" : undefined} style={cf.style}>
                      <CondIcon icon={cf.icon} />
                      {f.kind === "measure" && grouped && onPoint ? (
                        <button
                          type="button"
                          className="link drill"
                          onClick={(e) =>
                            onPoint(
                              {
                                match: dims.map((d) => ({
                                  ...splitField(d.key),
                                  value: String(r[d.key] ?? ""),
                                })),
                                label: dims.map((d) => cell(d, r[d.key])).join(" · "),
                              },
                              e,
                            )
                          }
                        >
                          {cell(f, r[f.key])}
                        </button>
                      ) : j === 0 && href ? (
                        <Link href={href}>{cell(f, r[f.key])}</Link>
                      ) : (
                        cell(f, r[f.key])
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {Object.keys(result.totals).length > 0 && (
          <tfoot>
            <tr>
              {result.fields.map((f, j) => (
                <td key={f.key} className={f.kind === "measure" ? "num" : undefined}>
                  {j === 0 && f.kind !== "measure"
                    ? l("Total", "Total")
                    : f.key in result.totals
                      ? formatValue(result.totals[f.key] ?? null, f.format, locale)
                      : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      {result.truncated && (
        <p className="muted small">{l("Hanya sebagian baris ditampilkan.", "Only some rows are shown.")}</p>
      )}
    </div>
  );
}

function MatrixView({ visual, result }: { visual: BiVisual; result: BiResult }) {
  const { l, locale } = useI18n();
  const matrix = result.matrix!;
  const values = useMemo(
    () => (key: string) =>
      matrix.rows.flatMap((r) => [
        r.total[key] ?? null,
        ...Object.values(r.cells).map((c) => c[key] ?? null),
      ]),
    [matrix.rows],
  );
  const cond = useConditional(visual, values);
  const measures = result.fields.filter((f) => f.kind === "measure");
  const dims = result.fields.filter((f) => f.kind === "dimension");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const hasChildren = useMemo(() => {
    const set = new Set<string>();
    for (const r of matrix.rows) if (r.depth > 0) set.add(JSON.stringify(r.path.slice(0, -1)));
    return set;
  }, [matrix.rows]);
  if (!matrix.rows.length) return <p className="muted small">{l("Tidak ada data.", "No data.")}</p>;
  const visible = matrix.rows.filter((r) => {
    for (let d = 1; d <= r.depth; d++) if (!open.has(JSON.stringify(r.path.slice(0, d)))) return false;
    return true;
  });
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const allOpen = () => setOpen(new Set(matrix.rows.map((r) => JSON.stringify(r.path))));
  const fmt = (v: number | null | undefined, f: BiResultField) => formatValue(v ?? null, f.format, locale);
  const cols = matrix.columns;
  return (
    <div className="table-wrap bi-table bi-matrix">
      {dims.length > 1 && (
        <p className="bi-matrix-tools">
          <button type="button" className="link" onClick={allOpen}>
            {l("Perluas semua", "Expand all")}
          </button>{" "}
          ·{" "}
          <button type="button" className="link" onClick={() => setOpen(new Set())}>
            {l("Ciutkan semua", "Collapse all")}
          </button>
        </p>
      )}
      <table>
        <thead>
          {cols.length > 0 && (
            <tr>
              <th />
              {cols.map((c) => (
                <th key={c.key} colSpan={measures.length} className="num">
                  {categoryLabel(c.label, locale)}
                </th>
              ))}
              <th colSpan={measures.length} className="num">
                {l("Total", "Total")}
              </th>
            </tr>
          )}
          <tr>
            <th>{dims.map((d) => d.header).join(" / ")}</th>
            {[...cols, null].flatMap((c) =>
              measures.map((m) => (
                <th key={`${c?.key ?? "t"}-${m.key}`} className="num">
                  {m.header}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => {
            const k = JSON.stringify(r.path);
            const expandable = hasChildren.has(k);
            const f = dims[r.depth];
            const name = r.path[r.depth] ?? "";
            return (
              <tr key={k} className={`depth-${r.depth}`}>
                <td style={{ paddingLeft: 8 + r.depth * 18 }}>
                  {expandable ? (
                    <button
                      type="button"
                      className="link bi-expand"
                      aria-expanded={open.has(k)}
                      onClick={() => toggle(k)}
                    >
                      {open.has(k) ? "−" : "+"}
                    </button>
                  ) : (
                    <span className="bi-expand-gap" />
                  )}
                  {f?.level ? prettyKey(name, locale) : name || l("(Kosong)", "(Blank)")}
                </td>
                {cols.flatMap((c) =>
                  measures.map((m) => {
                    const v = r.cells[c.key]?.[m.key] ?? null;
                    const cf = r.cells[c.key] ? cond(m.key, v) : {};
                    return (
                      <td key={`${c.key}-${m.key}`} className="num" style={cf.style}>
                        <CondIcon icon={cf.icon} />
                        {r.cells[c.key] ? fmt(v, m) : ""}
                      </td>
                    );
                  }),
                )}
                {measures.map((m) => {
                  const cf = cond(m.key, r.total[m.key] ?? null);
                  return (
                    <td key={`t-${m.key}`} className="num total" style={cf.style}>
                      <CondIcon icon={cf.icon} />
                      {fmt(r.total[m.key], m)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>{l("Total", "Total")}</td>
            {cols.flatMap((c) =>
              measures.map((m) => (
                <td key={`${c.key}-${m.key}`} className="num">
                  {fmt(matrix.columnTotals[c.key]?.[m.key], m)}
                </td>
              )),
            )}
            {measures.map((m) => (
              <td key={`g-${m.key}`} className="num total">
                {fmt(result.totals[m.key], m)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      {result.truncated && (
        <p className="muted small">{l("Hanya sebagian baris ditampilkan.", "Only some rows are shown.")}</p>
      )}
    </div>
  );
}
