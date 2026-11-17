"use client";

import Link from "next/link";
import { EQUIPMENT_STATE_LABEL } from "@erp/shared";
import { useCallback, useEffect, useState } from "react";
import { DataTable } from "../../../../components/data-table";
import { toast } from "../../../../components/feedback";
import { StateBadge } from "../../../../components/maintenance/maintenance-panels";
import { api } from "../../../../lib/api";
import { money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { DatasetDrillPanel, type DatasetDrillRequest } from "../../../../components/drilldown-panel";

interface Row {
  equipmentId: string;
  code: string;
  name: string;
  category: string | null;
  state: string;
  failures: number;
  downtimeHours: number;
  mtbf: number | null;
  mttr: number | null;
  availability: number | null;
  preventiveDue: number;
  preventiveOnTime: number;
  compliance: number | null;
  partsCost: string;
  vendorCost: string;
  laborCost: string;
  totalCost: string;
}
interface Report {
  rows: Row[];
  totals: {
    failures: number;
    downtimeHours: number;
    preventiveDue: number;
    preventiveOnTime: number;
    totalCost: string;
  };
}

const firstOfYear = () => `${today().slice(0, 4)}-01-01`;

/** Maintenance › Laporan: keandalan (MTBF, MTTR, ketersediaan), kepatuhan preventif, biaya per peralatan. */
export default function MaintenanceReportsPage() {
  const { l, locale } = useI18n();
  const i = locale === "id" ? 0 : 1;
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo] = useState(today());
  const [data, setData] = useState<Report | null>(null);
  const load = useCallback(() => {
    api<Report>(`/maintenance/reports?from=${from}&to=${to}`)
      .then(setData)
      .catch((e: Error) => toast.error(e.message));
  }, [from, to]);
  useEffect(load, [load]);
  const num = (v: number | null, suffix = "") => (v === null ? "—" : `${v.toLocaleString(locale)}${suffix}`);

  const [drill, setDrill] = useState<DatasetDrillRequest | null>(null);
  /** Permintaan perawatan penyusun angka satu peralatan (syarat tanggal sama dengan laporan). */
  const open = (r: Row, title: string, match: Record<string, string>, conditions: object[]) =>
    setDrill({
      title: `${r.code} ${r.name} · ${title}`,
      body: {
        dataset: "maintenance_requests",
        config: { conditions },
        match: { _equipmentId: r.equipmentId, ...match },
      },
    });
  const between = (column: string) => [
    { column, op: "gte", value: from },
    { column, op: "lte", value: to },
  ];
  const drillButton = (text: string, onClick: () => void) => (
    <button type="button" className="link drill" onClick={onClick}>
      {text}
    </button>
  );
  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <h1>{l("Keandalan & Biaya Perawatan", "Maintenance Reliability & Cost")}</h1>
        </div>
        <div className="cp-right">
          <label>
            {l("Dari", "From")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            {l("Sampai", "To")} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </header>
      {data && (
        <>
          <div className="cards">
            <div className="card">
              <span>{l("Kerusakan", "Breakdowns")}</span>
              <strong>{data.totals.failures}</strong>
            </div>
            <div className="card">
              <span>{l("Total downtime", "Total downtime")}</span>
              <strong>{num(data.totals.downtimeHours, l(" jam", " h"))}</strong>
            </div>
            <div className="card">
              <span>{l("Preventif tepat waktu", "Preventive on time")}</span>
              <strong>
                {data.totals.preventiveOnTime}/{data.totals.preventiveDue}
              </strong>
            </div>
            <div className="card">
              <span>{l("Biaya perawatan", "Maintenance cost")}</span>
              <strong>{money(data.totals.totalCost, locale)}</strong>
            </div>
          </div>
          <p className="muted">
            {l(
              "MTBF = waktu operasi ÷ jumlah kerusakan; MTTR = downtime ÷ jumlah kerusakan; ketersediaan = waktu operasi ÷ jam kalender periode. Hanya kerusakan (korektif) yang dihitung.",
              "MTBF = uptime ÷ breakdowns; MTTR = downtime ÷ breakdowns; availability = uptime ÷ calendar hours in the period. Only breakdowns (corrective) count.",
            )}
          </p>
          <DataTable
            rows={data.rows}
            storageKey="maintenance-report"
            rowKey={(r) => r.equipmentId}
            rowHref={(r) => `/equipment/${r.equipmentId}`}
            empty={l("Belum ada peralatan.", "No equipment yet.")}
            columns={[
              {
                key: "code",
                label: l("Peralatan", "Equipment"),
                value: (r) => `${r.code} ${r.name}`,
                render: (r) => (
                  <Link href={`/equipment/${r.equipmentId}`}>
                    {r.code} — {r.name}
                  </Link>
                ),
              },
              {
                key: "state",
                label: l("Status", "Status"),
                type: "enum",
                value: (r) => r.state,
                optionLabel: (v) => EQUIPMENT_STATE_LABEL[v]?.[i] ?? v,
                render: (r) => <StateBadge state={r.state} />,
              },
              {
                key: "failures",
                label: l("Kerusakan", "Breakdowns"),
                type: "number",
                value: (r) => r.failures,
                render: (r) =>
                  r.failures
                    ? drillButton(String(r.failures), () =>
                        open(r, l("Kerusakan", "Breakdowns"), { _kind: "corrective" }, between("breakdown")),
                      )
                    : r.failures,
              },
              {
                key: "downtime",
                label: l("Downtime (jam)", "Downtime (h)"),
                type: "number",
                value: (r) => r.downtimeHours,
              },
              {
                key: "mtbf",
                label: l("MTBF (jam)", "MTBF (h)"),
                type: "number",
                value: (r) => r.mtbf,
                text: (r) => num(r.mtbf),
              },
              {
                key: "mttr",
                label: l("MTTR (jam)", "MTTR (h)"),
                type: "number",
                value: (r) => r.mttr,
                text: (r) => num(r.mttr),
              },
              {
                key: "availability",
                label: l("Ketersediaan", "Availability"),
                type: "number",
                value: (r) => r.availability,
                text: (r) => num(r.availability, "%"),
              },
              {
                key: "compliance",
                label: l("Kepatuhan preventif", "Preventive compliance"),
                type: "number",
                value: (r) => r.compliance,
                text: (r) =>
                  r.preventiveDue ? `${r.preventiveOnTime}/${r.preventiveDue} (${r.compliance}%)` : "—",
                render: (r) =>
                  r.preventiveDue
                    ? drillButton(`${r.preventiveOnTime}/${r.preventiveDue} (${r.compliance}%)`, () =>
                        open(
                          r,
                          l("Preventif jatuh tempo", "Preventive due"),
                          { _kind: "preventive" },
                          between("scheduled"),
                        ),
                      )
                    : "—",
              },
              {
                key: "totalCost",
                label: l("Biaya", "Cost"),
                type: "number",
                value: (r) => Number(r.totalCost),
                text: (r) => money(r.totalCost, locale),
                render: (r) =>
                  Number(r.totalCost)
                    ? drillButton(money(r.totalCost, locale), () =>
                        open(r, l("Biaya", "Cost"), { _done: "1" }, between("finished")),
                      )
                    : money(r.totalCost, locale),
              },
            ]}
          />
        </>
      )}
      <DatasetDrillPanel request={drill} onClose={() => setDrill(null)} />
    </>
  );
}
