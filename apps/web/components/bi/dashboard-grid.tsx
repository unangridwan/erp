"use client";

import { periodRange, type DashboardWidget, type PeriodPreset } from "@erp/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { WidgetResult } from "../../lib/bi";
import { useI18n } from "../../lib/i18n";
import { ReportChart } from "../reports/report-chart";

export type Widget = DashboardWidget & { hidden?: boolean };

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Rentang tanggal dari preset atau kustom. */
export function resolvePeriod(preset: PeriodPreset | "custom", custom: { from: string; to: string }) {
  return preset === "custom" ? custom : periodRange(preset, todayIso());
}

/** Jalankan widget di server untuk periode tertentu. */
export function useWidgetResults(
  body: { builtin?: string; dashboardId?: string; widgets?: Widget[] } | null,
  period: { from: string; to: string },
  version = 0,
) {
  const [results, setResults] = useState<Record<string, WidgetResult> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(body);
  useEffect(() => {
    if (!body) return;
    let alive = true;
    setResults(null);
    setError(null);
    const payload = body.widgets
      ? { widgets: body.widgets.map(({ hidden: _h, ...w }) => w) }
      : { builtin: body.builtin, dashboardId: body.dashboardId };
    api<{ widgets: WidgetResult[] }>("/dashboards/run", {
      method: "POST",
      body: { ...payload, from: period.from, to: period.to },
    })
      .then((r) => alive && setResults(Object.fromEntries(r.widgets.map((w) => [w.id, w]))))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [key, period.from, period.to, version]);
  return { results, error };
}

const fmt = (v: unknown, locale: string, compact = false) => {
  const n = typeof v === "number" ? v : Number(v);
  if (v === null || v === undefined || v === "" || Number.isNaN(n)) return String(v ?? "");
  return n.toLocaleString(locale === "id" ? "id-ID" : "en-US", {
    maximumFractionDigits: 2,
    ...(compact && Math.abs(n) >= 1e6 ? { notation: "compact" as const } : {}),
  });
};

function WidgetBody({ widget, result }: { widget: Widget; result?: WidgetResult }) {
  const { l, locale } = useI18n();
  if (!result) return <div className="skeleton-block" aria-busy="true" />;
  if (result.error) return <p className="error small">{result.error}</p>;
  if (widget.type === "kpi") {
    const change = result.change;
    return (
      <div className="kpi">
        <strong className="kpi-value" title={fmt(result.value, locale)}>
          {fmt(result.value, locale, true)}
        </strong>
        {widget.compare && result.previous !== undefined && (
          <span
            className={`kpi-change ${change === null || change === undefined ? "" : change >= 0 ? "up" : "down"}`}
          >
            {change === null || change === undefined
              ? l("Periode lalu: ", "Previous: ") + fmt(result.previous, locale, true)
              : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toLocaleString(locale === "id" ? "id-ID" : "en-US")}% ${l(
                  "vs periode lalu",
                  "vs previous",
                )}`}
          </span>
        )}
      </div>
    );
  }
  const columns = result.columns ?? [];
  const rows = result.rows ?? [];
  if (widget.type === "table" || !result.chart) {
    if (!rows.length) return <p className="muted small">{l("Tidak ada data.", "No data.")}</p>;
    return (
      <div className="table-wrap widget-table">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.numeric ? "num" : undefined}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? "num" : undefined}>
                    {c.numeric ? fmt(r[c.key], locale) : String(r[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const chartType = widget.type === "line" || widget.type === "pie" ? widget.type : "bar";
  return (
    <ReportChart
      type={chartType}
      rows={rows}
      x={result.chart.x}
      y={result.chart.y}
      yLabel={columns.find((c) => c.key === result.chart!.y)?.header ?? result.chart.y}
      locale={locale}
      empty={l("Tidak ada data.", "No data.")}
      other={l("Lainnya", "Other")}
    />
  );
}

/** Grid widget dashboard. Mode ubah menampilkan kontrol lebar, urutan, judul, hapus. */
export function DashboardGrid({
  widgets,
  results,
  editing,
  onChange,
  reportHref,
}: {
  widgets: Widget[];
  results: Record<string, WidgetResult> | null;
  editing?: boolean;
  onChange?: (w: Widget[]) => void;
  reportHref?: (w: Widget) => string | undefined;
}) {
  const { l } = useI18n();
  const shown = widgets.filter((w) => !w.hidden && !(results?.[w.id]?.hidden && !editing));
  if (!shown.length)
    return (
      <p className="muted">
        {editing
          ? l("Belum ada widget. Tambahkan widget pertama.", "No widgets yet. Add the first one.")
          : l("Tidak ada widget yang bisa Anda lihat.", "No widgets you can view.")}
      </p>
    );
  const move = (i: number, d: -1 | 1) => {
    const next = [...widgets];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange?.(next);
  };
  const patch = (id: string, p: Partial<Widget>) =>
    onChange?.(widgets.map((w) => (w.id === id ? { ...w, ...p } : w)));
  return (
    <div className="dash-grid">
      {shown.map((w) => {
        const i = widgets.indexOf(w);
        const href = reportHref?.(w);
        return (
          <section key={w.id} className={`dash-widget span-${w.width} type-${w.type}`} data-widget={w.id}>
            <header>
              {editing ? (
                <input
                  aria-label={l("Judul widget", "Widget title")}
                  value={w.title}
                  maxLength={120}
                  onChange={(e) => patch(w.id, { title: e.target.value })}
                />
              ) : (
                <h3>{href ? <Link href={href}>{w.title}</Link> : w.title}</h3>
              )}
              {editing && (
                <span className="dash-widget-tools">
                  <select
                    aria-label={l("Lebar", "Width")}
                    value={w.width}
                    onChange={(e) => patch(w.id, { width: Number(e.target.value) })}
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}/4
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    title={l("Naik", "Up")}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    title={l("Turun", "Down")}
                    disabled={i === widgets.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="danger"
                    title={l("Hapus widget", "Remove widget")}
                    onClick={() => onChange?.(widgets.filter((x) => x.id !== w.id))}
                  >
                    ×
                  </button>
                </span>
              )}
            </header>
            {results?.[w.id]?.hidden ? (
              <p className="muted small">
                {l("Anda tidak berhak melihat data ini.", "You cannot view this data.")}
              </p>
            ) : (
              <WidgetBody widget={w} result={results?.[w.id]} />
            )}
          </section>
        );
      })}
    </div>
  );
}
