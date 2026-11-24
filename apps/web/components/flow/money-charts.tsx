"use client";

import { useI18n } from "../../lib/i18n";

export interface SankeyNode {
  key: string;
  label: string;
  amount: number;
}

/**
 * Diagram arus (sankey) sederhana: sumber kas masuk (kiri) → Kas & Bank (tengah) → penggunaan (kanan). Tebal pita
 * sebanding nilainya. Selisih masuk/keluar ditampilkan sebagai "kenaikan/penurunan saldo kas" agar seimbang.
 */
export function CashSankey({
  inflows,
  outflows,
  format,
}: {
  inflows: SankeyNode[];
  outflows: SankeyNode[];
  format: (v: number) => string;
}) {
  const { l } = useI18n();
  const totalIn = inflows.reduce((s, x) => s + x.amount, 0);
  const totalOut = outflows.reduce((s, x) => s + x.amount, 0);
  const left = [...inflows];
  const right = [...outflows];
  if (totalIn > totalOut)
    right.push({ key: "__up", label: l("Kenaikan saldo kas", "Cash increase"), amount: totalIn - totalOut });
  if (totalOut > totalIn)
    left.push({ key: "__down", label: l("Dari saldo kas", "From cash balance"), amount: totalOut - totalIn });
  const total = Math.max(totalIn, totalOut);
  if (!total)
    return (
      <p className="muted">{l("Tidak ada arus kas di periode ini.", "No cash flows in this period.")}</p>
    );

  const W = 760;
  const gap = 6;
  // Tiap simpul mendapat slot minimal setinggi dua baris label; tebal pita tetap sebanding nilainya.
  const minSlot = 30;
  const top = 26;
  const scale = 300 / total;
  const nodeW = 14;
  const xL = 190;
  const xC = W / 2 - nodeW / 2;
  const xR = W - 190 - nodeW;
  const slotsOf = (list: SankeyNode[]) => list.map((n) => Math.max(minSlot, n.amount * scale));
  const usedOf = (slots: number[]) => slots.reduce((s, h) => s + h, 0) + gap * Math.max(0, slots.length - 1);
  const slotsL = slotsOf(left);
  const slotsR = slotsOf(right);
  const centerH = total * scale;
  const inner = Math.max(centerH, usedOf(slotsL), usedOf(slotsR));
  const H = top + inner + 4;
  const place = (list: SankeyNode[], slots: number[]) => {
    let y = top + (inner - usedOf(slots)) / 2;
    return list.map((n, i) => {
      const h = Math.max(2, n.amount * scale);
      const slot = slots[i]!;
      const out = { ...n, y: y + (slot - h) / 2, h, labelY: y + slot / 2 };
      y += slot + gap;
      return out;
    });
  };
  const L = place(left, slotsL);
  const R = place(right, slotsR);
  const centerY = top + (inner - centerH) / 2;
  const band = (x1: number, y1: number, x2: number, y2: number, h: number) => {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2} L${x2},${y2 + h} C${mx},${y2 + h} ${mx},${y1 + h} ${x1},${y1 + h} Z`;
  };
  let cy = centerY;
  let cyR = centerY;
  return (
    <svg
      className="cash-sankey"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={l("Diagram arus kas masuk dan keluar", "Cash inflow and outflow diagram")}
    >
      {L.map((n) => {
        const d = band(xL + nodeW, n.y, xC, cy, n.h);
        cy += n.h;
        return (
          <g key={n.key}>
            <path d={d} className={`sankey-band in${n.key === "__down" ? " neutral" : ""}`}>
              <title>{`${n.label}: ${format(n.amount)}`}</title>
            </path>
            <rect x={xL} y={n.y} width={nodeW} height={n.h} className="sankey-node in" />
            <text
              x={xL - 6}
              y={n.labelY - 6}
              textAnchor="end"
              dominantBaseline="middle"
              className="sankey-label"
            >
              {n.label}
              <tspan x={xL - 6} dy="1.2em" className="sankey-value">
                {format(n.amount)}
              </tspan>
            </text>
          </g>
        );
      })}
      {R.map((n) => {
        const d = band(xC + nodeW, cyR, xR, n.y, n.h);
        cyR += n.h;
        return (
          <g key={n.key}>
            <path d={d} className={`sankey-band out${n.key === "__up" ? " neutral" : ""}`}>
              <title>{`${n.label}: ${format(n.amount)}`}</title>
            </path>
            <rect x={xR} y={n.y} width={nodeW} height={n.h} className="sankey-node out" />
            <text x={xR + nodeW + 6} y={n.labelY - 6} dominantBaseline="middle" className="sankey-label">
              {n.label}
              <tspan x={xR + nodeW + 6} dy="1.2em" className="sankey-value">
                {format(n.amount)}
              </tspan>
            </text>
          </g>
        );
      })}
      <rect x={xC} y={centerY} width={nodeW} height={centerH} className="sankey-node cash" />
      <text
        x={xC + nodeW / 2}
        y={Math.max(12, centerY - 8)}
        textAnchor="middle"
        className="sankey-label strong"
      >
        {l("Kas & Bank", "Cash & Bank")}
      </text>
    </svg>
  );
}

/** Batang berpasangan per bulan (mis. kas masuk vs keluar), dengan garis nol untuk nilai negatif. */
export function PairBars({
  rows,
  series,
  format,
}: {
  rows: { label: string; values: (number | null)[] }[];
  series: { label: string; className: string }[];
  format: (v: number) => string;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => r.values.map((v) => Math.abs(v ?? 0))));
  return (
    <div className="pair-bars" role="table">
      <div className="pair-legend" aria-hidden="true">
        {series.map((s) => (
          <span key={s.label}>
            <i className={s.className} /> {s.label}
          </span>
        ))}
      </div>
      {rows.map((r) => (
        <div key={r.label} className="pair-row" role="row">
          <span className="pair-label" role="rowheader">
            {r.label}
          </span>
          <span className="pair-cells" role="cell">
            {r.values.map((v, i) => (
              <span
                key={i}
                className={`pair-bar ${series[i]!.className}`}
                style={{ width: `${(Math.abs(v ?? 0) / max) * 100}%` }}
                title={`${series[i]!.label}: ${v === null ? "—" : format(v)}`}
              />
            ))}
          </span>
          <span className="pair-values muted small" role="cell">
            {r.values.map((v) => (v === null ? "—" : format(v))).join(" / ")}
          </span>
        </div>
      ))}
    </div>
  );
}
