"use client";

import { useEffect, useState } from "react";
import { BarChart, HBarList } from "../../../../components/hr/charts";
import { errorText } from "../../../../components/hr/hr-panels";
import { RefSelect } from "../../../../components/ref-select";
import { api } from "../../../../lib/api";
import { download } from "../../../../lib/download";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

type Count = { label: string; count: number };
interface Analytics {
  year: number;
  asOf: string;
  summary: {
    headcount: number;
    startHeadcount: number;
    hires: number;
    leavers: number;
    turnover: number;
    voluntaryTurnover: number;
    involuntaryTurnover: number;
    retention: number;
    averageTenure: number;
    averageAge: number | null;
  };
  months: { month: string; headcount: number | null; hires: number; leavers: number }[];
  byDepartment: {
    department: string;
    start: number;
    end: number;
    hires: number;
    leavers: number;
    turnover: number;
  }[];
  leaveReasons: Count[];
  leaversByTenure: Count[];
  distribution: Record<
    "age" | "gender" | "education" | "grade" | "department" | "contractType" | "tenure",
    Count[]
  >;
  payEquity: null | {
    overall: { maleMedian: number; femaleMedian: number; gap: number | null };
    byGrade: {
      grade: string;
      maleCount: number;
      maleMedian: number;
      femaleCount: number;
      femaleMedian: number;
      gap: number | null;
      compaRatio: number | null;
      below: number;
      above: number;
    }[];
  };
}

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Analitik SDM: turnover & retensi, masa kerja, demografi, dan kesetaraan gaji per golongan × gender. */
export default function HrAnalyticsPage() {
  const { l, locale } = useI18n();
  const [year, setYear] = useState(new Date().getFullYear());
  const [departmentId, setDepartmentId] = useState("");
  const [d, setD] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = `year=${year}${departmentId ? `&departmentId=${departmentId}` : ""}`;
  useEffect(() => {
    setError(null);
    api<Analytics>(`/hr/analytics?${query}`).then(setD, (e) => setError(errorText(e)));
  }, [query]);
  const nf = (v: number) => v.toLocaleString(locale === "id" ? "id-ID" : "en-US");
  const pct = (v: number | null) => (v === null ? "—" : `${nf(v)}%`);
  const rows = (c: Count[]) => c.map((x) => ({ label: x.label, value: x.count }));
  const s = d?.summary;

  return (
    <div className="stack-wide">
      <section className="panel">
        <header className="toolbar">
          <h1>{l("Analitik SDM", "HR Analytics")}</h1>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label={l("Tahun", "Year")}
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
          <label className="field">
            <span>{l("Departemen", "Department")}</span>
            <RefSelect
              name="departmentId"
              resource="departments"
              display="name"
              value={departmentId}
              onChange={setDepartmentId}
            />
          </label>
          <button
            type="button"
            onClick={() =>
              download(`/hr/analytics?${query}&format=xlsx`, undefined, `analitik-sdm-${year}.xlsx`).catch(
                (e: Error) => setError(e.message),
              )
            }
          >
            {l("Ekspor Excel", "Export Excel")}
          </button>
        </header>
        {error && <p className="error">{error}</p>}
        {s && (
          <>
            <ul className="grid">
              {(
                [
                  [l("Karyawan aktif", "Active employees"), nf(s.headcount)],
                  [l("Awal tahun", "Start of year"), nf(s.startHeadcount)],
                  [l("Masuk", "Hires"), nf(s.hires)],
                  [l("Keluar", "Leavers"), nf(s.leavers)],
                  [l("Turnover", "Turnover"), pct(s.turnover)],
                  [l("Turnover sukarela", "Voluntary turnover"), pct(s.voluntaryTurnover)],
                  [l("Turnover tidak sukarela", "Involuntary turnover"), pct(s.involuntaryTurnover)],
                  [l("Retensi", "Retention"), pct(s.retention)],
                  [l("Rata-rata masa kerja", "Average tenure"), `${nf(s.averageTenure)} ${l("thn", "yrs")}`],
                  [
                    l("Rata-rata usia", "Average age"),
                    s.averageAge === null ? "—" : `${nf(s.averageAge)} ${l("thn", "yrs")}`,
                  ],
                ] as const
              ).map(([label, value]) => (
                <li key={label} className="card">
                  <span>{label}</span>
                  <strong>{value}</strong>
                </li>
              ))}
            </ul>
            <p className="muted">
              {l(
                `Per ${d.asOf}. Turnover = keluar ÷ rata-rata headcount awal & akhir; retensi = karyawan awal tahun yang masih aktif. Sukarela = mengundurkan diri.`,
                `As of ${d.asOf}. Turnover = leavers ÷ average of start & end headcount; retention = start-of-year employees still active. Voluntary = resignation.`,
              )}
            </p>
          </>
        )}
      </section>
      {d && (
        <>
          <div className="grid-2">
            <section className="panel">
              <h2>{l("Headcount akhir bulan", "Month-end headcount")}</h2>
              <BarChart
                ariaLabel={l("Headcount per bulan", "Headcount by month")}
                labels={locale === "id" ? MONTHS_ID : MONTHS_EN}
                series={[
                  {
                    key: "hc",
                    label: l("Karyawan", "Employees"),
                    slot: 1,
                    values: d.months.map((m) => m.headcount ?? 0),
                  },
                ]}
              />
            </section>
            <section className="panel">
              <h2>{l("Masuk & keluar", "Hires & leavers")}</h2>
              <BarChart
                ariaLabel={l("Karyawan masuk dan keluar per bulan", "Hires and leavers by month")}
                labels={locale === "id" ? MONTHS_ID : MONTHS_EN}
                series={[
                  { key: "in", label: l("Masuk", "Hires"), slot: 1, values: d.months.map((m) => m.hires) },
                  {
                    key: "out",
                    label: l("Keluar", "Leavers"),
                    slot: 2,
                    values: d.months.map((m) => m.leavers),
                  },
                ]}
              />
            </section>
          </div>
          <section className="panel proj-panel">
            <h2>{l("Turnover per departemen", "Turnover by department")}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{l("Departemen", "Department")}</th>
                    <th className="num">{l("Awal", "Start")}</th>
                    <th className="num">{l("Masuk", "Hires")}</th>
                    <th className="num">{l("Keluar", "Leavers")}</th>
                    <th className="num">{l("Akhir", "End")}</th>
                    <th className="num">Turnover</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byDepartment.map((r) => (
                    <tr key={r.department}>
                      <td>{r.department}</td>
                      <td className="num">{r.start}</td>
                      <td className="num">{r.hires}</td>
                      <td className="num">{r.leavers}</td>
                      <td className="num">{r.end}</td>
                      <td className="num">
                        <span className={`pill ${r.turnover > 20 ? "bad" : r.turnover > 10 ? "warn" : "ok"}`}>
                          {pct(r.turnover)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!d.byDepartment.length && (
                    <tr>
                      <td colSpan={6} className="muted">
                        {l("Belum ada data karyawan.", "No employee data yet.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <div className="grid-2">
            <Dist
              title={l("Alasan keluar", "Leave reasons")}
              rows={rows(d.leaveReasons)}
              empty={l("Tidak ada karyawan keluar.", "No leavers.")}
            />
            <Dist
              title={l("Masa kerja saat keluar", "Tenure at exit")}
              rows={rows(d.leaversByTenure)}
              empty={l("Tidak ada karyawan keluar.", "No leavers.")}
            />
            <Dist title={l("Usia", "Age")} rows={rows(d.distribution.age)} />
            <Dist title={l("Gender", "Gender")} rows={rows(d.distribution.gender)} />
            <Dist
              title={l("Pendidikan terakhir", "Highest education")}
              rows={rows(d.distribution.education)}
            />
            <Dist title={l("Masa kerja", "Tenure")} rows={rows(d.distribution.tenure)} />
            <Dist title={l("Golongan", "Grade")} rows={rows(d.distribution.grade)} />
            <Dist title={l("Jenis kontrak", "Contract type")} rows={rows(d.distribution.contractType)} />
          </div>
          {d.payEquity && (
            <section className="panel proj-panel">
              <h2>{l("Kesetaraan gaji (upah kontrak berjalan)", "Pay equity (current contract wage)")}</h2>
              <p className="muted">
                {l(
                  `Median laki-laki ${money(d.payEquity.overall.maleMedian, locale)} · perempuan ${money(d.payEquity.overall.femaleMedian, locale)} · kesenjangan ${pct(d.payEquity.overall.gap)}. Compa-ratio = upah ÷ titik tengah skala golongan; < 0,8 di bawah, > 1,2 di atas skala.`,
                  `Male median ${money(d.payEquity.overall.maleMedian, locale)} · female ${money(d.payEquity.overall.femaleMedian, locale)} · gap ${pct(d.payEquity.overall.gap)}. Compa-ratio = wage ÷ grade midpoint; < 0.8 below, > 1.2 above range.`,
                )}
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{l("Golongan", "Grade")}</th>
                      <th className="num">{l("Jml L", "Male #")}</th>
                      <th className="num">{l("Median L", "Male median")}</th>
                      <th className="num">{l("Jml P", "Female #")}</th>
                      <th className="num">{l("Median P", "Female median")}</th>
                      <th className="num">{l("Kesenjangan", "Gap")}</th>
                      <th className="num">Compa-ratio</th>
                      <th className="num">{l("Di bawah / di atas skala", "Below / above range")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.payEquity.byGrade.map((g) => (
                      <tr key={g.grade}>
                        <td>{g.grade}</td>
                        <td className="num">{g.maleCount}</td>
                        <td className="num">{g.maleCount ? money(g.maleMedian, locale) : "—"}</td>
                        <td className="num">{g.femaleCount}</td>
                        <td className="num">{g.femaleCount ? money(g.femaleMedian, locale) : "—"}</td>
                        <td className="num">
                          {g.gap === null ? (
                            "—"
                          ) : (
                            <span
                              className={`pill ${Math.abs(g.gap) > 10 ? "bad" : Math.abs(g.gap) > 5 ? "warn" : "ok"}`}
                            >
                              {pct(g.gap)}
                            </span>
                          )}
                        </td>
                        <td className="num">{g.compaRatio === null ? "—" : nf(g.compaRatio)}</td>
                        <td className="num">
                          {g.below} / {g.above}
                        </td>
                      </tr>
                    ))}
                    {!d.payEquity.byGrade.length && (
                      <tr>
                        <td colSpan={8} className="muted">
                          {l("Belum ada kontrak berjalan.", "No running contracts.")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Dist(props: { title: string; rows: { label: string; value: number }[]; empty?: string }) {
  const { l } = useI18n();
  return (
    <section className="panel">
      <h2>{props.title}</h2>
      {props.rows.length ? (
        <HBarList rows={props.rows} />
      ) : (
        <p className="muted">{props.empty ?? l("Belum ada data.", "No data yet.")}</p>
      )}
    </section>
  );
}
