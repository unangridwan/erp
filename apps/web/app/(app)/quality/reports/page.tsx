"use client";

import { useCallback, useEffect, useState } from "react";
import { DataTable } from "../../../../components/data-table";
import { toast } from "../../../../components/feedback";
import { api } from "../../../../lib/api";
import { today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Group {
  id: string;
  name: string;
  checks: number;
  pending: number;
  passed: number;
  conditional: number;
  failed: number;
  failedQty: number;
  defectRate: number | null;
}
interface Report {
  totals: { checks: number; pending: number; passed: number; conditional: number; failed: number };
  bySupplier: Group[];
  byProduct: Group[];
}

/** Mutu › Laporan: tingkat cacat per pemasok & per produk. */
export default function QualityReportsPage() {
  const { l } = useI18n();
  const [from, setFrom] = useState(`${today().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today());
  const [data, setData] = useState<Report | null>(null);
  const load = useCallback(() => {
    api<Report>(`/quality/reports?from=${from}&to=${to}`).then(setData, (e: Error) => toast.error(e.message));
  }, [from, to]);
  useEffect(load, [load]);
  const columns = (who: string) => [
    { key: "name", label: who, value: (r: Group) => r.name },
    {
      key: "checks",
      label: l("Pemeriksaan", "Checks"),
      type: "number" as const,
      value: (r: Group) => r.checks,
    },
    { key: "passed", label: l("Lulus", "Passed"), type: "number" as const, value: (r: Group) => r.passed },
    {
      key: "conditional",
      label: l("Bersyarat", "Conditional"),
      type: "number" as const,
      value: (r: Group) => r.conditional,
    },
    { key: "failed", label: l("Gagal", "Failed"), type: "number" as const, value: (r: Group) => r.failed },
    {
      key: "pending",
      label: l("Menunggu", "Pending"),
      type: "number" as const,
      value: (r: Group) => r.pending,
    },
    {
      key: "defectRate",
      label: l("Tingkat cacat", "Defect rate"),
      type: "number" as const,
      value: (r: Group) => r.defectRate,
      text: (r: Group) => (r.defectRate === null ? "—" : `${r.defectRate}%`),
    },
  ];
  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <h1>{l("Laporan Mutu", "Quality Report")}</h1>
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
              <span>{l("Pemeriksaan", "Checks")}</span>
              <strong>{data.totals.checks}</strong>
            </div>
            <div className="card">
              <span>{l("Lulus", "Passed")}</span>
              <strong>{data.totals.passed}</strong>
            </div>
            <div className="card">
              <span>{l("Gagal / bersyarat", "Failed / conditional")}</span>
              <strong>
                {data.totals.failed} / {data.totals.conditional}
              </strong>
            </div>
            <div className="card">
              <span>{l("Menunggu", "Pending")}</span>
              <strong>{data.totals.pending}</strong>
            </div>
          </div>
          <p className="muted">
            {l(
              "Tingkat cacat = (gagal + diterima bersyarat) ÷ pemeriksaan yang sudah diputuskan.",
              "Defect rate = (failed + conditionally accepted) ÷ decided checks.",
            )}
          </p>
          <h2>{l("Per pemasok", "By supplier")}</h2>
          <DataTable
            rows={data.bySupplier}
            storageKey="quality-report-supplier"
            rowKey={(r) => r.id}
            empty={l("Belum ada data.", "No data yet.")}
            columns={columns(l("Pemasok", "Supplier"))}
          />
          <h2>{l("Per produk", "By product")}</h2>
          <DataTable
            rows={data.byProduct}
            storageKey="quality-report-product"
            rowKey={(r) => r.id}
            empty={l("Belum ada data.", "No data yet.")}
            columns={columns(l("Produk", "Product"))}
          />
        </>
      )}
    </>
  );
}
