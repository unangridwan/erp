"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "../../../../../components/me-context";
import { api } from "../../../../../lib/api";
import { download } from "../../../../../lib/download";
import { formatDate, money } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";

interface Entity {
  companyId: string;
  name: string;
  code: string;
  method: "full" | "proportional" | "equity";
  directPct: string;
  effectivePct: string;
  currencyCode: string;
  closingRate: string;
  averageRate: string;
  historicalRate: string;
}
interface EntryLine {
  groupAccountId: string;
  companyId: string | null;
  amount: string;
  code: string;
  name: string;
}
interface Entry {
  id: string;
  kind: string;
  description: string;
  companyId: string | null;
  lines: EntryLine[];
}
interface Run {
  id: string;
  name: string;
  state: "draft" | "final";
  dateFrom: string;
  dateTo: string;
  currencyCode: string;
  warnings: string[];
  computedAt: string | null;
  entities: Entity[];
  entries: Entry[];
}
interface WsRow {
  groupAccountId: string;
  code: string;
  name: string;
  byCompany: Record<string, string>;
  total: string;
  adjustments: string;
  consolidated: string;
}
interface Worksheet {
  columns: { companyId: string; name: string }[];
  rows: WsRow[];
}
interface Section {
  accounts: { code: string; name: string; amount: string }[];
  total: string;
}
interface Report {
  profitLoss: {
    income: Section;
    directCost: Section;
    expense: Section;
    otherIncome: Section;
    otherExpense: Section;
    grossProfit: string;
    operatingProfit: string;
    netProfit: string;
    attributableToOwners: string;
    attributableToNci: string;
  };
  balanceSheet: {
    assets: Section;
    liabilities: Section;
    equity: Section;
    nonControllingInterest: string;
    totalEquity: string;
    totalLiabilitiesEquity: string;
    difference: string;
  };
}
interface IcPair {
  companyAName: string;
  companyBName: string;
  balanceA: string;
  balanceB: string;
  difference: string;
}

const TABS = ["report", "worksheet", "entries", "intercompany", "entities"] as const;
type Tab = (typeof TABS)[number];

