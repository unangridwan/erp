"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { download } from "../../../../components/accounting/download";
import { useOptions, type AccountOption } from "../../../../components/accounting/use-options";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

type Tab = "trial-balance" | "profit-loss" | "balance-sheet" | "general-ledger" | "aged" | "branch-clearing";
interface Section {
  accounts: { accountId: string; code: string; name: string; amount: string }[];
  total: string;
}

/** Laporan per tanggal (tanpa tanggal awal). */
const POINT_IN_TIME: Tab[] = ["balance-sheet", "aged", "branch-clearing"];
const yearStart = () => `${new Date().getFullYear()}-01-01`;

export default function ReportsPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const accounts = useOptions<AccountOption>("/accounts");
  const branches = useOptions<{ id: string; name: string }>("/branches");
  const units = useOptions<{ id: string; name: string }>("/business-units");
  const [tab, setTab] = useState<Tab>("profit-loss");
  const [filters, setFilters] = useState({
    dateFrom: yearStart(),
    dateTo: today(),
    branchId: "",
    businessUnitId: "",
    accountId: "",
    type: "receivable",
    companyIds: [me.activeCompanyId],
  });
  // Data disimpan bersama tab asalnya agar tab baru tidak merender data tab lama selama memuat.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<{ tab: Tab; data: any } | null>(null);
  const data = result?.tab === tab ? result.data : null;
  const [error, setError] = useState<string | null>(null);

  const queryString = () => {
    const params = new URLSearchParams({ dateTo: filters.dateTo, companyIds: filters.companyIds.join(",") });
    if (!POINT_IN_TIME.includes(tab)) params.set("dateFrom", filters.dateFrom);
    if (filters.branchId) params.set("branchId", filters.branchId);
    if (filters.businessUnitId) params.set("businessUnitId", filters.businessUnitId);
    if (tab === "general-ledger") params.set("accountId", filters.accountId);
    if (tab === "aged") params.set("type", filters.type);
    return params.toString();
  };

  useEffect(() => {
    if (tab === "general-ledger" && !filters.accountId) {
      setResult(null);
      return;
    }
    const params = new URLSearchParams({ dateTo: filters.dateTo, companyIds: filters.companyIds.join(",") });
    if (!POINT_IN_TIME.includes(tab)) params.set("dateFrom", filters.dateFrom);
    if (filters.branchId) params.set("branchId", filters.branchId);
    if (filters.businessUnitId) params.set("businessUnitId", filters.businessUnitId);
    if (tab === "general-ledger") params.set("accountId", filters.accountId);
    if (tab === "aged") params.set("type", filters.type);
    setError(null);
    api(`/reports/${tab}?${params}`)
      .then((d) => setResult({ tab, data: d }))
      .catch((e: Error) => {
        setResult(null);
        setError(e.message);
      });
  }, [tab, filters]);

  const m = (v: string | number) => money(v, locale);
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch }));
  const tabs: [Tab, string][] = [
    ["profit-loss", l("Laba Rugi", "Profit & Loss")],
    ["balance-sheet", l("Neraca", "Balance Sheet")],
    ["trial-balance", l("Neraca Saldo", "Trial Balance")],
    ["general-ledger", l("Buku Besar", "General Ledger")],
    ["aged", l("Umur Piutang/Utang", "Aged Balances")],
    ["branch-clearing", l("RK Pusat–Cabang", "Branch Clearing")],
  ];

  const section = (title: string, s: Section) => (
    <>
      <tr className="section">
        <th colSpan={2}>{title}</th>
      </tr>
      {s.accounts.map((a, i) => (
        <tr key={`${a.accountId}-${i}`}>
          <td>
            {a.code && <span className="muted">{a.code} </span>}
            {a.name}
          </td>
          <td className="num">{m(a.amount)}</td>
        </tr>
      ))}
      <tr className="subtotal">
        <td>
          {l("Total", "Total")} {title.toLowerCase()}
        </td>
        <td className="num">{m(s.total)}</td>
      </tr>
    </>
  );
  const totalRow = (label: string, value: string) => (
    <tr className="grand">
      <td>{label}</td>
      <td className="num">{m(value)}</td>
    </tr>
  );

  return (
    <>
      <header className="toolbar">
        <h1>{l("Laporan keuangan", "Financial reports")}</h1>
        {data && (
          <>
            <button
              className="no-print"
              onClick={() =>
                download(`/reports/${tab}/export?${queryString()}`, `${tab}.xlsx`).catch((e: Error) =>
                  setError(e.message),
                )
              }
            >
              {l("Ekspor Excel", "Export Excel")}
            </button>
            <button className="no-print" onClick={() => window.print()}>
              {l("Cetak / PDF", "Print / PDF")}
            </button>
          </>
        )}
      </header>
      <p className="print-only">
        {me.companies
          .filter((c) => filters.companyIds.includes(c.id))
          .map((c) => c.name)
          .join(", ")}{" "}
        · {tabs.find(([k]) => k === tab)?.[1]} ·{" "}
        {POINT_IN_TIME.includes(tab) ? filters.dateTo : `${filters.dateFrom} – ${filters.dateTo}`}
      </p>
      <nav className="tabs no-print">
        {tabs.map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="panel filters no-print">
        {!POINT_IN_TIME.includes(tab) && (
          <label className="field">
            <span>{l("Dari", "From")}</span>
            <input type="date" value={filters.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} />
          </label>
        )}
        <label className="field">
          <span>{POINT_IN_TIME.includes(tab) ? l("Per tanggal", "As of") : l("Sampai", "To")}</span>
          <input type="date" value={filters.dateTo} onChange={(e) => set({ dateTo: e.target.value })} />
        </label>
        {tab === "general-ledger" && (
          <label className="field">
            <span>{l("Akun", "Account")}</span>
            <select value={filters.accountId} onChange={(e) => set({ accountId: e.target.value })}>
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {tab === "aged" && (
          <label className="field">
            <span>{l("Jenis", "Type")}</span>
            <select value={filters.type} onChange={(e) => set({ type: e.target.value })}>
              <option value="receivable">{l("Piutang", "Receivable")}</option>
              <option value="payable">{l("Utang", "Payable")}</option>
            </select>
          </label>
        )}
        {tab !== "branch-clearing" && (
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
        )}
        <label className="field">
          <span>{l("Unit bisnis", "Business unit")}</span>
          <select value={filters.businessUnitId} onChange={(e) => set({ businessUnitId: e.target.value })}>
            <option value="">{l("Semua", "All")}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        {me.companies.length > 1 && (
          <fieldset className="choices">
            <legend>
              {l("Perusahaan (dijumlahkan, tanpa eliminasi)", "Companies (summed, no eliminations)")}
            </legend>
            {me.companies.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={filters.companyIds.includes(c.id)}
                  onChange={(e) =>
                    set({
                      companyIds: e.target.checked
                        ? [...filters.companyIds, c.id]
                        : filters.companyIds.filter((x) => x !== c.id).length
                          ? filters.companyIds.filter((x) => x !== c.id)
                          : filters.companyIds,
                    })
                  }
                />{" "}
                {c.code}
              </label>
            ))}
          </fieldset>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {tab === "general-ledger" && !filters.accountId && (
        <p className="muted">{l("Pilih akun.", "Select an account.")}</p>
      )}

      {data && tab === "profit-loss" && (
        <div className="table-wrap report">
          <table>
            <tbody>
              {section(l("Pendapatan", "Income"), data.income)}
              {section(l("Harga pokok penjualan", "Cost of revenue"), data.directCost)}
              {totalRow(l("Laba kotor", "Gross profit"), data.grossProfit)}
              {section(l("Beban operasional", "Operating expenses"), data.expense)}
              {totalRow(l("Laba usaha", "Operating profit"), data.operatingProfit)}
              {section(l("Pendapatan lain-lain", "Other income"), data.otherIncome)}
              {section(l("Beban lain-lain", "Other expenses"), data.otherExpense)}
              {totalRow(l("Laba bersih", "Net profit"), data.netProfit)}
            </tbody>
          </table>
        </div>
      )}

      {data && tab === "balance-sheet" && (
        <div className="table-wrap report">
          {!data.balanced && (
            <p className="error">{l("Neraca tidak seimbang!", "Balance sheet does not balance!")}</p>
          )}
          <table>
            <tbody>
              {section(l("Aset", "Assets"), data.assets)}
              {section(l("Liabilitas", "Liabilities"), data.liabilities)}
              {section(l("Ekuitas", "Equity"), data.equity)}
              {totalRow(
                l("Total liabilitas dan ekuitas", "Total liabilities and equity"),
                data.totalLiabilitiesAndEquity,
              )}
            </tbody>
          </table>
        </div>
      )}

      {data && tab === "trial-balance" && (
        <div className="table-wrap report">
          <table>
            <thead>
              <tr>
                <th>{l("Akun", "Account")}</th>
                <th className="num">{l("Saldo awal", "Opening")}</th>
                <th className="num">{l("Debit", "Debit")}</th>
                <th className="num">{l("Kredit", "Credit")}</th>
                <th className="num">{l("Saldo akhir", "Closing")}</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map(
                (
                  x: {
                    accountId: string;
                    code: string;
                    name: string;
                    opening: string;
                    debit: string;
                    credit: string;
                    closing: string;
                  },
                  i: number,
                ) => (
                  <tr key={`${x.accountId}-${i}`}>
                    <td>
                      {x.accountId ? (
                        <button
                          className="link"
                          onClick={() => {
                            set({ accountId: x.accountId });
                            setTab("general-ledger");
                          }}
                        >
                          {x.code} {x.name}
                        </button>
                      ) : (
                        x.name
                      )}
                    </td>
                    <td className="num">{m(x.opening)}</td>
                    <td className="num">{m(x.debit)}</td>
                    <td className="num">{m(x.credit)}</td>
                    <td className="num">{m(x.closing)}</td>
                  </tr>
                ),
              )}
            </tbody>
            <tfoot>
              <tr className="grand">
                <td>{l("Total", "Total")}</td>
                <td className="num">{m(data.totals.opening)}</td>
                <td className="num">{m(data.totals.debit)}</td>
                <td className="num">{m(data.totals.credit)}</td>
                <td className="num">{m(data.totals.closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {data && tab === "general-ledger" && (
        <div className="table-wrap report">
          <table>
            <thead>
              <tr>
                <th>{l("Tanggal", "Date")}</th>
                <th>{l("Entri", "Entry")}</th>
                <th>{l("Partner", "Partner")}</th>
                <th>{l("Keterangan", "Label")}</th>
                <th className="num">{l("Debit", "Debit")}</th>
                <th className="num">{l("Kredit", "Credit")}</th>
                <th className="num">{l("Saldo", "Balance")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="section">
                <td colSpan={6}>{l("Saldo awal", "Opening balance")}</td>
                <td className="num">{m(data.opening)}</td>
              </tr>
              {data.lines.map(
                (x: {
                  id: string;
                  move_id: string;
                  date: string;
                  move_name: string;
                  partner: string | null;
                  label: string | null;
                  ref: string | null;
                  debit: string;
                  credit: string;
                  balance: string;
                }) => (
                  <tr key={x.id}>
                    <td>{formatDate(x.date, locale)}</td>
                    <td>
                      <Link href={`/accounting/moves/${x.move_id}`}>{x.move_name}</Link>
                    </td>
                    <td>{x.partner}</td>
                    <td>{x.label ?? x.ref}</td>
                    <td className="num">{Number(x.debit) ? m(x.debit) : ""}</td>
                    <td className="num">{Number(x.credit) ? m(x.credit) : ""}</td>
                    <td className="num">{m(x.balance)}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      {data && tab === "branch-clearing" && (
        <div className="table-wrap report">
          <table>
            <caption>
              {data.balanced ? (
                <span className="success">
                  {l("Semua rekening antar kantor saling hapus.", "All inter-office accounts net to zero.")}
                </span>
              ) : (
                <span className="error">
                  {l(
                    "Rekening antar kantor belum saling hapus — ada transaksi pusat/cabang yang belum dicatat pasangannya.",
                    "Inter-office accounts do not net to zero — some head office/branch entries lack their counterpart.",
                  )}
                </span>
              )}
            </caption>
            <thead>
              <tr>
                <th>{l("Akun", "Account")}</th>
                <th>{l("Cabang", "Branch")}</th>
                <th className="num">{l("Saldo", "Balance")}</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map(
                (a: {
                  accountId: string;
                  code: string;
                  name: string;
                  total: string;
                  branches: { branchId: string | null; branch: string; balance: string }[];
                }) => (
                  <Fragment key={a.accountId}>
                    {a.branches.map((b) => (
                      <tr key={b.branchId ?? "hq"}>
                        <td>
                          <span className="muted">{a.code}</span> {a.name}
                        </td>
                        <td>
                          {b.branchId
                            ? b.branch
                            : l("Kantor pusat (tanpa cabang)", "Head office (no branch)")}
                        </td>
                        <td className="num">{m(b.balance)}</td>
                      </tr>
                    ))}
                    <tr className="subtotal">
                      <td colSpan={2}>{l("Selisih (harus nol)", "Difference (should be zero)")}</td>
                      <td className={`num ${Number(a.total) ? "error" : ""}`}>{m(a.total)}</td>
                    </tr>
                  </Fragment>
                ),
              )}
              {data.accounts.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    {l(
                      "Belum ada saldo pada akun RK (tandai akun sebagai rekening antar kantor di Bagan Akun).",
                      "No balances on inter-office accounts (flag accounts as branch clearing in the Chart of Accounts).",
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data && tab === "aged" && (
        <div className="table-wrap report">
          <table>
            <thead>
              <tr>
                <th>{l("Partner", "Partner")}</th>
                <th className="num">{l("Belum jatuh tempo", "Not due")}</th>
                <th className="num">1–30</th>
                <th className="num">31–60</th>
                <th className="num">61–90</th>
                <th className="num">&gt; 90</th>
                <th className="num">{l("Total", "Total")}</th>
              </tr>
            </thead>
            <tbody>
              {[...data.partners, { partner: l("Total", "Total"), ...data.totals, isTotal: true }].map(
                (p: Record<string, string> & { isTotal?: boolean }, i: number) => (
                  <Fragment key={i}>
                    <tr className={p.isTotal ? "grand" : ""}>
                      <td>{p.partner}</td>
                      {["current", "d1_30", "d31_60", "d61_90", "over90", "total"].map((k) => (
                        <td key={k} className="num">
                          {Number(p[k]) ? m(p[k]!) : ""}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
