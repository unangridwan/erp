"use client";

import { useEffect, useRef, useState } from "react";

export interface BarSeries {
  key: string;
  label: string;
  /** Slot warna kategorikal (1 atau 2). */
  slot: 1 | 2;
  values: number[];
}

/**
 * Grafik batang vertikal (satu atau dua seri berdampingan) dalam SVG: batang tipis dengan ujung membulat 4px,
 * celah 2px antar batang, grid samar, label sumbu-x, legenda untuk ≥ 2 seri, dan tooltip saat hover.
 */
/** Potong label sumbu agar muat di lebar `width` piksel (±7px per karakter pada 12px). */
const fit = (label: string, width: number) => {
  const max = Math.max(3, Math.floor((width - 6) / 7));
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
};

export function BarChart(props: {
  labels: string[];
  series: BarSeries[];
  format?: (v: number) => string;
  height?: number;
  ariaLabel: string;
  /** Teks saat semua nilai nol. */
  empty?: string;
  /** Klik batang (drilldown). */
  onSelect?: (index: number) => void;
}) {
  const { labels, series } = props;
  const format = props.format ?? ((v: number) => String(v));
  const height = props.height ?? 180;
  // Lebar SVG = lebar kontainer (piksel) agar teks sumbu tidak ikut membesar/mengecil.
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pad = { top: 8, right: 8, bottom: 22, left: 44 };
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const nice = niceMax(max);
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const group = plotW / labels.length;
  const barW = Math.min(18, (group * 0.7 - 2 * (series.length - 1)) / series.length);
  const y = (v: number) => pad.top + plotH - (v / nice) * plotH;
  const [hover, setHover] = useState<number | null>(null);
  // Data hitungan kecil: hanya tick bulat.
  const ticks = nice < 4 ? [0, nice] : [0, nice / 2, nice];
  const allZero = series.every((s) => s.values.every((v) => !v));

  return (
    <div className="viz" ref={ref}>
      {allZero && props.empty && <p className="muted">{props.empty}</p>}
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.key}>
              <i style={{ background: `var(--series-${s.slot})` }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {!(allZero && props.empty) && (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-label={props.ariaLabel}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--grid)"
                strokeWidth={1}
              />
              <text x={pad.left - 6} y={y(t) + 4} textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
          {labels.map((label, i) => {
            const x0 = pad.left + i * group + (group - (barW * series.length + 2 * (series.length - 1))) / 2;
            return (
              <g
                key={i}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={props.onSelect ? () => props.onSelect!(i) : undefined}
                style={props.onSelect ? { cursor: "pointer" } : undefined}
              >
                {/* Area hover lebih besar dari batang. */}
                <rect x={pad.left + i * group} y={pad.top} width={group} height={plotH} fill="transparent" />
                {hover === i && (
                  <rect
                    x={pad.left + i * group}
                    y={pad.top}
                    width={group}
                    height={plotH}
                    fill="var(--grid)"
                    opacity={0.35}
                  />
                )}
                {series.map((s, j) => {
                  const v = s.values[i] ?? 0;
                  const h = Math.max(0, pad.top + plotH - y(v));
                  return h > 0 ? (
                    <path
                      key={s.key}
                      d={roundedTop(x0 + j * (barW + 2), y(v), barW, h, Math.min(4, barW / 2, h))}
                      fill={`var(--series-${s.slot})`}
                    />
                  ) : null;
                })}
                <text x={pad.left + i * group + group / 2} y={height - 6} textAnchor="middle">
                  {/* Label panjang dipotong sesuai lebar kelompok; nama lengkap di tooltip. */}
                  <title>{label}</title>
                  {fit(label, group)}
                </text>
              </g>
            );
          })}
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + plotH}
            y2={pad.top + plotH}
            stroke="var(--border)"
            strokeWidth={1}
          />
        </svg>
      )}
      {hover !== null && !allZero && (
        <div
          className="viz-tip"
          style={{
            left: pad.left + hover * group + group / 2,
            top: (series.length > 1 ? 24 : 0) + pad.top + 4,
          }}
        >
          <strong>{labels[hover]}</strong>
          {series.map((s) => (
            <div key={s.key}>
              {series.length > 1 && <i style={{ background: `var(--series-${s.slot})` }} className="dot" />}
              {s.label}: {format(s.values[hover] ?? 0)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Daftar batang horizontal (kategori → jumlah), label & nilai di teks, bukan warna. */
export function HBarList(props: {
  rows: { label: string; value: number }[];
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...props.rows.map((r) => r.value));
  const format = props.format ?? ((v: number) => String(v));
  return (
    <div className="viz hbar">
      {props.rows.map((r, i) => (
        <div key={i} style={{ display: "contents" }} title={`${r.label}: ${format(r.value)}`}>
          <span>{r.label}</span>
          <div className="track">
            <div className="fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <strong>{format(r.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function niceMax(v: number) {
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * exp;
}

/** Batang dengan sudut atas membulat dan dasar rata di garis nol. */
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
