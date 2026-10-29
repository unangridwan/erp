"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart } from "../hr/charts";

/** Irisan pai maksimal sebelum sisanya digabung ke "Lainnya" (slot warna kategorikal tetap 1…6). */
const PIE_SLOTS = 6;

const useWidth = (min = 280) => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(min, Math.round(entry!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return { ref, width };
};

const nice = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v;
};

/** Grafik garis satu seri (tren), garis 2px, titik 8px, crosshair + tooltip saat hover. */
function LineChart(props: {
  labels: string[];
  values: number[];
  format: (v: number) => string;
  ariaLabel: string;
}) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const height = 200;
  const pad = { top: 10, right: 12, bottom: 22, left: 52 };
  const max = nice(Math.max(...props.values, 0));
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const step = props.labels.length > 1 ? plotW / (props.labels.length - 1) : 0;
  const x = (i: number) => pad.left + (props.labels.length > 1 ? i * step : plotW / 2);
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;
  const path = props.values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const every = Math.max(1, Math.ceil(props.labels.length / Math.max(1, Math.floor(plotW / 70))));
  return (
    <div className="viz" ref={ref}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={props.ariaLabel}
      >
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={pad.left - 6} y={y(t) + 4} textAnchor="end">
              {props.format(t)}
            </text>
          </g>
        ))}
        {props.labels.map((l, i) =>
          i % every === 0 ? (
            <text key={i} x={x(i)} y={height - 6} textAnchor="middle">
              {l}
            </text>
          ) : null,
        )}
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={pad.top}
            y2={pad.top + plotH}
            stroke="var(--grid)"
            strokeWidth={1}
          />
        )}
        {props.values.map((v, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(v)}
            r={hover === i ? 5 : 4}
            fill="var(--series-1)"
            stroke="var(--card)"
            strokeWidth={2}
          />
        ))}
        {props.labels.map((_, i) => (
          <rect
            key={i}
            x={x(i) - Math.max(step, 16) / 2}
            y={pad.top}
            width={Math.max(step, 16)}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hover !== null && (
        <div className="viz-tip" style={{ left: x(hover), top: Math.max(0, y(props.values[hover]!) - 44) }}>
          <strong>{props.labels[hover]}</strong>
          <br />
          {props.format(props.values[hover]!)}
        </div>
      )}
    </div>
  );
}

/** Donat komposisi: maks 6 irisan + "Lainnya", celah 2px, legenda + persentase (identitas tidak hanya warna). */
function PieChart(props: {
  labels: string[];
  values: number[];
  format: (v: number) => string;
  ariaLabel: string;
  other: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const items = props.labels.map((label, i) => ({ label, value: Math.max(0, props.values[i] ?? 0) }));
  items.sort((a, b) => b.value - a.value);
  const head = items.slice(0, PIE_SLOTS - (items.length > PIE_SLOTS ? 1 : 0));
  const rest = items.slice(head.length);
  const slices = rest.length
    ? [...head, { label: props.other, value: rest.reduce((s, r) => s + r.value, 0) }]
    : head;
  const total = slices.reduce((s, r) => s + r.value, 0) || 1;
  const size = 180;
  const r = 80;
  const inner = 50;
  let angle = -Math.PI / 2;
  const arc = (a0: number, a1: number) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => [size / 2 + rad * Math.cos(a), size / 2 + rad * Math.sin(a)];
    const [x0, y0] = p(r, a0);
    const [x1, y1] = p(r, a1);
    const [x2, y2] = p(inner, a1);
    const [x3, y3] = p(inner, a0);
    return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${inner},${inner} 0 ${large} 0 ${x3},${y3} Z`;
  };
  const pct = (v: number) => `${Math.round((v / total) * 1000) / 10}%`;
  return (
    <div className="viz pie">
      <div className="legend wrap">
        {slices.map((s, i) => (
          <span key={s.label}>
            <i style={{ background: `var(--series-${i + 1})` }} />
            {s.label} · {pct(s.value)}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={props.ariaLabel}>
        {slices.map((s, i) => {
          const a0 = angle;
          const a1 = angle + (s.value / total) * Math.PI * 2;
          angle = a1;
          // Satu irisan penuh: lingkaran donat utuh.
          const full = s.value >= total - 1e-9;
          return (
            <path
              key={s.label}
              d={
                full
                  ? `M${size / 2 - r},${size / 2} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 M${size / 2 - inner},${size / 2} a${inner},${inner} 0 1,0 ${2 * inner},0 a${inner},${inner} 0 1,0 ${-2 * inner},0`
                  : arc(a0, a1)
              }
              fillRule="evenodd"
              fill={`var(--series-${i + 1})`}
              stroke="var(--card)"
              strokeWidth={2}
              opacity={hover === null || hover === i ? 1 : 0.55}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <title>
                {s.label}: {props.format(s.value)} ({pct(s.value)})
              </title>
            </path>
          );
        })}
        <text x={size / 2} y={size / 2 + 4} textAnchor="middle">
          {hover === null ? props.format(total) : props.format(slices[hover]!.value)}
        </text>
      </svg>
    </div>
  );
}

/** Grafik hasil laporan: batang, garis, atau pai atas satu kolom label (x) dan satu kolom angka (y). */
export function ReportChart(props: {
  type: "bar" | "line" | "pie";
  rows: Record<string, unknown>[];
  x: string;
  y: string;
  yLabel: string;
  locale: string;
  empty: string;
  other: string;
}) {
  const labels = props.rows.map((r) => String(r[props.x] ?? "—") || "—");
  const values = props.rows.map((r) => Number(r[props.y]) || 0);
  const format = (v: number) =>
    v.toLocaleString(props.locale === "id" ? "id-ID" : "en", {
      notation: Math.abs(v) >= 1e6 ? "compact" : "standard",
      maximumFractionDigits: 2,
    });
  if (!labels.length) return <p className="muted">{props.empty}</p>;
  const aria = `${props.yLabel} per ${props.x}`;
  if (props.type === "line")
    return <LineChart labels={labels} values={values} format={format} ariaLabel={aria} />;
  if (props.type === "pie")
    return <PieChart labels={labels} values={values} format={format} ariaLabel={aria} other={props.other} />;
  return (
    <BarChart
      labels={labels}
      series={[{ key: props.y, label: props.yLabel, slot: 1, values }]}
      format={format}
      ariaLabel={aria}
      empty={props.empty}
    />
  );
}
