"use client";

import { BALANCE_SHEET_GROUPS, PROFIT_LOSS_GROUPS, PROFIT_LOSS_TYPES } from "@erp/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import { download } from "../../../../components/accounting/download";
import { useOptions, type AccountOption } from "../../../../components/accounting/use-options";
import { DrillAmount, DrilldownPanel, type DrilldownRequest } from "../../../../components/drilldown-panel";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

const TABS = [
  "trial-balance",
  "profit-loss",
  "balance-sheet",
  "cash-flow",
  "general-ledger",
  "aged",
  "branch-clearing",
] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: string | null): v is Tab => !!v && (TABS as readonly string[]).includes(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
interface CashFlowLine {
  key: string;
  code?: string;
  label: string;
  amount: string;
}
interface CashFlow {
  dateFrom: string;
  dateTo: string;
  operating: { lines: CashFlowLine[]; total: string };
  investing: { lines: CashFlowLine[]; total: string };
  financing: { lines: CashFlowLine[]; total: string };
  netChange: string;
  cashOpening: string;
  cashClosing: string;
  difference: string;
}
/** Tanggal yang sama setahun sebelumnya (29 Feb → 28 Feb). */
const lastYear = (d: string) => {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
};
interface Section {
  accounts: { accountId: string; code: string; name: string; amount: string }[];
  total: string;
}

/** Laporan per tanggal (tanpa tanggal awal). */
const POINT_IN_TIME: Tab[] = ["balance-sheet", "aged", "branch-clearing"];
const yearStart = () => `${new Date().getFullYear()}-01-01`;

export default function ReportsPage() {
  return (
    <Suspense>
      <ReportsView />
    </Suspense>
  );
}

/** Filter laporan disimpan di URL agar bisa dibagikan & tetap saat kembali dari dokumen sumber. */
function ReportsView() {
  const me = useMe();
  const router = useRouter();
  const search = useSearchParams();
  const fromUrl = (q: URLSearchParams | ReturnType<typeof useSearchParams>) => {
    const param = (k: string) => q.get(k) ?? "";
    const dateParam = (k: string, fallback: string) => (DATE.test(param(k)) ? param(k) : fallback);
    const companies = param("companyIds")
      .split(",")
      .filter((c) => me.companies.some((x) => x.id === c));
    const t = q.get("tab");
    return {
      tab: isTab(t) ? t : ("profit-loss" as Tab),
      filters: {
        dateFrom: dateParam("dateFrom", yearStart()),
        dateTo: dateParam("dateTo", today()),
        branchId: param("branchId"),
        businessUnitId: param("businessUnitId"),
        costCenterId: param("costCenterId"),
        profitCenterId: param("profitCenterId"),
        accountId: param("accountId"),
        type: param("type") === "payable" ? "payable" : "receivable",
        companyIds: companies.length ? companies : [me.activeCompanyId],
      },
    };
  };
  const { l, locale } = useI18n();
  const accounts = useOptions<AccountOption>("/accounts");
  const branches = useOptions<{ id: string; name: string }>("/branches");
  const units = useOptions<{ id: string; name: string }>("/business-units");
  const costCenters = useOptions<{ id: string; code: string; name: string }>("/cost-centers");
  const profitCenters = useOptions<{ id: string; code: string; name: string }>("/profit-centers");
  const [tab, setTab] = useState<Tab>(() => fromUrl(search).tab);
  const [filters, setFilters] = useState(() => fromUrl(search).filters);
  // URL terakhir yang ditulis halaman ini; URL lain = navigasi dari luar (mis. "Buka di Buku Besar").
  const written = useRef("");
  useEffect(() => {
    if (!written.current || search.toString() === written.current) return;
    const next = fromUrl(search);
    setTab(next.tab);
    setFilters(next.filters);
  }, [search]);
  const [drill, setDrill] = useState<DrilldownRequest | null>(null);
  // Ponsel: panel filter bisa dilipat agar laporan langsung terlihat (layar lebar selalu terbuka).
  const [showFilters, setShowFilters] = useState(false);
  const activeFilters = [
    filters.branchId,
    filters.businessUnitId,
    filters.costCenterId,
    filters.profitCenterId,
  ].filter(Boolean).length;
  // Data disimpan bersama tab asalnya agar tab baru tidak merender data tab lama selama memuat.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<{ tab: Tab; data: any } | null>(null);
  const data = result?.tab === tab ? result.data : null;
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [previous, setPrevious] = useState<CashFlow | null>(null);

  const queryString = () => {
    const params = new URLSearchParams({ dateTo: filters.dateTo, companyIds: filters.companyIds.join(",") });
    if (!POINT_IN_TIME.includes(tab)) params.set("dateFrom", filters.dateFrom);
    if (filters.branchId) params.set("branchId", filters.branchId);
    if (filters.businessUnitId) params.set("businessUnitId", filters.businessUnitId);
    if (filters.costCenterId) params.set("costCenterId", filters.costCenterId);
    if (filters.profitCenterId) params.set("profitCenterId", filters.profitCenterId);
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
    if (filters.costCenterId) params.set("costCenterId", filters.costCenterId);
    if (filters.profitCenterId) params.set("profitCenterId", filters.profitCenterId);
    if (tab === "general-ledger") params.set("accountId", filters.accountId);
    if (tab === "aged") params.set("type", filters.type);
    // Simpan tab & filter di URL (tanpa menambah riwayat).
    const url = new URLSearchParams(params);
    url.set("tab", tab);
    if (POINT_IN_TIME.includes(tab)) url.set("dateFrom", filters.dateFrom);
    if (filters.accountId) url.set("accountId", filters.accountId);
    if (filters.type !== "receivable") url.set("type", filters.type);
    written.current = url.toString();
    router.replace(`?${url}`, { scroll: false });
    setError(null);
    setPrevious(null);
    if (tab === "cash-flow" && compare) {
      const prev = new URLSearchParams(params);
      prev.set("dateFrom", lastYear(filters.dateFrom));
      prev.set("dateTo", lastYear(filters.dateTo));
      api<CashFlow>(`/reports/cash-flow?${prev}`).then(setPrevious, () => setPrevious(null));
    }
    api(`/reports/${tab}?${params}`)
      .then((d) => setResult({ tab, data: d }))
      .catch((e: Error) => {
        setResult(null);
        setError(e.message);
      });
  }, [tab, filters, compare]);

  const m = (v: string | number) => money(v, locale);
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch }));

  // ---- Drilldown: filter laporan + filter angka yang diklik ----
  const dims = {
    companyIds: filters.companyIds.join(","),
    branchId: filters.branchId,
    businessUnitId: filters.businessUnitId,
    costCenterId: filters.costCenterId,
    profitCenterId: filters.profitCenterId,
  };
  const period = { ...dims, dateFrom: filters.dateFrom, dateTo: filters.dateTo, basis: "range" };
  const open = (title: string, params: DrilldownRequest["params"], mode?: DrilldownRequest["mode"]) =>
    setDrill({ title, params, mode });
  /** Drilldown laba rugi: per akun atau per kelompok jenis akun. */
  const plDrill = (title: string, target: { accountId?: string; types?: readonly string[] }) => () =>
    open(title, {
      ...period,
      excludeClosing: true,
      accountId: target.accountId,
      accountTypes: target.types?.join(","),
    });
  const bsDrill = (title: string, target: { accountId?: string; types?: readonly string[] }) => () =>
    open(title, {
      ...dims,
      dateTo: filters.dateTo,
      basis: "cumulative",
      accountId: target.accountId,
      accountTypes: target.types?.join(","),
    });
  const tabs: [Tab, string][] = [
    ["profit-loss", l("Laba Rugi", "Profit & Loss")],
    ["balance-sheet", l("Neraca", "Balance Sheet")],
    ["cash-flow", l("Arus Kas", "Cash Flow")],
    ["trial-balance", l("Neraca Saldo", "Trial Balance")],
    ["general-ledger", l("Buku Besar", "General Ledger")],
    ["aged", l("Umur Piutang/Utang", "Aged Balances")],
    ["branch-clearing", l("RK Pusat–Cabang", "Branch Clearing")],
  ];

  type DrillFor = (title: string, target: { accountId?: string; types?: readonly string[] }) => () => void;
  /** Bagian laporan; angka akun & total bisa diklik untuk melihat item jurnal penyusunnya. */
  const section = (
    title: string,
    s: Section,
    drillFor?: DrillFor,
    types?: readonly string[],
    extra?: (a: Section["accounts"][number]) => (() => void) | undefined,
  ) => (
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
          <td className="num">
            <DrillAmount
              value={m(a.amount)}
              onDrill={
                a.accountId && drillFor
                  ? drillFor(`${a.code} ${a.name}`, { accountId: a.accountId })
                  : extra?.(a)
              }
            />
          </td>
        </tr>
      ))}
      <tr className="subtotal">
        <td>
          {l("Total", "Total")} {title.toLowerCase()}
        </td>
        <td className="num">
          <DrillAmount
            value={m(s.total)}
            onDrill={drillFor && types ? drillFor(title, { types }) : undefined}
          />
        </td>
      </tr>
    </>
  );
  const totalRow = (label: string, value: string, onDrill?: () => void) => (
    <tr className="grand">
      <td>{label}</td>
      <td className="num">
        <DrillAmount value={m(value)} onDrill={onDrill} />
      </td>
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
      <button
        type="button"
        className="filters-toggle no-print"
        aria-expanded={showFilters}
        onClick={() => setShowFilters((v) => !v)}
      >
        {l("Filter", "Filters")}
        {activeFilters > 0 && <span className="badge">{activeFilters}</span>}
        <span aria-hidden>{showFilters ? "▴" : "▾"}</span>
      </button>
      <div className={`panel filters no-print${showFilters ? "" : " collapsed"}`}>
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
        {costCenters.length > 0 && (
          <label className="field">
            <span>{l("Cost center", "Cost center")}</span>
            <select value={filters.costCenterId} onChange={(e) => set({ costCenterId: e.target.value })}>
              <option value="">{l("Semua", "All")}</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {profitCenters.length > 0 && (
          <label className="field">
            <span>{l("Profit center", "Profit center")}</span>
            <select value={filters.profitCenterId} onChange={(e) => set({ profitCenterId: e.target.value })}>
              <option value="">{l("Semua", "All")}</option>
              {profitCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
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
              {section(l("Pendapatan", "Income"), data.income, plDrill, PROFIT_LOSS_GROUPS.income)}
              {section(
                l("Harga pokok penjualan", "Cost of revenue"),
                data.directCost,
                plDrill,
                PROFIT_LOSS_GROUPS.directCost,
              )}
              {totalRow(
                l("Laba kotor", "Gross profit"),
                data.grossProfit,
                plDrill(l("Laba kotor", "Gross profit"), {
                  types: [...PROFIT_LOSS_GROUPS.income, ...PROFIT_LOSS_GROUPS.directCost],
                }),
              )}
              {section(
                l("Beban operasional", "Operating expenses"),
                data.expense,
                plDrill,
                PROFIT_LOSS_GROUPS.expense,
              )}
              {totalRow(
                l("Laba usaha", "Operating profit"),
                data.operatingProfit,
                plDrill(l("Laba usaha", "Operating profit"), {
                  types: [
                    ...PROFIT_LOSS_GROUPS.income,
                    ...PROFIT_LOSS_GROUPS.directCost,
                    ...PROFIT_LOSS_GROUPS.expense,
                  ],
                }),
              )}
              {section(
                l("Pendapatan lain-lain", "Other income"),
                data.otherIncome,
                plDrill,
                PROFIT_LOSS_GROUPS.otherIncome,
              )}
              {section(
                l("Beban lain-lain", "Other expenses"),
                data.otherExpense,
                plDrill,
                PROFIT_LOSS_GROUPS.otherExpense,
              )}
              {totalRow(
                l("Laba bersih", "Net profit"),
                data.netProfit,
                plDrill(l("Laba bersih", "Net profit"), { types: PROFIT_LOSS_TYPES }),
              )}
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
              {section(l("Aset", "Assets"), data.assets, bsDrill, BALANCE_SHEET_GROUPS.asset)}
              {section(
                l("Liabilitas", "Liabilities"),
                data.liabilities,
                bsDrill,
                BALANCE_SHEET_GROUPS.liability,
              )}
              {section(l("Ekuitas", "Equity"), data.equity, bsDrill, undefined, (a) =>
                // Laba tahun berjalan: item akun laba rugi sejak awal tahun fiskal.
                a.name === "Laba/rugi tahun berjalan"
                  ? () =>
                      open(l("Laba/rugi tahun berjalan", "Current year earnings"), {
                        ...dims,
                        dateFrom: data.fiscalYearStart,
                        dateTo: filters.dateTo,
                        basis: "range",
                        accountTypes: PROFIT_LOSS_TYPES.join(","),
                      })
                  : undefined,
              )}
              {totalRow(
                l("Total liabilitas dan ekuitas", "Total liabilities and equity"),
                data.totalLiabilitiesAndEquity,
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "cash-flow" && (
        <label className="check no-print">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
          {l("Bandingkan dengan periode yang sama tahun lalu", "Compare with the same period last year")}
        </label>
      )}
      {data && tab === "cash-flow" && (
        <CashFlowTable
          data={data as CashFlow}
          previous={compare ? previous : null}
          onDrill={(line, title) => {
            const types =
              line.key === "net_profit"
                ? PROFIT_LOSS_TYPES
                : line.key === "depreciation"
                  ? ["expense_depreciation"]
                  : null;
            if (!line.code && !types) return undefined;
            return () =>
              open(title, {
                ...period,
                excludeClosing: true,
                accountId: line.code ? line.key : undefined,
                accountTypes: types?.join(","),
              });
          }}
        />
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
                    {(
                      [
                        ["opening", { basis: "opening" }],
                        ["debit", { side: "debit" }],
                        ["credit", { side: "credit" }],
                        ["closing", { basis: "cumulative" }],
                      ] as const
                    ).map(([k, extra]) => (
                      <td key={k} className="num">
                        <DrillAmount
                          value={m(x[k])}
                          onDrill={
                            x.accountId && Number(x[k])
                              ? () =>
                                  open(`${x.code} ${x.name}`, { ...period, accountId: x.accountId, ...extra })
                              : undefined
                          }
                        />
                      </td>
                    ))}
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
                        <td className="num">
                          <DrillAmount
                            value={m(b.balance)}
                            onDrill={
                              b.branchId
                                ? () =>
                                    open(`${a.code} ${a.name} · ${b.branch}`, {
                                      companyIds: dims.companyIds,
                                      dateTo: filters.dateTo,
                                      basis: "cumulative",
                                      accountId: a.accountId,
                                      branchId: b.branchId,
                                    })
                                : undefined
                            }
                          />
                        </td>
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
                          {Number(p[k]) ? (
                            <DrillAmount
                              value={m(p[k]!)}
                              onDrill={() =>
                                open(
                                  p.isTotal ? l("Umur piutang/utang", "Aged balances") : p.partner!,
                                  {
                                    ...dims,
                                    dateTo: filters.dateTo,
                                    openOnly: true,
                                    type: filters.type,
                                    bucket: k === "total" ? undefined : k,
                                    partnerId: p.isTotal ? undefined : p.partnerId || undefined,
                                    noPartner: !p.isTotal && !p.partnerId ? true : undefined,
                                  },
                                  "residual",
                                )
                              }
                            />
                          ) : (
                            ""
                          )}
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
      <DrilldownPanel request={drill} onClose={() => setDrill(null)} />
    </>
  );
}

function CashFlowTable({
  data,
  previous,
  onDrill,
}: {
  data: CashFlow;
  previous: CashFlow | null;
  onDrill?: (line: CashFlowLine, title: string) => (() => void) | undefined;
}) {
  const { l, locale } = useI18n();
  const m = (v: string | number | undefined) => (v === undefined ? "—" : money(v, locale));
  const label = (line: CashFlowLine) =>
    line.key === "net_profit"
      ? l("Laba bersih", "Net profit")
      : line.key === "depreciation"
        ? l("Penyusutan & amortisasi", "Depreciation & amortization")
        : line.key === "depreciation_offset"
          ? l("Dikurangi: penyusutan (non-kas)", "Less: depreciation (non-cash)")
          : line.label;
  const prevLine = (section: "operating" | "investing" | "financing", key: string) =>
    previous?.[section].lines.find((x) => x.key === key)?.amount ?? (previous ? "0" : undefined);
  const block = (section: "operating" | "investing" | "financing", title: string, totalLabel: string) => {
    // Gabungkan baris periode ini & pembanding (akun yang hanya ada di salah satu tetap tampil).
    const lines = [...data[section].lines];
    for (const p of previous?.[section].lines ?? []) {
      if (!lines.some((x) => x.key === p.key)) lines.push({ ...p, amount: "0" });
    }
    return (
      <Fragment key={section}>
        <tr className="section">
          <th colSpan={previous ? 3 : 2}>{title}</th>
        </tr>
        {lines.map((line) => (
          <tr key={line.key}>
            <td>
              {line.code && <span className="muted">{line.code} </span>}
              {line.code ? `${l("Perubahan", "Change in")} ${line.label}` : label(line)}
            </td>
            <td className="num">
              <DrillAmount
                value={m(line.amount)}
                onDrill={onDrill?.(line, line.code ? `${line.code} ${line.label}` : label(line))}
              />
            </td>
            {previous && <td className="num">{m(prevLine(section, line.key))}</td>}
          </tr>
        ))}
        <tr className="subtotal">
          <td>{totalLabel}</td>
          <td className="num">{m(data[section].total)}</td>
          {previous && <td className="num">{m(previous[section].total)}</td>}
        </tr>
      </Fragment>
    );
  };
  const row = (text: string, key: "netChange" | "cashOpening" | "cashClosing", grand = false) => (
    <tr className={grand ? "grand" : undefined}>
      <td>{text}</td>
      <td className="num">{m(data[key])}</td>
      {previous && <td className="num">{m(previous[key])}</td>}
    </tr>
  );
  return (
    <div className="table-wrap report">
      {Number(data.difference) !== 0 && (
        <p className="error">
          {l(
            `Ada selisih ${money(data.difference, locale)} yang belum terklasifikasi. Periksa kelompok arus kas akun di Bagan Akun.`,
            `There is an unclassified difference of ${money(data.difference, locale)}. Check the accounts' cash flow category in the Chart of Accounts.`,
          )}
        </p>
      )}
      <table>
        {previous && (
          <thead>
            <tr>
              <th />
              <th className="num">
                {formatDate(data.dateFrom, locale)} – {formatDate(data.dateTo, locale)}
              </th>
              <th className="num">
                {formatDate(previous.dateFrom, locale)} – {formatDate(previous.dateTo, locale)}
              </th>
            </tr>
          </thead>
        )}
        <tbody>
          {block(
            "operating",
            l("Arus kas dari aktivitas operasi", "Cash flows from operating activities"),
            l("Arus kas neto dari aktivitas operasi", "Net cash from operating activities"),
          )}
          {block(
            "investing",
            l("Arus kas dari aktivitas investasi", "Cash flows from investing activities"),
            l("Arus kas neto dari aktivitas investasi", "Net cash from investing activities"),
          )}
          {block(
            "financing",
            l("Arus kas dari aktivitas pendanaan", "Cash flows from financing activities"),
            l("Arus kas neto dari aktivitas pendanaan", "Net cash from financing activities"),
          )}
          {row(
            l("Kenaikan (penurunan) neto kas & setara kas", "Net increase (decrease) in cash"),
            "netChange",
            true,
          )}
          {row(l("Kas & setara kas awal periode", "Cash at beginning of period"), "cashOpening")}
          {row(l("Kas & setara kas akhir periode", "Cash at end of period"), "cashClosing", true)}
        </tbody>
      </table>
      <p className="muted">
        {l(
          "Metode tidak langsung. Kelompok tiap akun mengikuti jenis akun; ubah di Bagan Akun (kolom Kelompok arus kas) bila perlu.",
          "Indirect method. Each account's group follows its account type; override it in the Chart of Accounts (Cash flow group) if needed.",
        )}
      </p>
    </div>
  );
}
