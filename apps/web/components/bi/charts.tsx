"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from "react";

/** Grafik BI multi-seri (SVG): kolom/batang berkelompok & bertumpuk, garis, area, pai/donat. */

export interface ChartCategory {
  key: string;
  label: string;
}
export interface ChartSeries {
  id: string;
  label: string;
  values: (number | null)[];
}
export interface ChartProps {
  categories: ChartCategory[];
  series: ChartSeries[];
  format: (v: number | null) => string;
  /** Label sumbu nilai (ringkas). */
  formatAxis?: (v: number) => string;
  ariaLabel: string;
  dataLabels?: boolean;
  showLegend?: boolean;
  /** Kunci kategori yang disorot (filter silang); lainnya diredupkan. */
  highlight?: string[];
  onSelect?: (categoryIndex: number, seriesIndex: number, e: MouseEvent) => void;
}

const color = (i: number) => `var(--series-${(i % 6) + 1})`;

/** Ukuran elemen pembungkus (lebar & tinggi), mengikuti perubahan ukuran visual di kanvas. */
export function useBoxSize<T extends HTMLElement>(minW = 120, minH = 80) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 480, h: 220 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry!.contentRect;
      setSize({ w: Math.max(minW, Math.round(r.width)), h: Math.max(minH, Math.round(r.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [minW, minH]);
  return { ref, ...size };
}

function niceStep(range: number, count: number) {
  if (range <= 0) return 1;
  const raw = range / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= raw) ?? raw;
}

function ticks(min: number, max: number, count = 4) {
  const step = niceStep(max - min || Math.abs(max) || 1, count);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step || step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s);

function Legend({ series }: { series: { label: string }[] }) {
  return (
    <div className="legend wrap">
      {series.map((s, i) => (
        <span key={i}>
          <i style={{ background: color(i) }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({
  x,
  y,
  title,
  rows,
}: {
  x: number;
  y: number;
  title: string;
  rows: { label: string; value: string; i: number }[];
}) {
  return (
    <div className="viz-tip" style={{ left: x, top: Math.max(0, y) }}>
      <strong>{title}</strong>
      {rows.map((r) => (
        <div key={r.i}>
          <span className="dot" style={{ background: color(r.i) }} />
          {r.label}: {r.value}
        </div>
      ))}
    </div>
  );
}

/** Kolom (vertikal), batang (horizontal), garis, area — berkelompok atau bertumpuk (opsional 100%). */
export function AxisChart(
  props: ChartProps & { kind: "column" | "bar" | "line" | "area"; stacked?: boolean; percent?: boolean },
) {
  const { kind, categories, series } = props;
  const legend = props.showLegend ?? series.length > 1;
  const box = useBoxSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const horizontal = kind === "bar";
  const stacked = !!props.stacked || !!props.percent;
  const n = categories.length;
  const fmtAxis = props.formatAxis ?? ((v: number) => props.format(v));

  // Nilai per kategori (100% = dinormalkan per kategori).
  const values = series.map((s) =>
    s.values.map((v, ci) => {
      if (!props.percent) return v;
      const total = series.reduce((sum, x) => sum + Math.abs(x.values[ci] ?? 0), 0);
      return v === null || !total ? null : (Math.abs(v) / total) * 100;
    }),
  );
  let min = 0;
  let max = 0;
  for (let ci = 0; ci < n; ci++) {
    if (stacked) {
      let pos = 0;
      let neg = 0;
      for (const s of values) {
        const v = s[ci] ?? 0;
        if (v >= 0) pos += v;
        else neg += v;
      }
      max = Math.max(max, pos);
      min = Math.min(min, neg);
    } else
      for (const s of values) {
        const v = s[ci];
        if (v === null || v === undefined) continue;
        max = Math.max(max, v);
        min = Math.min(min, v);
      }
  }
  if (props.percent) max = 100;
  const tickVals = ticks(min, max);
  const lo = tickVals[0]!;
  const hi = tickVals[tickVals.length - 1]!;

  const longest = Math.max(4, ...categories.map((c) => c.label.length));
  const w = box.w;
  const h = Math.max(120, box.h - (legend ? 24 : 0));
  const pad = horizontal
    ? { top: 6, right: 16, bottom: 22, left: Math.min(Math.round(w * 0.38), 12 + longest * 6.6) }
    : { top: 10, right: 12, bottom: 24, left: 8 + Math.max(...tickVals.map((t) => fmtAxis(t).length)) * 7 };
  const plotW = Math.max(10, w - pad.left - pad.right);
  const plotH = Math.max(10, h - pad.top - pad.bottom);
  const span = hi - lo || 1;
  // Skala nilai (vertikal untuk kolom/garis, horizontal untuk batang).
  const vy = (v: number) => pad.top + plotH - ((v - lo) / span) * plotH;
  const vx = (v: number) => pad.left + ((v - lo) / span) * plotW;
  const band = (horizontal ? plotH : plotW) / Math.max(1, n);
  const inner = band * (kind === "column" || kind === "bar" ? 0.72 : 1);
  const catStart = (ci: number) => (horizontal ? pad.top : pad.left) + ci * band + (band - inner) / 2;
  const catCenter = (ci: number) => (horizontal ? pad.top : pad.left) + ci * band + band / 2;
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(horizontal ? plotH / 16 : plotW / 64))));
  const highlight = props.highlight ? new Set(props.highlight) : null;
  const dim = (ci: number) => (highlight && !highlight.has(categories[ci]!.key) ? 0.35 : 1);
  const select = (ci: number, si: number) =>
    props.onSelect ? (e: MouseEvent) => props.onSelect!(ci, si, e) : undefined;

  const bars: ReactElement[] = [];
  const labels: ReactElement[] = [];
  if (kind === "column" || kind === "bar") {
    const bw = stacked ? inner : inner / Math.max(1, series.length);
    for (let ci = 0; ci < n; ci++) {
      let pos = 0;
      let neg = 0;
      values.forEach((s, si) => {
        const v = s[ci];
        if (v === null || v === undefined) return;
        let a: number;
        let b: number;
        if (stacked) {
          if (v >= 0) {
            a = pos;
            b = pos += v;
          } else {
            a = neg;
            b = neg += v;
          }
        } else {
          a = 0;
          b = v;
        }
        const offset = catStart(ci) + (stacked ? 0 : si * bw);
        const rect = horizontal
          ? { x: vx(Math.min(a, b)), y: offset, width: Math.abs(vx(b) - vx(a)), height: Math.max(1, bw - 1) }
          : { x: offset, y: vy(Math.max(a, b)), width: Math.max(1, bw - 1), height: Math.abs(vy(a) - vy(b)) };
        bars.push(
          <rect
            key={`${ci}-${si}`}
            {...rect}
            rx={2}
            fill={color(si)}
            opacity={dim(ci)}
            onClick={select(ci, si)}
            style={props.onSelect ? { cursor: "pointer" } : undefined}
          >
            <title>{`${categories[ci]!.label} · ${series[si]!.label}: ${props.format(series[si]!.values[ci] ?? null)}`}</title>
          </rect>,
        );
        if (props.dataLabels && (horizontal ? rect.height >= 11 : rect.width >= 18)) {
          const text = props.percent ? `${Math.round(v)}%` : fmtAxis(series[si]!.values[ci] ?? 0);
          labels.push(
            horizontal ? (
              <text
                key={`l${ci}-${si}`}
                x={stacked ? rect.x + rect.width / 2 : rect.x + rect.width + 4}
                y={rect.y + rect.height / 2 + 4}
                textAnchor={stacked ? "middle" : "start"}
                className="data-label"
              >
                {text}
              </text>
            ) : (
              <text
                key={`l${ci}-${si}`}
                x={rect.x + rect.width / 2}
                y={stacked ? rect.y + rect.height / 2 + 4 : rect.y - 4}
                textAnchor="middle"
                className="data-label"
              >
                {text}
              </text>
            ),
          );
        }
      });
    }
  } else {
    // Garis / area: titik di tengah pita kategori; area bertumpuk mengakumulasi.
    const acc = new Array<number>(n).fill(0);
    values.forEach((s, si) => {
      const pts = s.map((v, ci) => {
        if (v === null || v === undefined) return null;
        const base = stacked ? acc[ci]! : 0;
        const top = base + v;
        if (stacked) acc[ci] = top;
        return { x: catCenter(ci), y: vy(top), y0: vy(base), ci, v };
      });
      const segments: { x: number; y: number; y0: number; ci: number; v: number }[][] = [];
      let cur: { x: number; y: number; y0: number; ci: number; v: number }[] = [];
      for (const p of pts) {
        if (p) cur.push(p);
        else if (cur.length) {
          segments.push(cur);
          cur = [];
        }
      }
      if (cur.length) segments.push(cur);
      segments.forEach((seg, k) => {
        const line = seg.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
        if (kind === "area") {
          const back = [...seg]
            .reverse()
            .map((p) => `L${p.x},${p.y0}`)
            .join(" ");
          bars.push(
            <path
              key={`a${si}-${k}`}
              d={`${line} ${back} Z`}
              fill={color(si)}
              opacity={stacked ? 0.55 : 0.18}
            />,
          );
        }
        bars.push(
          <path
            key={`p${si}-${k}`}
            d={line}
            fill="none"
            stroke={color(si)}
            strokeWidth={2}
            strokeLinejoin="round"
          />,
        );
      });
      for (const p of pts) {
        if (!p) continue;
        bars.push(
          <circle
            key={`c${si}-${p.ci}`}
            cx={p.x}
            cy={p.y}
            r={hover === p.ci ? 5 : n > 40 ? 2 : 3.5}
            fill={color(si)}
            stroke="var(--card)"
            strokeWidth={1.5}
            opacity={dim(p.ci)}
          />,
        );
        if (props.dataLabels && n <= 24)
          labels.push(
            <text key={`l${si}-${p.ci}`} x={p.x} y={p.y - 8} textAnchor="middle" className="data-label">
              {props.percent ? `${Math.round(p.v)}%` : fmtAxis(series[si]!.values[p.ci] ?? 0)}
            </text>,
          );
      }
    });
  }

  const tipX = hover === null ? 0 : horizontal ? pad.left + plotW / 2 : catCenter(hover);
  const tipY = hover === null ? 0 : horizontal ? catCenter(hover) + 12 : pad.top;

  return (
    <div className="viz bi-chart" ref={box.ref}>
      {legend && <Legend series={series} />}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        role="img"
        aria-label={props.ariaLabel}
        onMouseLeave={() => setHover(null)}
      >
        {tickVals.map((t) =>
          horizontal ? (
            <g key={t}>
              <line x1={vx(t)} x2={vx(t)} y1={pad.top} y2={pad.top + plotH} stroke="var(--grid)" />
              <text x={vx(t)} y={h - 6} textAnchor="middle">
                {props.percent ? `${t}%` : fmtAxis(t)}
              </text>
            </g>
          ) : (
            <g key={t}>
              <line x1={pad.left} x2={w - pad.right} y1={vy(t)} y2={vy(t)} stroke="var(--grid)" />
              <text x={pad.left - 6} y={vy(t) + 4} textAnchor="end">
                {props.percent ? `${t}%` : fmtAxis(t)}
              </text>
            </g>
          ),
        )}
        {hover !== null &&
          (horizontal ? (
            <rect
              x={pad.left}
              y={pad.top + hover * band}
              width={plotW}
              height={band}
              fill="var(--grid)"
              opacity={0.35}
            />
          ) : (
            <rect
              x={pad.left + hover * band}
              y={pad.top}
              width={band}
              height={plotH}
              fill="var(--grid)"
              opacity={0.35}
            />
          ))}
        {categories.map((c, ci) =>
          ci % every === 0 ? (
            horizontal ? (
              <text key={`x${ci}`} x={pad.left - 6} y={catCenter(ci) + 4} textAnchor="end">
                <title>{c.label}</title>
                {truncate(c.label, Math.max(4, Math.floor((pad.left - 10) / 6.6)))}
              </text>
            ) : (
              <text key={`x${ci}`} x={catCenter(ci)} y={h - 6} textAnchor="middle">
                <title>{c.label}</title>
                {truncate(c.label, Math.max(3, Math.floor((band * every - 6) / 7)))}
              </text>
            )
          ) : null,
        )}
        {bars}
        {labels}
        {/* Area hover/klik per kategori. */}
        {categories.map((_, ci) =>
          horizontal ? (
            <rect
              key={`h${ci}`}
              x={pad.left}
              y={pad.top + ci * band}
              width={plotW}
              height={band}
              fill="transparent"
              onMouseEnter={() => setHover(ci)}
              onClick={kind === "bar" ? undefined : select(ci, 0)}
              style={{ pointerEvents: kind === "bar" ? "none" : "all" }}
            />
          ) : (
            <rect
              key={`h${ci}`}
              x={pad.left + ci * band}
              y={pad.top}
              width={band}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(ci)}
              onClick={kind === "column" ? undefined : select(ci, 0)}
              style={{
                pointerEvents: kind === "column" ? "none" : "all",
                cursor: props.onSelect && kind !== "column" ? "pointer" : undefined,
              }}
            />
          ),
        )}
        {/* Kolom/batang: hover per kategori lewat pita tipis di sumbu agar klik tetap mengenai batang. */}
        {(kind === "column" || kind === "bar") &&
          categories.map((_, ci) => (
            <rect
              key={`hb${ci}`}
              {...(horizontal
                ? { x: 0, y: pad.top + ci * band, width: pad.left, height: band }
                : { x: pad.left + ci * band, y: pad.top + plotH, width: band, height: pad.bottom })}
              fill="transparent"
              onMouseEnter={() => setHover(ci)}
            />
          ))}
      </svg>
      {hover !== null && (
        <Tooltip
          // Dijepit agar tooltip di tepi kiri/kanan tidak terpotong.
          x={Math.min(Math.max(tipX, 90), w - 90)}
          y={tipY + (legend ? 24 : 0)}
          title={categories[hover]!.label}
          rows={series.map((s, i) => ({ label: s.label, value: props.format(s.values[hover] ?? null), i }))}
        />
      )}
    </div>
  );
}

/** Pai/donat: maks. 6 irisan + "Lainnya", persentase di legenda. */
export function PieChart(props: ChartProps & { donut?: boolean; otherLabel: string }) {
  const box = useBoxSize<HTMLDivElement>(120, 120);
  const [hover, setHover] = useState<number | null>(null);
  const first = props.series[0];
  const items = props.categories.map((c, i) => ({
    label: c.label,
    key: c.key,
    value: Math.max(0, first?.values[i] ?? 0),
    index: i as number | null,
  }));
  items.sort((a, b) => b.value - a.value);
  const SLOTS = 6;
  const head = items.slice(0, SLOTS - (items.length > SLOTS ? 1 : 0));
  const rest = items.slice(head.length);
  const slices = rest.length
    ? [
        ...head,
        { label: props.otherLabel, key: "", value: rest.reduce((s, r) => s + r.value, 0), index: null },
      ]
    : head;
  const total = slices.reduce((s, r) => s + r.value, 0) || 1;
  const size = Math.max(100, Math.min(box.w * 0.55, box.h - 8));
  const r = size / 2 - 2;
  const innerR = props.donut ? r * 0.62 : 0;
  const c = size / 2;
  const highlight = props.highlight ? new Set(props.highlight) : null;
  let angle = -Math.PI / 2;
  const pct = (v: number) => `${Math.round((v / total) * 1000) / 10}%`;
  const arc = (a0: number, a1: number) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => [c + rad * Math.cos(a), c + rad * Math.sin(a)];
    const [x0, y0] = p(r, a0);
    const [x1, y1] = p(r, a1);
    if (!innerR) return `M${c},${c} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`;
    const [x2, y2] = p(innerR, a1);
    const [x3, y3] = p(innerR, a0);
    return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${innerR},${innerR} 0 ${large} 0 ${x3},${y3} Z`;
  };
  return (
    <div className="viz pie bi-chart" ref={box.ref}>
      <div className="legend wrap">
        {slices.map((s, i) => (
          <span key={i}>
            <i style={{ background: color(i) }} />
            {s.label} · {pct(s.value)}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={props.ariaLabel}>
        {slices.map((s, i) => {
          const a0 = angle;
          const a1 = angle + (s.value / total) * Math.PI * 2;
          angle = a1;
          const full = s.value >= total - 1e-9;
          const d = full
            ? `M${c - r},${c} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0` +
              (innerR
                ? ` M${c - innerR},${c} a${innerR},${innerR} 0 1,0 ${2 * innerR},0 a${innerR},${innerR} 0 1,0 ${-2 * innerR},0`
                : "")
            : arc(a0, a1);
          const dimmed = highlight && (s.index === null || !highlight.has(s.key));
          return (
            <path
              key={i}
              d={d}
              fillRule="evenodd"
              fill={color(i)}
              stroke="var(--card)"
              strokeWidth={2}
              opacity={dimmed ? 0.35 : hover === null || hover === i ? 1 : 0.6}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={
                props.onSelect && s.index !== null ? (e) => props.onSelect!(s.index!, 0, e) : undefined
              }
              style={props.onSelect && s.index !== null ? { cursor: "pointer" } : undefined}
            >
              <title>
                {s.label}: {props.format(s.value)} ({pct(s.value)})
              </title>
            </path>
          );
        })}
        {props.donut && (
          <text x={c} y={c + 5} textAnchor="middle" className="pie-total">
            {(props.formatAxis ?? props.format)(hover === null ? total : slices[hover]!.value)}
          </text>
        )}
      </svg>
    </div>
  );
}
