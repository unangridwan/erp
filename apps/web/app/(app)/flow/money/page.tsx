"use client";

import { businessToday, FORECAST_SOURCES, type ForecastSource } from "@erp/shared";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CashSankey, PairBars } from "../../../../components/flow/money-charts";
import { api, ApiError } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Flow {
  key: string;
  label: [string, string];
  amount: number;
}
interface Cash {
  from: string;
  to: string;
  opening: number;
  closing: number;
  inflow: number;
  outflow: number;
  net: number;
  inflows: Flow[];
  outflows: Flow[];
  unexplained: number;
  byMonth: { month: string; inflow: number; outflow: number; net: number }[];
}
interface Cycle {
  months: {
    month: string;
    revenue: number;
    cogs: number;
    ar: number;
    ap: number;
    inventory: number;
    dso: number | null;
    dio: number | null;
    dpo: number | null;
    ccc: number | null;
  }[];
  latest: Cycle["months"][number] | null;
}
interface Forecast {
  today: string;
  opening: number;
  weeks: ({
    index: number;
    start: string;
    end: string;
    inflow: number;
    outflow: number;
    net: number;
    balance: number;
  } & Record<ForecastSource, number>)[];
  overdue: Record<ForecastSource, number>;
  beyond: number;
  lowest: { week: number; balance: number };
  firstNegative: number | null;
}
interface Budget {
  from: string;
  to: string;
  items: {
    departmentId: string;
    department: string;
    costCenter: string | null;
    budget: number | null;
    actual: number | null;
    variance: number | null;
    percent: number | null;
  }[];
  unassigned: number;
  total: { budget: number; actual: number };
}

type Preset = "year" | "quarter" | "month" | "last_year";
function range(p: Preset) {
  const t = businessToday();
  const y = Number(t.slice(0, 4));
  const m = Number(t.slice(5, 7));
  const iso = (yy: number, mm: number, dd: number) =>
    new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  if (p === "last_year") return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  if (p === "month") return { from: iso(y, m, 1), to: t };
  if (p === "quarter") return { from: iso(y, Math.floor((m - 1) / 3) * 3 + 1, 1), to: t };
  return { from: `${y}-01-01`, to: t };
}

/**
 * Arus Uang: dari mana kas datang & ke mana perginya, siklus konversi kas, proyeksi kas 13 minggu, dan anggaran vs
 * realisasi per departemen — semuanya dari jurnal terposting & dokumen yang masih terbuka.
 */
