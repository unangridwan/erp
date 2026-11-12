"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { api } from "../../../../lib/api";
import { money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { COST_CENTER_CATEGORIES } from "../../../../lib/resources";

type Tab = "cost-centers" | "profit-centers";

interface CostRow {
  id: string;
  code: string;
  name: string;
  category: string;
  active: boolean;
  depth: number;
  hasChildren: boolean;
  ownActual: string;
  actual: string;
  budget: string;
  variance: string;
  percent: number | null;
}
interface CostReport {
  rows: CostRow[];
  unassigned: string;
  total: { actual: string; budget: string };
}
interface Statement {
  revenue: string;
  cogs: string;
  grossProfit: string;
  opex: string;
  operatingProfit: string;
  otherIncome: string;
  otherExpense: string;
  netProfit: string;
  margin: number | null;
}
interface ProfitRow extends Statement {
  id: string;
  code: string;
  name: string;
  active: boolean;
  depth: number;
  hasChildren: boolean;
}
interface ProfitReport {
  rows: ProfitRow[];
  unassigned: Statement;
  total: Statement;
}
interface AccountRow {
  accountId: string;
  code: string;
  name: string;
  actual: string;
}

const yearStart = () => `${new Date().getFullYear()}-01-01`;

/** Laporan controlling: biaya per cost center vs anggaran, dan laba rugi per profit center (perusahaan aktif). */
export default function ControllingPage() {
  const { l, tx, locale } = useI18n();
  const m = (v: string | number) => money(v, locale);
  const branches = useOptions<{ id: string; name: string }>("/branches");
  const [tab, setTab] = useState<Tab>("cost-centers");
  const [filters, setFilters] = useState({ dateFrom: yearStart(), dateTo: today(), branchId: "" });
  const [cost, setCost] = useState<CostReport | null>(null);
  const [profit, setProfit] = useState<ProfitReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<AccountRow[] | null>(null);

  const query = () => {
    const p = new URLSearchParams({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
    if (filters.branchId) p.set("branchId", filters.branchId);
    return p.toString();
  };

  useEffect(() => {
    setError(null);
    setOpen(null);
    const q = query();
    const req =
      tab === "cost-centers"
        ? api<CostReport>(`/controlling/cost-centers?${q}`).then(setCost)
        : api<ProfitReport>(`/controlling/profit-centers?${q}`).then(setProfit);
    req.catch((e: Error) => setError(e.message));
  }, [tab, filters]);

  useEffect(() => {
    setDetail(null);
    if (!open) return;
    api<AccountRow[]>(`/controlling/cost-centers/${open}/accounts?${query()}`)
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
  }, [open]);

  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch }));
  const category = (c: string) => {
    const found = COST_CENTER_CATEGORIES.find(([k]) => k === c);
    return found ? tx(found[1]) : c;
  };
  const indent = (depth: number) => ({ paddingInlineStart: `${0.5 + depth * 1.25}rem` });
  const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString(locale)}%`);
  const neg = (v: string) => (v.startsWith("-") ? "credit-neg" : undefined);

  return (
    <>
      <header className="toolbar">
        <h1>{l("Laporan controlling", "Controlling reports")}</h1>
        <button className="no-print" onClick={() => window.print()}>
          {l("Cetak / PDF", "Print / PDF")}
        </button>
      </header>
      <p className="muted">
        {l(
          "Perusahaan aktif. Biaya = saldo akun beban (pokok penjualan, operasional, penyusutan, lain-lain) yang sudah diposting, tanpa entri penutup. ",
          "Active company. Cost = posted balances of expense accounts (cost of sales, operating, depreciation, other), excluding closing entries. ",
        )}
        <Link href="/cost-centers">{l("Kelola cost center", "Manage cost centers")}</Link> ·{" "}
        <Link href="/profit-centers">{l("Kelola profit center", "Manage profit centers")}</Link>
      </p>
      <nav className="tabs no-print">
        <button className={tab === "cost-centers" ? "active" : ""} onClick={() => setTab("cost-centers")}>
          {l("Biaya per cost center", "Cost by cost center")}
        </button>
        <button className={tab === "profit-centers" ? "active" : ""} onClick={() => setTab("profit-centers")}>
          {l("Laba rugi per profit center", "P&L by profit center")}
        </button>
      </nav>
      <div className="panel filters no-print">
        <label className="field">
          <span>{l("Dari", "From")}</span>
          <input type="date" value={filters.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} />
        </label>
        <label className="field">
          <span>{l("Sampai", "To")}</span>
          <input type="date" value={filters.dateTo} onChange={(e) => set({ dateTo: e.target.value })} />
        </label>
        <label className="field">
          <span>{l("Cabang", "Branch")}</span>
          <select value={filters.branchId} onChange={(e) => set({ branchId: e.target.value })}>
            <option value="">{l("Semua", "All")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="error">{error}</p>}

      {tab === "cost-centers" && cost && (
        <div className="table-wrap report">
          {cost.rows.length === 0 && (
            <p className="muted">
              {l("Belum ada cost center. ", "No cost centers yet. ")}
              <Link href="/cost-centers/new">
                {l("Buat cost center pertama", "Create the first cost center")}
              </Link>
            </p>
          )}
          <table>
            <thead>
              <tr>
                <th>{l("Cost center", "Cost center")}</th>
                <th>{l("Kategori", "Category")}</th>
                <th className="num">{l("Realisasi", "Actual")}</th>
                <th className="num">{l("Anggaran", "Budget")}</th>
                <th className="num">{l("Selisih", "Variance")}</th>
                <th className="num">{l("Capaian", "Used")}</th>
              </tr>
            </thead>
            <tbody>
              {cost.rows.map((r) => (
                <Fragment key={r.id}>
                  <tr className={r.hasChildren ? "subtotal" : undefined}>
                    <td style={indent(r.depth)}>
                      <button
                        type="button"
                        className="link"
                        aria-expanded={open === r.id}
                        onClick={() => setOpen(open === r.id ? null : r.id)}
                      >
                        {r.code} {r.name}
                      </button>
                      {!r.active && <span className="muted"> ({l("nonaktif", "inactive")})</span>}
                    </td>
                    <td>{category(r.category)}</td>
                    <td className="num">{m(r.actual)}</td>
                    <td className="num">{Number(r.budget) ? m(r.budget) : "—"}</td>
                    <td className={`num ${Number(r.budget) && Number(r.variance) > 0 ? "credit-neg" : ""}`}>
                      {Number(r.budget) ? m(r.variance) : "—"}
                    </td>
                    <td className="num">{pct(r.percent)}</td>
                  </tr>
                  {open === r.id &&
                    (!detail ? (
                      <tr className="cc-detail">
                        <td colSpan={6} className="muted" style={indent(r.depth + 1)}>
                          {l("Memuat…", "Loading…")}
                        </td>
                      </tr>
                    ) : detail.length === 0 ? (
                      <tr className="cc-detail">
                        <td colSpan={6} className="muted" style={indent(r.depth + 1)}>
                          {l("Tidak ada biaya pada periode ini.", "No costs in this period.")}
                        </td>
                      </tr>
                    ) : (
                      detail.map((d) => (
                        <tr key={d.accountId} className="cc-detail">
                          <td style={indent(r.depth + 1)}>
                            {d.code} {d.name}
                          </td>
                          <td />
                          <td className="num">{m(d.actual)}</td>
                          <td colSpan={3} />
                        </tr>
                      ))
                    ))}
                </Fragment>
              ))}
              <tr>
                <td colSpan={2} className="muted">
                  {l("Tanpa cost center", "No cost center")}
                </td>
                <td className="num">{m(cost.unassigned)}</td>
                <td colSpan={3} />
              </tr>
              <tr className="grand">
                <td colSpan={2}>{l("Total biaya", "Total cost")}</td>
                <td className="num">{m(cost.total.actual)}</td>
                <td className="num">{m(cost.total.budget)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {tab === "profit-centers" && profit && (
        <div className="table-wrap report">
          {profit.rows.length === 0 && (
            <p className="muted">
              {l("Belum ada profit center. ", "No profit centers yet. ")}
              <Link href="/profit-centers/new">
                {l("Buat profit center pertama", "Create the first profit center")}
              </Link>
            </p>
          )}
          <table>
            <thead>
              <tr>
                <th>{l("Profit center", "Profit center")}</th>
                <th className="num">{l("Pendapatan", "Revenue")}</th>
                <th className="num">{l("HPP", "COGS")}</th>
                <th className="num">{l("Laba kotor", "Gross profit")}</th>
                <th className="num">{l("Beban operasional", "Operating expenses")}</th>
                <th className="num">{l("Laba usaha", "Operating profit")}</th>
                <th className="num">{l("Laba bersih", "Net profit")}</th>
                <th className="num">{l("Margin", "Margin")}</th>
              </tr>
            </thead>
            <tbody>
              {[
                ...profit.rows.map((r) => ({
                  ...r,
                  label: `${r.code} ${r.name}`,
                  className: r.hasChildren ? "subtotal" : undefined,
                })),
                {
                  ...profit.unassigned,
                  id: "none",
                  depth: 0,
                  label: l("Tanpa profit center", "No profit center"),
                  className: "muted",
                },
                { ...profit.total, id: "total", depth: 0, label: l("Total", "Total"), className: "grand" },
              ].map((r) => (
                <tr key={r.id} className={r.className}>
                  <td style={indent(r.depth)}>{r.label}</td>
                  <td className="num">{m(r.revenue)}</td>
                  <td className="num">{m(r.cogs)}</td>
                  <td className={`num ${neg(r.grossProfit) ?? ""}`}>{m(r.grossProfit)}</td>
                  <td className="num">{m(r.opex)}</td>
                  <td className={`num ${neg(r.operatingProfit) ?? ""}`}>{m(r.operatingProfit)}</td>
                  <td className={`num ${neg(r.netProfit) ?? ""}`}>{m(r.netProfit)}</td>
                  <td className="num">{pct(r.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
