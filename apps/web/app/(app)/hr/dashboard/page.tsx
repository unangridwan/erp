"use client";

import { useEffect, useState } from "react";
import { BarChart, HBarList } from "../../../../components/hr/charts";
import { errorText } from "../../../../components/hr/hr-panels";
import { api } from "../../../../lib/api";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Dashboard {
  year: number;
  headcount: number;
  byDepartment: { key: string | null; count: number }[];
  byGender: { key: string | null; count: number }[];
  joins: number;
  leavers: number;
  turnover: number;
  ratings: { rating: string | null; count: number }[];
  trainingCost: string;
  months: {
    month: string;
    headcount: number;
    joins: number;
    leaves: number;
    leaveDays: number;
    overtimeHours: number;
    labourCost: string;
  }[];
}

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Dashboard HR: headcount, masuk/keluar, turnover, cuti & lembur, biaya tenaga kerja, sebaran kinerja. */
export default function HrDashboardPage() {
  const { l, locale } = useI18n();
  const [year, setYear] = useState(new Date().getFullYear());
  const [d, setD] = useState<Dashboard | null>(null);
  const [table, setTable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Dashboard>(`/hr/dashboard?year=${year}`).then(setD, (e) => setError(errorText(e)));
  }, [year]);
  const labels = locale === "id" ? MONTHS_ID : MONTHS_EN;
  const compact = (v: number) =>
    new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);

  return (
    <div className="stack-wide">
      <section className="panel">
        <header className="toolbar">
          <h1>{l("Dashboard SDM", "HR Dashboard")}</h1>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label={l("Tahun", "Year")}
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={table} onChange={(e) => setTable(e.target.checked)} />
            {l("Tampilkan tabel", "Show table")}
          </label>
        </header>
        {error && <p className="error">{error}</p>}
        {d && (
          <ul className="grid">
            {(
              [
                [l("Karyawan aktif", "Active employees"), String(d.headcount)],
                [l(`Masuk ${d.year}`, `Joined ${d.year}`), String(d.joins)],
                [l(`Keluar ${d.year}`, `Left ${d.year}`), String(d.leavers)],
                [
                  l("Turnover", "Turnover"),
                  `${d.turnover.toLocaleString(locale === "id" ? "id-ID" : "en-US")}%`,
                ],
                [l("Biaya pelatihan", "Training cost"), money(d.trainingCost, locale)],
              ] as const
            ).map(([label, value]) => (
              <li key={label} className="card">
                <span>{label}</span>
                <strong>{value}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
      {d && !table && (
        <>
          <section className="panel">
            <h2>{l("Headcount akhir bulan", "Month-end headcount")}</h2>
            <BarChart
              ariaLabel={l("Headcount per bulan", "Headcount by month")}
              labels={labels}
              series={[
                {
                  key: "hc",
                  label: l("Karyawan", "Employees"),
                  slot: 1,
                  values: d.months.map((m) => m.headcount),
                },
              ]}
            />
          </section>
          <section className="panel">
            <h2>{l("Karyawan masuk & keluar", "Joiners & leavers")}</h2>
            <BarChart
              ariaLabel={l("Karyawan masuk dan keluar per bulan", "Joiners and leavers by month")}
              labels={labels}
              series={[
                { key: "in", label: l("Masuk", "Joined"), slot: 1, values: d.months.map((m) => m.joins) },
                { key: "out", label: l("Keluar", "Left"), slot: 2, values: d.months.map((m) => m.leaves) },
              ]}
            />
          </section>
          <section className="panel">
            <h2>{l("Biaya tenaga kerja (gaji + BPJS perusahaan)", "Labour cost (pay + employer BPJS)")}</h2>
            <BarChart
              ariaLabel={l("Biaya tenaga kerja per bulan", "Labour cost by month")}
              empty={l("Belum ada payroll terposting tahun ini.", "No posted payroll this year.")}
              labels={labels}
              format={compact}
              series={[
                {
                  key: "cost",
                  label: l("Biaya", "Cost"),
                  slot: 1,
                  values: d.months.map((m) => Number(m.labourCost)),
                },
              ]}
            />
          </section>
          <section className="panel">
            <h2>{l("Cuti terpakai (hari)", "Leave taken (days)")}</h2>
            <BarChart
              ariaLabel={l("Hari cuti per bulan", "Leave days by month")}
              empty={l("Belum ada cuti disetujui tahun ini.", "No approved leave this year.")}
              labels={labels}
              series={[
                {
                  key: "leave",
                  label: l("Hari cuti", "Leave days"),
                  slot: 1,
                  values: d.months.map((m) => m.leaveDays),
                },
              ]}
            />
          </section>
          <div className="grid-2">
            <section className="panel">
              <h2>{l("Karyawan per departemen", "Employees by department")}</h2>
              <HBarList
                rows={d.byDepartment.map((x) => ({
                  label: x.key ?? l("(tanpa departemen)", "(none)"),
                  value: x.count,
                }))}
              />
            </section>
            <section className="panel">
              <h2>{l("Sebaran predikat kinerja", "Performance ratings")}</h2>
              {d.ratings.length ? (
                <HBarList rows={d.ratings.map((x) => ({ label: x.rating ?? "—", value: x.count }))} />
              ) : (
                <p className="muted">
                  {l("Belum ada penilaian selesai tahun ini.", "No completed appraisals this year.")}
                </p>
              )}
            </section>
          </div>
        </>
      )}
      {d && table && (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Bulan", "Month")}</th>
                  <th className="num">Headcount</th>
                  <th className="num">{l("Masuk", "Joined")}</th>
                  <th className="num">{l("Keluar", "Left")}</th>
                  <th className="num">{l("Hari cuti", "Leave days")}</th>
                  <th className="num">{l("Jam lembur", "Overtime h")}</th>
                  <th className="num">{l("Biaya tenaga kerja", "Labour cost")}</th>
                </tr>
              </thead>
              <tbody>
                {d.months.map((m, i) => (
                  <tr key={m.month}>
                    <td>
                      {labels[i]} {d.year}
                    </td>
                    <td className="num">{m.headcount}</td>
                    <td className="num">{m.joins}</td>
                    <td className="num">{m.leaves}</td>
                    <td className="num">{m.leaveDays}</td>
                    <td className="num">{m.overtimeHours}</td>
                    <td className="num">{money(m.labourCost, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
