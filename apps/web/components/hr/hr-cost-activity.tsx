"use client";

import { useEffect, useState } from "react";
import { BarChart, HBarList } from "./charts";
import { errorText } from "./hr-panels";
import { api } from "../../lib/api";
import { money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";

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
    bpjsKesCost: string;
    bpjsTkCost: string;
  }[];
}

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Tab "Biaya & aktivitas" di Dashboard & Analitik SDM: biaya tenaga kerja & pelatihan, cuti, lembur, sebaran kinerja.
 * Headcount, masuk/keluar & turnover ada di tab Analitik (tidak ditampilkan dua kali).
 */
export function HrCostActivity({ year }: { year: number }) {
  const { l, locale } = useI18n();
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
    <>
      <section className="panel">
        <label className="check">
          <input type="checkbox" checked={table} onChange={(e) => setTable(e.target.checked)} />
          {l("Tampilkan tabel per bulan", "Show monthly table")}
        </label>
        {error && <p className="error">{error}</p>}
        {d && (
          <ul className="grid">
            {(
              [
                [l("Biaya pelatihan", "Training cost"), money(d.trainingCost, locale)],
                [
                  l("Biaya tenaga kerja (tahun ini)", "Labour cost (year to date)"),
                  money(
                    d.months.reduce((t, m) => t + Number(m.labourCost), 0),
                    locale,
                  ),
                ],
                [
                  l("Cuti terpakai (hari)", "Leave taken (days)"),
                  String(d.months.reduce((t, m) => t + m.leaveDays, 0)),
                ],
                [
                  l("Jam lembur", "Overtime hours"),
                  String(d.months.reduce((t, m) => t + m.overtimeHours, 0)),
                ],
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
            <h2>
              {l(
                "Biaya tenaga kerja (gaji + BPJS Kesehatan + BPJS Ketenagakerjaan perusahaan)",
                "Labour cost (pay + employer BPJS Health + BPJS Employment)",
              )}
            </h2>
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
                  <th className="num">{l("BPJS Kesehatan (perusahaan)", "BPJS Health (employer)")}</th>
                  <th className="num">
                    {l("BPJS Ketenagakerjaan (perusahaan)", "BPJS Employment (employer)")}
                  </th>
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
                    <td className="num">{money(m.bpjsKesCost, locale)}</td>
                    <td className="num">{money(m.bpjsTkCost, locale)}</td>
                    <td className="num">{money(m.labourCost, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