export default function ConsolidationRunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const me = useMe();
  const { l, locale } = useI18n();
  const [run, setRun] = useState<Run | null>(null);
  const [tab, setTab] = useState<Tab>("report");
  const [report, setReport] = useState<Report | null>(null);
  const [ws, setWs] = useState<Worksheet | null>(null);
  const [ic, setIc] = useState<{ balances: IcPair[]; transactions: IcPair[] } | null>(null);
  const [rates, setRates] = useState<
    Record<string, { closingRate: string; averageRate: string; historicalRate: string }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const manage = can(me.permissions, "consolidation.manage") && run?.state === "draft";
  const m = (v: string | number) => money(v, locale);

  const load = useCallback(async () => {
    const [r, rep, w] = await Promise.all([
      api<Run>(`/consolidation/runs/${id}`),
      api<Report>(`/consolidation/runs/${id}/report`),
      api<Worksheet>(`/consolidation/runs/${id}/worksheet`),
    ]);
    setRun(r);
    setReport(rep);
    setWs(w);
    setRates(
      Object.fromEntries(
        r.entities.map((e) => [
          e.companyId,
          {
            closingRate: String(Number(e.closingRate)),
            averageRate: String(Number(e.averageRate)),
            historicalRate: String(Number(e.historicalRate)),
          },
        ]),
      ),
    );
  }, [id]);
  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);
  useEffect(() => {
    if (tab === "intercompany" && !ic)
      api<{ balances: IcPair[]; transactions: IcPair[] }>(`/consolidation/runs/${id}/intercompany`)
        .then(setIc)
        .catch((e: Error) => setError(e.message));
  }, [tab, ic, id]);

  async function run_(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      setIc(null);
      await load();
    } catch (e) {
      const body = (e as { body?: { errors?: { path: string; message: string }[] } }).body;
      const details = (body?.errors ?? []).map((x) => `${x.path}: ${x.message}`).join("; ");
      setError(`${e instanceof Error ? e.message : String(e)}${details ? ` — ${details}` : ""}`);
    } finally {
      setBusy(false);
    }
  }

  if (!run) return error ? <p className="error">{error}</p> : <p className="muted">…</p>;
  const name = (companyId: string | null) =>
    companyId ? (run.entities.find((e) => e.companyId === companyId)?.name ?? "") : l("(grup)", "(group)");
  const KIND: Record<string, string> = {
    investment: l("Eliminasi investasi", "Investment elimination"),
    nci_profit: l("Bagian laba KNP", "NCI share of profit"),
    intercompany: l("Antar perusahaan", "Intercompany"),
    equity_method: l("Metode ekuitas", "Equity method"),
    translation: l("Translasi", "Translation"),
    manual: l("Manual", "Manual"),
  };

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <nav className="breadcrumb">
            <Link href="/consolidation/runs">{l("Konsolidasi", "Consolidation")}</Link>
            <span>/</span>
            <h1>{run.name}</h1>
          </nav>
          <span className={`badge ${run.state === "final" ? "state-posted" : "state-draft"}`}>
            {run.state === "final" ? l("Final", "Final") : l("Draft", "Draft")}
          </span>
        </div>
        <div className="cp-right">
          <button
            onClick={() =>
              download(`/consolidation/runs/${id}/worksheet?format=csv`, undefined, "kertas-kerja.csv").catch(
                (e: Error) => setError(e.message),
              )
            }
          >
            {l("Unduh kertas kerja (CSV)", "Download worksheet (CSV)")}
          </button>
          {manage && (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  run_(() =>
                    api(`/consolidation/runs/${id}/compute`, {
                      method: "POST",
                      body: { rates: Object.entries(rates).map(([companyId, r]) => ({ companyId, ...r })) },
                    }),
                  )
                }
              >
                {busy ? l("Menghitung…", "Computing…") : l("Hitung ulang", "Recompute")}
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      l("Finalkan? Proses tidak bisa diubah lagi.", "Finalize? The run will be locked."),
                    )
                  )
                    void run_(() => api(`/consolidation/runs/${id}/finalize`, { method: "POST" }));
                }}
              >
                {l("Finalkan", "Finalize")}
              </button>
              <button
                className="danger"
                onClick={async () => {
                  if (!window.confirm(l("Hapus proses ini?", "Delete this run?"))) return;
                  await api(`/consolidation/runs/${id}`, { method: "DELETE" });
                  router.replace("/consolidation/runs");
                }}
              >
                {l("Hapus", "Delete")}
              </button>
            </>
          )}
        </div>
      </header>
      <p className="muted">
        {l("Periode laba rugi", "P&L period")} {formatDate(run.dateFrom, locale)} –{" "}
        {formatDate(run.dateTo, locale)} · {l("mata uang penyajian", "presentation currency")}{" "}
        {run.currencyCode}
      </p>
      {error && <p className="error">{error}</p>}
      {run.warnings.map((w) => (
        <div key={w} className="banner warn">
          ⚠ {w}
        </div>
      ))}
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {
              {
                report: l("Laporan konsolidasian", "Consolidated statements"),
                worksheet: l("Kertas kerja", "Worksheet"),
                entries: l("Jurnal eliminasi", "Elimination entries"),
                intercompany: l("Rekonsiliasi antar perusahaan", "Intercompany reconciliation"),
                entities: l("Entitas & kurs", "Entities & rates"),
              }[t]
            }
          </button>
        ))}
      </div>

      {tab === "report" && report && (
        <div className="split">
          <section className="table-wrap report">
            <table>
              <caption>
                {l("Laporan posisi keuangan konsolidasian", "Consolidated statement of financial position")}
              </caption>
              <tbody>
                <StatementSection title={l("Aset", "Assets")} section={report.balanceSheet.assets} m={m} />
                <StatementSection
                  title={l("Liabilitas", "Liabilities")}
                  section={report.balanceSheet.liabilities}
                  m={m}
                />
                <StatementSection
                  title={l(
                    "Ekuitas yang diatribusikan ke pemilik entitas induk",
                    "Equity attributable to owners of the parent",
                  )}
                  section={report.balanceSheet.equity}
                  m={m}
                />
                <tr className="subtotal">
                  <td>{l("Kepentingan non-pengendali", "Non-controlling interests")}</td>
                  <td className="num">{m(report.balanceSheet.nonControllingInterest)}</td>
                </tr>
                <tr className="subtotal">
                  <td>{l("Total ekuitas", "Total equity")}</td>
                  <td className="num">{m(report.balanceSheet.totalEquity)}</td>
                </tr>
                <tr className="grand">
                  <td>{l("Total liabilitas & ekuitas", "Total liabilities & equity")}</td>
                  <td className="num">{m(report.balanceSheet.totalLiabilitiesEquity)}</td>
                </tr>
                {Number(report.balanceSheet.difference) !== 0 && (
                  <tr>
                    <td className="error">{l("Selisih (tidak seimbang)", "Difference (unbalanced)")}</td>
                    <td className="num error">{m(report.balanceSheet.difference)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
          <section className="table-wrap report">
            <table>
              <caption>
                {l("Laporan laba rugi konsolidasian", "Consolidated statement of profit or loss")}
              </caption>
              <tbody>
                <StatementSection
                  title={l("Pendapatan", "Revenue")}
                  section={report.profitLoss.income}
                  m={m}
                />
                <StatementSection
                  title={l("Harga pokok penjualan", "Cost of revenue")}
                  section={report.profitLoss.directCost}
                  m={m}
                />
                <tr className="subtotal">
                  <td>{l("Laba kotor", "Gross profit")}</td>
                  <td className="num">{m(report.profitLoss.grossProfit)}</td>
                </tr>
                <StatementSection
                  title={l("Beban usaha", "Operating expenses")}
                  section={report.profitLoss.expense}
                  m={m}
                />
                <tr className="subtotal">
                  <td>{l("Laba usaha", "Operating profit")}</td>
                  <td className="num">{m(report.profitLoss.operatingProfit)}</td>
                </tr>
                <StatementSection
                  title={l("Pendapatan lain-lain", "Other income")}
                  section={report.profitLoss.otherIncome}
                  m={m}
                />
                <StatementSection
                  title={l("Beban lain-lain", "Other expenses")}
                  section={report.profitLoss.otherExpense}
                  m={m}
                />
                <tr className="grand">
                  <td>{l("Laba bersih", "Net profit")}</td>
                  <td className="num">{m(report.profitLoss.netProfit)}</td>
                </tr>
                <tr>
                  <td>
                    {l("Diatribusikan ke pemilik entitas induk", "Attributable to owners of the parent")}
                  </td>
                  <td className="num">{m(report.profitLoss.attributableToOwners)}</td>
                </tr>
                <tr>
                  <td>
                    {l(
                      "Diatribusikan ke kepentingan non-pengendali",
                      "Attributable to non-controlling interests",
                    )}
                  </td>
                  <td className="num">{m(report.profitLoss.attributableToNci)}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      )}

      {tab === "worksheet" && ws && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Akun grup", "Group account")}</th>
                {ws.columns.map((c) => (
                  <th key={c.companyId} className="num">
                    {c.name}
                  </th>
                ))}
                <th className="num">{l("Gabungan", "Combined")}</th>
                <th className="num">{l("Eliminasi & penyesuaian", "Eliminations")}</th>
                <th className="num">{l("Konsolidasian", "Consolidated")}</th>
              </tr>
            </thead>
            <tbody>
              {ws.rows.map((r) => (
                <tr key={r.groupAccountId}>
                  <td>
                    {r.code} {r.name}
                  </td>
                  {ws.columns.map((c) => (
                    <td key={c.companyId} className="num">
                      {r.byCompany[c.companyId] ? m(r.byCompany[c.companyId]!) : ""}
                    </td>
                  ))}
                  <td className="num">{m(r.total)}</td>
                  <td className="num">{Number(r.adjustments) ? m(r.adjustments) : ""}</td>
                  <td className="num">
                    <strong>{m(r.consolidated)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small" style={{ padding: "0 12px" }}>
            {l("Debit positif, kredit negatif, dalam", "Debit positive, credit negative, in")}{" "}
            {run.currencyCode}.
          </p>
        </div>
      )}

      {tab === "entries" && (
        <>
          {run.entries.map((e) => (
            <div key={e.id} className="table-wrap" style={{ marginBottom: 12 }}>
              <table>
                <caption>
                  <span className="badge">{KIND[e.kind] ?? e.kind}</span> {e.description}
                  {manage && e.kind === "manual" && (
                    <button
                      className="link danger"
                      onClick={() =>
                        run_(() => api(`/consolidation/runs/${id}/entries/${e.id}`, { method: "DELETE" }))
                      }
                    >
                      {" "}
                      {l("hapus", "delete")}
                    </button>
                  )}
                </caption>
                <thead>
                  <tr>
                    <th>{l("Akun grup", "Group account")}</th>
                    <th>{l("Entitas", "Entity")}</th>
                    <th className="num">Debit</th>
                    <th className="num">{l("Kredit", "Credit")}</th>
                  </tr>
                </thead>
                <tbody>
                  {e.lines.map((x, i) => (
                    <tr key={i}>
                      <td>
                        {x.code} {x.name}
                      </td>
                      <td>{name(x.companyId)}</td>
                      <td className="num">{Number(x.amount) > 0 ? m(x.amount) : ""}</td>
                      <td className="num">{Number(x.amount) < 0 ? m(-Number(x.amount)) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {run.entries.length === 0 && (
            <p className="muted">{l("Tidak ada jurnal eliminasi.", "No elimination entries.")}</p>
          )}
          {manage && ws && (
            <ManualEntry
              runId={id}
              entities={run.entities}
              accounts={ws.rows}
              onSaved={() => run_(async () => undefined)}
            />
          )}
        </>
      )}

      {tab === "intercompany" && ic && (
        <div className="split">
          {(["balances", "transactions"] as const).map((k) => (
            <section key={k} className="table-wrap">
              <table>
                <caption>
                  {k === "balances"
                    ? l("Saldo piutang/utang antar perusahaan", "Intercompany balances")
                    : l("Transaksi pendapatan/beban antar perusahaan", "Intercompany income/expense")}
                </caption>
                <thead>
                  <tr>
                    <th>{l("Perusahaan A", "Company A")}</th>
                    <th>{l("Perusahaan B", "Company B")}</th>
                    <th className="num">{l("Saldo A", "A balance")}</th>
                    <th className="num">{l("Saldo B", "B balance")}</th>
                    <th className="num">{l("Selisih", "Difference")}</th>
                  </tr>
                </thead>
                <tbody>
                  {ic[k].map((p) => (
                    <tr key={p.companyAName + p.companyBName}>
                      <td>{p.companyAName}</td>
                      <td>{p.companyBName}</td>
                      <td className="num">{m(p.balanceA)}</td>
                      <td className="num">{m(p.balanceB)}</td>
                      <td className={`num ${Number(p.difference) ? "error" : ""}`}>{m(p.difference)}</td>
                    </tr>
                  ))}
                  {ic[k].length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        {l("Tidak ada saldo antar perusahaan.", "No intercompany balances.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

      {tab === "entities" && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Entitas", "Entity")}</th>
                <th>{l("Metode", "Method")}</th>
                <th className="num">{l("Langsung %", "Direct %")}</th>
                <th className="num">{l("Efektif %", "Effective %")}</th>
                <th>{l("Mata uang", "Currency")}</th>
                <th className="num">{l("Kurs penutupan", "Closing rate")}</th>
                <th className="num">{l("Kurs rata-rata", "Average rate")}</th>
                <th className="num">{l("Kurs historis (ekuitas)", "Historical rate (equity)")}</th>
              </tr>
            </thead>
            <tbody>
              {run.entities.map((e) => {
                const foreign = e.currencyCode !== run.currencyCode;
                const rate = (k: "closingRate" | "averageRate" | "historicalRate") =>
                  manage && foreign ? (
                    <input
                      className="num"
                      value={rates[e.companyId]?.[k] ?? ""}
                      onChange={(ev) =>
                        setRates((r) => ({
                          ...r,
                          [e.companyId]: { ...r[e.companyId]!, [k]: ev.target.value },
                        }))
                      }
                    />
                  ) : (
                    Number(e[k]).toString()
                  );
                return (
                  <tr key={e.companyId}>
                    <td>
                      {e.code} — {e.name}
                    </td>
                    <td>
                      {
                        {
                          full: l("Penuh", "Full"),
                          proportional: l("Proporsional", "Proportional"),
                          equity: l("Ekuitas", "Equity method"),
                        }[e.method]
                      }
                    </td>
                    <td className="num">{Number(e.directPct)}</td>
                    <td className="num">{Number(e.effectivePct)}</td>
                    <td>{e.currencyCode}</td>
                    <td className="num">{rate("closingRate")}</td>
                    <td className="num">{rate("averageRate")}</td>
                    <td className="num">{rate("historicalRate")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {manage && (
            <p className="muted small" style={{ padding: "0 12px" }}>
              {l("Ubah kurs lalu klik Hitung ulang.", "Edit rates, then click Recompute.")}
            </p>
          )}
        </div>
      )}
    </>
  );
}

function StatementSection({
  title,
  section,
  m,
}: {
  title: string;
  section: Section;
  m: (v: string) => string;
}) {
  return (
    <>
      <tr className="section">
        <th colSpan={2}>{title}</th>
      </tr>
      {section.accounts.map((a) => (
        <tr key={a.code + a.name}>
          <td>
            {a.code} {a.name}
          </td>
          <td className="num">{m(a.amount)}</td>
        </tr>
      ))}
      <tr className="subtotal">
        <td>Total {title.toLowerCase()}</td>
        <td className="num">{m(section.total)}</td>
      </tr>
    </>
  );
}

/** Jurnal penyesuaian konsolidasi manual (mis. laba belum terealisasi atas persediaan antar perusahaan). */
function ManualEntry({
  runId,
  entities,
  accounts,
  onSaved,
}: {
  runId: string;
  entities: Entity[];
  accounts: WsRow[];
  onSaved: () => void;
}) {
  const { l } = useI18n();
  const [groups, setGroups] = useState<{ id: string; code: string; name: string }[]>([]);
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState([
    { groupAccountId: "", companyId: "", debit: "", credit: "" },
    { groupAccountId: "", companyId: "", debit: "", credit: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ items: { id: string; code: string; name: string }[] }>("/group-accounts?limit=200")
      .then((d) => setGroups(d.items))
      .catch(() => setGroups(accounts.map((a) => ({ id: a.groupAccountId, code: a.code, name: a.name }))));
  }, [accounts]);
  const set = (i: number, k: keyof (typeof lines)[number], v: string) =>
    setLines((ls) => ls.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await api(`/consolidation/runs/${runId}/entries`, {
            method: "POST",
            body: {
              description,
              lines: lines
                .filter((x) => x.groupAccountId)
                .map((x) => ({
                  groupAccountId: x.groupAccountId,
                  companyId: x.companyId || null,
                  debit: x.debit || "0",
                  credit: x.credit || "0",
                })),
            },
          });
          setDescription("");
          setLines(lines.map(() => ({ groupAccountId: "", companyId: "", debit: "", credit: "" })));
          onSaved();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }}
    >
      <h2>{l("Jurnal penyesuaian manual", "Manual adjustment")}</h2>
      {error && <p className="error">{error}</p>}
      <label className="field">
        <span>{l("Keterangan", "Description")}</span>
        <input required value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <table className="lines">
        <thead>
          <tr>
            <th>{l("Akun grup", "Group account")}</th>
            <th>{l("Entitas (opsional)", "Entity (optional)")}</th>
            <th className="num">Debit</th>
            <th className="num">{l("Kredit", "Credit")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((x, i) => (
            <tr key={i}>
              <td>
                <select value={x.groupAccountId} onChange={(e) => set(i, "groupAccountId", e.target.value)}>
                  <option value="">—</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.code} {g.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select value={x.companyId} onChange={(e) => set(i, "companyId", e.target.value)}>
                  <option value="">{l("(grup)", "(group)")}</option>
                  {entities.map((en) => (
                    <option key={en.companyId} value={en.companyId}>
                      {en.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  className="num"
                  inputMode="decimal"
                  value={x.debit}
                  onChange={(e) => set(i, "debit", e.target.value)}
                />
              </td>
              <td>
                <input
                  className="num"
                  inputMode="decimal"
                  value={x.credit}
                  onChange={(e) => set(i, "credit", e.target.value)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-actions">
        <button
          type="button"
          onClick={() =>
            setLines((ls) => [...ls, { groupAccountId: "", companyId: "", debit: "", credit: "" }])
          }
        >
          {l("+ Baris", "+ Line")}
        </button>
        <button className="primary">{l("Simpan jurnal", "Save entry")}</button>
      </div>
    </form>
  );
}
