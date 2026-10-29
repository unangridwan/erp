"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { download } from "../../lib/download";
import { money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";

interface TotalRewards {
  year: number;
  cash: { name: string; amount: string }[];
  employer: { name: string; amount: string }[];
  cashTotal: string;
  employerTotal: string;
  total: string;
  months: number;
  currentWage: string | null;
  benefits: string[];
}

/** Total kompensasi setahun (tunai + dibayar perusahaan) dari slip terposting; untuk HR (karyawan) atau portal (`mine`). */
export function TotalRewardsPanel({ employeeId, mine = false }: { employeeId?: string; mine?: boolean }) {
  const { l, locale } = useI18n();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [data, setData] = useState<TotalRewards | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = mine ? "/me/total-rewards" : `/employees/${employeeId}/total-rewards`;

  useEffect(() => {
    api<TotalRewards>(`${base}?year=${year}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [base, year]);

  if (error) return mine ? null : <p className="error">{error}</p>;
  if (mine && data && data.months === 0 && year === thisYear) return null;

  const rows = (items: { name: string; amount: string }[]) =>
    items.map((r) => (
      <tr key={r.name}>
        <td>{r.name}</td>
        <td className="num">{money(r.amount, locale)}</td>
      </tr>
    ));

  return (
    <section className="panel stack proj-panel">
      <header className="toolbar">
        <h2>{mine ? l("Total rewards saya", "My total rewards") : l("Total rewards", "Total rewards")}</h2>
        <select
          aria-label={l("Tahun", "Year")}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {[0, 1, 2].map((i) => (
            <option key={i} value={thisYear - i}>
              {thisYear - i}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() =>
            download(`${base}/pdf?year=${year}`, undefined, `total-rewards-${year}.pdf`).catch((e: Error) =>
              setError(e.message),
            )
          }
        >
          PDF
        </button>
      </header>
      {!data ? (
        <p className="muted">{l("Memuat…", "Loading…")}</p>
      ) : data.months === 0 ? (
        <p className="muted">
          {l("Belum ada slip gaji terposting di tahun ini.", "No posted payslips in this year yet.")}
        </p>
      ) : (
        <>
          <p className="muted">
            {l(
              `Dari ${data.months} slip terposting; nilai kotor sebelum pajak & iuran karyawan.`,
              `From ${data.months} posted payslips; gross amounts before tax & employee contributions.`,
            )}
          </p>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <th colSpan={2}>{l("Penghasilan tunai", "Cash compensation")}</th>
                </tr>
                {rows(data.cash)}
                <tr>
                  <td>
                    <strong>{l("Subtotal tunai", "Cash subtotal")}</strong>
                  </td>
                  <td className="num">
                    <strong>{money(data.cashTotal, locale)}</strong>
                  </td>
                </tr>
                <tr>
                  <th colSpan={2}>
                    {l("Dibayar perusahaan (BPJS & benefit)", "Paid by the company (BPJS & benefits)")}
                  </th>
                </tr>
                {rows(data.employer)}
                <tr>
                  <td>
                    <strong>{l("Subtotal perusahaan", "Employer subtotal")}</strong>
                  </td>
                  <td className="num">
                    <strong>{money(data.employerTotal, locale)}</strong>
                  </td>
                </tr>
                <tr className="total-row">
                  <td>
                    <strong>{l("Total rewards setahun", "Total rewards for the year")}</strong>
                  </td>
                  <td className="num">
                    <strong>{money(data.total, locale)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {data.benefits.length > 0 && (
            <p className="muted">
              {l("Benefit aktif", "Active benefits")}: {data.benefits.join(", ")}
            </p>
          )}
        </>
      )}
    </section>
  );
}