export default function MoneyFlowPage() {
  const { l, locale } = useI18n();
  const [preset, setPreset] = useState<Preset>("year");
  const period = useMemo(() => range(preset), [preset]);
  const [cash, setCash] = useState<Cash | null>(null);
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCash(null);
    setError(null);
    const qs = `from=${period.from}&to=${period.to}`;
    api<Cash>(`/flow/money/cash?${qs}`).then(setCash, (e) =>
      setError(e instanceof ApiError ? e.message : String(e)),
    );
    api<Cycle>(`/flow/money/cycle?to=${period.to}`).then(setCycle, () => setCycle(null));
    api<Budget>(
      `/flow/money/budget?from=${period.from.slice(0, 4)}-01-01&to=${period.from.slice(0, 4)}-12-31`,
    ).then(setBudget, () => setBudget(null));
  }, [period.from, period.to]);
  useEffect(() => {
    api<Forecast>("/flow/money/forecast").then(setForecast, () => setForecast(null));
  }, []);

  const m = (v: number) => money(v, locale, 0);
  const compact = (v: number) =>
    new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);
  const n1 = (v: number | null) =>
    v === null ? "—" : v.toLocaleString(locale === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 });
  const monthLabel = (ym: string) =>
    new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(locale === "id" ? "id-ID" : "en-GB", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <nav className="breadcrumb">
            <Link href="/flow">{l("Alur Bisnis", "Business Flow")}</Link>
            <span>/</span>
            <h1>{l("Arus Uang", "Money Flow")}</h1>
          </nav>
        </div>
        <div className="cp-right">
          <div className="tabs" role="tablist" aria-label={l("Periode", "Period")}>
            {(
              [
                ["year", l("Tahun ini", "This year")],
                ["quarter", l("Kuartal ini", "This quarter")],
                ["month", l("Bulan ini", "This month")],
                ["last_year", l("Tahun lalu", "Last year")],
              ] as [Preset, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={preset === k}
                className={preset === k ? "active" : ""}
                onClick={() => setPreset(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <p className="muted">
        {l(
          "Dari mana uang datang dan ke mana perginya (jurnal yang menyentuh kas & bank), berapa lama uang tertahan di piutang, persediaan, dan utang, serta perkiraan saldo kas 13 minggu ke depan.",
          "Where money comes from and where it goes (entries touching cash & bank), how long money is tied up in receivables, inventory and payables, and the expected cash balance for the next 13 weeks.",
        )}
      </p>
      {error && <p className="muted">{error}</p>}

      {cash && (
        <>
          <section className="sc-summary" aria-label={l("Ringkasan kas", "Cash summary")}>
            {(
              [
                [l("Saldo awal", "Opening balance"), cash.opening, formatDate(cash.from, locale)],
                [l("Kas masuk", "Cash in"), cash.inflow, ""],
                [l("Kas keluar", "Cash out"), cash.outflow, ""],
                [l("Saldo akhir", "Closing balance"), cash.closing, formatDate(cash.to, locale)],
              ] as [string, number, string][]
            ).map(([label, v, sub]) => (
              <div key={label} className="sc-stat">
                <span className="muted small">{label}</span>
                <strong title={m(v)}>{compact(v)}</strong>
                <span className="muted small">{sub || m(v)}</span>
              </div>
            ))}
            <div className={`sc-stat ${cash.net >= 0 ? "sc-green" : "sc-red"}`}>
              <span className="muted small">{l("Perubahan bersih", "Net change")}</span>
              <strong title={m(cash.net)}>
                {cash.net >= 0 ? "+" : "−"}
                {compact(Math.abs(cash.net))}
              </strong>
              <span className="muted small">{m(cash.net)}</span>
            </div>
          </section>

          <section className="panel handoff-panel">
            <h2>{l("Dari mana & ke mana uang mengalir", "Where money comes from & goes")}</h2>
            <CashSankey
              inflows={cash.inflows.map((x) => ({ key: x.key, label: l(...x.label), amount: x.amount }))}
              outflows={cash.outflows.map((x) => ({ key: x.key, label: l(...x.label), amount: x.amount }))}
              format={compact}
            />
            {cash.unexplained !== 0 && (
              <p className="muted small">
                {l(
                  `Selisih tak terklasifikasi terhadap perubahan saldo kas: ${m(cash.unexplained)}.`,
                  `Unclassified difference to the cash balance change: ${m(cash.unexplained)}.`,
                )}
              </p>
            )}
            {cash.byMonth.length > 0 && (
              <>
                <h3>{l("Kas masuk & keluar per bulan", "Cash in & out per month")}</h3>
                <PairBars
                  rows={cash.byMonth.map((x) => ({
                    label: monthLabel(x.month),
                    values: [x.inflow, x.outflow],
                  }))}
                  series={[
                    { label: l("Masuk", "In"), className: "in" },
                    { label: l("Keluar", "Out"), className: "out" },
                  ]}
                  format={compact}
                />
              </>
            )}
          </section>
        </>
      )}
      {!cash && !error && <p className="muted">{l("Memuat…", "Loading…")}</p>}

      {cycle?.latest && (
        <section className="panel handoff-panel">
          <h2>{l("Siklus konversi kas", "Cash conversion cycle")}</h2>
          <p className="muted small">
            {l(
              "Berapa hari uang tertahan: DSO (piutang ÷ penjualan), DIO (persediaan ÷ HPP), DPO (utang usaha ÷ HPP). CCC = DSO + DIO − DPO; makin pendek makin cepat uang kembali. Rata-rata bergulir 3 bulan.",
              "How many days money is tied up: DSO (receivables ÷ sales), DIO (inventory ÷ COGS), DPO (payables ÷ COGS). CCC = DSO + DIO − DPO; shorter means cash returns faster. 3-month rolling average.",
            )}
          </p>
          <div className="sc-summary">
            {(
              [
                ["DSO", cycle.latest.dso, l("hari menagih", "days to collect")],
                ["DIO", cycle.latest.dio, l("hari stok tersimpan", "days in stock")],
                ["DPO", cycle.latest.dpo, l("hari membayar pemasok", "days to pay suppliers")],
                ["CCC", cycle.latest.ccc, l("hari siklus kas", "days cash cycle")],
              ] as [string, number | null, string][]
            ).map(([k, v, sub]) => (
              <div key={k} className={`sc-stat${k === "CCC" ? " sc-main" : ""}`}>
                <span className="muted small">{k}</span>
                <strong>{n1(v)}</strong>
                <span className="muted small">{sub}</span>
              </div>
            ))}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Bulan", "Month")}</th>
                  <th className="num">{l("Penjualan", "Sales")}</th>
                  <th className="num">{l("HPP", "COGS")}</th>
                  <th className="num">{l("Piutang", "Receivables")}</th>
                  <th className="num">{l("Persediaan", "Inventory")}</th>
                  <th className="num">{l("Utang usaha", "Payables")}</th>
                  <th className="num">DSO</th>
                  <th className="num">DIO</th>
                  <th className="num">DPO</th>
                  <th className="num">CCC</th>
                </tr>
              </thead>
              <tbody>
                {cycle.months.slice(-6).map((x) => (
                  <tr key={x.month}>
                    <td>{monthLabel(x.month)}</td>
                    <td className="num">{compact(x.revenue)}</td>
                    <td className="num">{compact(x.cogs)}</td>
                    <td className="num">{compact(x.ar)}</td>
                    <td className="num">{compact(x.inventory)}</td>
                    <td className="num">{compact(x.ap)}</td>
                    <td className="num">{n1(x.dso)}</td>
                    <td className="num">{n1(x.dio)}</td>
                    <td className="num">{n1(x.dpo)}</td>
                    <td className="num">
                      <strong>{n1(x.ccc)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {forecast && (
        <section className="panel handoff-panel">
          <h2>{l("Proyeksi kas 13 minggu", "13-week cash forecast")}</h2>
          <p className="muted small">
            {l(
              "Saldo kas hari ini ditambah piutang menurut jatuh tempo & pesanan yang belum ditagih, dikurangi utang menurut jatuh tempo, PO yang belum ditagih pemasok, dan payroll rutin. Pos yang sudah lewat jatuh tempo masuk minggu pertama.",
              "Today's cash balance plus receivables by due date & uninvoiced orders, minus payables by due date, unbilled POs and regular payroll. Overdue items fall into the first week.",
            )}
          </p>
          <div className="sc-summary">
            <div className="sc-stat">
              <span className="muted small">{l("Saldo kas hari ini", "Cash today")}</span>
              <strong title={m(forecast.opening)}>{compact(forecast.opening)}</strong>
            </div>
            <div className={`sc-stat ${forecast.lowest.balance < 0 ? "sc-red" : ""}`}>
              <span className="muted small">{l("Saldo terendah", "Lowest balance")}</span>
              <strong title={m(forecast.lowest.balance)}>{compact(forecast.lowest.balance)}</strong>
              <span className="muted small">
                {l(`minggu ke-${forecast.lowest.week}`, `week ${forecast.lowest.week}`)}
              </span>
            </div>
            <div className={`sc-stat ${forecast.firstNegative ? "sc-red" : "sc-green"}`}>
              <span className="muted small">{l("Kas negatif", "Negative cash")}</span>
              <strong>
                {forecast.firstNegative
                  ? l(`Minggu ke-${forecast.firstNegative}`, `Week ${forecast.firstNegative}`)
                  : l("Tidak", "No")}
              </strong>
            </div>
            <div className="sc-stat">
              <span className="muted small">{l("Termasuk lewat jatuh tempo", "Includes overdue")}</span>
              <span className="small">
                {l("Piutang", "Receivables")} {compact(forecast.overdue.receivables)}
              </span>
              <span className="small">
                {l("Utang", "Payables")} {compact(forecast.overdue.payables)}
              </span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="forecast-table">
              <thead>
                <tr>
                  <th>{l("Minggu", "Week")}</th>
                  {(Object.keys(FORECAST_SOURCES) as ForecastSource[]).map((k) => (
                    <th key={k} className="num">
                      {l(...FORECAST_SOURCES[k].label)}
                    </th>
                  ))}
                  <th className="num">{l("Bersih", "Net")}</th>
                  <th className="num">{l("Saldo", "Balance")}</th>
                </tr>
              </thead>
              <tbody>
                {forecast.weeks.map((w) => (
                  <tr key={w.index} className={w.balance < 0 ? "row-late" : undefined}>
                    <td>
                      {w.index}. {formatDate(w.start, locale)}
                    </td>
                    {(Object.keys(FORECAST_SOURCES) as ForecastSource[]).map((k) => (
                      <td key={k} className={`num ${FORECAST_SOURCES[k].dir === "in" ? "pos" : "neg"}`}>
                        {w[k] ? `${FORECAST_SOURCES[k].dir === "in" ? "+" : "−"}${compact(w[k])}` : "—"}
                      </td>
                    ))}
                    <td className={`num ${w.net >= 0 ? "pos" : "neg"}`}>
                      {w.net >= 0 ? "+" : "−"}
                      {compact(Math.abs(w.net))}
                    </td>
                    <td className="num">
                      <strong>{compact(w.balance)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {budget && (
        <section className="panel handoff-panel">
          <h2>
            {l("Anggaran vs realisasi per departemen", "Budget vs actual per department")} ·{" "}
            {budget.from.slice(0, 4)}
          </h2>
          {budget.items.some((d) => d.costCenter) ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{l("Departemen", "Department")}</th>
                    <th>{l("Cost center", "Cost center")}</th>
                    <th className="num">{l("Anggaran", "Budget")}</th>
                    <th className="num">{l("Realisasi", "Actual")}</th>
                    <th>{l("Pemakaian", "Usage")}</th>
                  </tr>
                </thead>
                <tbody>
                  {budget.items
                    .filter((d) => d.costCenter)
                    .map((d) => (
                      <tr
                        key={d.departmentId}
                        className={d.percent !== null && d.percent > 100 ? "row-late" : undefined}
                      >
                        <td>{d.department}</td>
                        <td className="muted">{d.costCenter}</td>
                        <td className="num">{d.budget ? m(d.budget) : "—"}</td>
                        <td className="num">{m(d.actual ?? 0)}</td>
                        <td>
                          {d.percent === null ? (
                            <span className="muted small">{l("Tanpa anggaran", "No budget")}</span>
                          ) : (
                            <span className="budget-bar" title={`${n1(d.percent)}%`}>
                              <span
                                style={{ width: `${Math.min(100, d.percent)}%` }}
                                className={d.percent > 100 ? "over" : d.percent >= 90 ? "near" : undefined}
                              />
                              <b>{n1(d.percent)}%</b>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">
              {l(
                "Belum ada departemen yang terhubung ke cost center. Isi cost center di data departemen dan buat anggaran per cost center agar realisasi beban tiap departemen terpantau.",
                "No department is linked to a cost center yet. Set a cost center on each department and create budgets per cost center to track each department's spending.",
              )}{" "}
              <Link href="/departments">{l("Buka departemen →", "Open departments →")}</Link>
            </p>
          )}
          <p className="muted small">
            {l("Beban tanpa cost center", "Expenses without a cost center")}: {m(budget.unassigned)}
          </p>
        </section>
      )}
    </>
  );
}
