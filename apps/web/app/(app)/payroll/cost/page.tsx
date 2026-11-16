"use client";

import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { DatasetDrillPanel, type DatasetDrillRequest } from "../../../../components/drilldown-panel";

type Totals = Record<"earnings" | "kesEmployer" | "tkEmployer" | "cost" | "pph21" | "net", string>;
interface Report {
  items: ({ key: string | null; employees: number } & Totals)[];
  totals: Totals;
}

/**
 * Biaya tenaga kerja dari payroll terposting: pendapatan + iuran perusahaan BPJS Kesehatan + BPJS Ketenagakerjaan
 * (kolom terpisah) per departemen, cabang, atau bulan.
 */
export default function PayrollCostPage() {
  const { l, locale } = useI18n();
  const year = today().slice(0, 4);
  const [from, setFrom] = useState(`${year}-01`);
  const [to, setTo] = useState(today().slice(0, 7));
  const [groupBy, setGroupBy] = useState("department");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<DatasetDrillRequest | null>(null);

  useEffect(() => {
    setError(null);
    api<Report>(`/payroll/reports/cost?${new URLSearchParams({ from, to, groupBy })}`)
      .then(setReport)
      .catch((e: Error) => setError(e.message));
  }, [from, to, groupBy]);
  const n = (v: string) => money(v, locale);
  const none =
    groupBy === "branch" ? l("(tanpa cabang)", "(no branch)") : l("(tanpa departemen)", "(no department)");

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Biaya Tenaga Kerja", "Labour Cost")}</h1>
        <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
          <option value="department">{l("Per departemen", "By department")}</option>
          <option value="branch">{l("Per cabang", "By branch")}</option>
          <option value="month">{l("Per bulan", "By month")}</option>
        </select>
        <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="month" value={to} onChange={(e) => setTo(e.target.value)} />
      </header>
      {error && <p className="error">{error}</p>}
      {report && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  {groupBy === "month"
                    ? l("Bulan", "Month")
                    : groupBy === "branch"
                      ? l("Cabang", "Branch")
                      : l("Departemen", "Department")}
                </th>
                <th className="num">{l("Karyawan", "Employees")}</th>
                <th className="num">{l("Pendapatan", "Earnings")}</th>
                <th className="num">{l("BPJS Kesehatan (perusahaan)", "BPJS Health (employer)")}</th>
                <th className="num">
                  {l("BPJS Ketenagakerjaan (perusahaan)", "BPJS Employment (employer)")}
                </th>
                <th className="num">{l("Total biaya", "Total cost")}</th>
                <th className="num">PPh 21</th>
                <th className="num">{l("Gaji bersih", "Net pay")}</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((r) => (
                <tr key={r.key ?? ""}>
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        setDrill({
                          title: r.key ?? none,
                          body: {
                            dataset: "payslips_history",
                            filters: { from: `${from}-01`, to: `${to}-01` },
                            match:
                              groupBy === "department"
                                ? { department: r.key ?? "" }
                                : groupBy === "branch"
                                  ? { _branch: r.key ?? "" }
                                  : { month: r.key ?? "" },
                          },
                        })
                      }
                    >
                      {r.key ?? none}
                    </button>
                  </td>
                  <td className="num">{r.employees}</td>
                  <td className="num">{n(r.earnings)}</td>
                  <td className="num">{n(r.kesEmployer)}</td>
                  <td className="num">{n(r.tkEmployer)}</td>
                  <td className="num">
                    <strong>{n(r.cost)}</strong>
                  </td>
                  <td className="num">{n(r.pph21)}</td>
                  <td className="num">{n(r.net)}</td>
                </tr>
              ))}
              {report.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    {l("Belum ada payroll terposting pada periode ini.", "No posted payroll in this period.")}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th>{l("Total", "Total")}</th>
                <th />
                <th className="num">{n(report.totals.earnings)}</th>
                <th className="num">{n(report.totals.kesEmployer)}</th>
                <th className="num">{n(report.totals.tkEmployer)}</th>
                <th className="num">{n(report.totals.cost)}</th>
                <th className="num">{n(report.totals.pph21)}</th>
                <th className="num">{n(report.totals.net)}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <DatasetDrillPanel request={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
