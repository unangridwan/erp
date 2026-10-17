"use client";

import { PROFIT_LOSS_TYPES } from "@erp/shared";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { download } from "../../../../../components/accounting/download";
import { useOptions, type AccountOption } from "../../../../../components/accounting/use-options";
import { useMe } from "../../../../../components/me-context";
import { api, ApiError } from "../../../../../lib/api";
import { money } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";

interface BudgetLine {
  accountId: string;
  amount: string;
}
interface Report {
  lines: {
    id: string;
    code: string;
    name: string;
    kind: string;
    budget: string;
    actual: string;
    variance: string;
    achievement: number | null;
  }[];
  totals: Record<"income" | "expense", { budget: string; actual: string; variance: string }>;
}

const yearRange = () => {
  const y = new Date().getFullYear();
  return { dateFrom: `${y}-01-01`, dateTo: `${y}-12-31` };
};

export default function BudgetPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const me = useMe();
  const { l, locale } = useI18n();
  const accounts = useOptions<AccountOption>("/accounts").filter((a) =>
    PROFIT_LOSS_TYPES.includes(a.accountType),
  );
  const [header, setHeader] = useState({ name: "", ...yearRange() });
  const [lines, setLines] = useState<BudgetLine[]>([{ accountId: "", amount: "" }]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);
  const editable = can(me.permissions, "accounting.write");

  useEffect(() => {
    if (isNew) return;
    api<{ name: string; dateFrom: string; dateTo: string; lines: BudgetLine[] }>(`/budgets/${id}`)
      .then((b) => {
        setHeader({ name: b.name, dateFrom: b.dateFrom, dateTo: b.dateTo });
        setLines(b.lines.map((x) => ({ accountId: x.accountId, amount: String(Number(x.amount)) })));
      })
      .catch((e: Error) => setError(e.message));
    api<Report>(`/reports/budget?budgetId=${id}`)
      .then(setReport)
      .catch(() => setReport(null));
  }, [id, isNew, version]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    try {
      const body = {
        ...header,
        lines: lines
          .filter((x) => x.accountId)
          .map((x) => ({ accountId: x.accountId, amount: x.amount || "0" })),
      };
      if (isNew) {
        const created = await api<{ id: string }>("/budgets", { method: "POST", body });
        router.replace(`/accounting/budgets/${created.id}`);
      } else {
        await api(`/budgets/${id}`, { method: "PATCH", body });
        setVersion((n) => n + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
    }
  }

  const m = (v: string | number) => money(v, locale);
  const setLine = (i: number, patch: Partial<BudgetLine>) =>
    setLines((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="stack-wide">
      <form className="panel" onSubmit={save}>
        <header className="toolbar">
          <h1>{isNew ? l("Anggaran baru", "New budget") : header.name}</h1>
          {editable && <button className="primary">{l("Simpan", "Save")}</button>}
        </header>
        {error && <p className="error">{error}</p>}
        <fieldset disabled={!editable} className="fields">
          <label className="field">
            <span>{l("Nama *", "Name *")}</span>
            <input
              required
              value={header.name}
              onChange={(e) => setHeader((h) => ({ ...h, name: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>{l("Dari", "From")}</span>
            <input
              type="date"
              required
              value={header.dateFrom}
              onChange={(e) => setHeader((h) => ({ ...h, dateFrom: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>{l("Sampai", "To")}</span>
            <input
              type="date"
              required
              value={header.dateTo}
              onChange={(e) => setHeader((h) => ({ ...h, dateTo: e.target.value }))}
            />
          </label>
        </fieldset>
        <h2>{l("Baris anggaran", "Budget lines")}</h2>
        <table className="lines">
          <thead>
            <tr>
              <th>{l("Akun pendapatan/beban", "Income/expense account")}</th>
              <th className="num">{l("Jumlah", "Amount")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((x, i) => (
              <tr key={i}>
                <td>
                  <select
                    disabled={!editable}
                    value={x.accountId}
                    onChange={(e) => setLine(i, { accountId: e.target.value })}
                  >
                    <option value="">—</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {a.name}
                      </option>
                    ))}
                  </select>
                  {fieldErrors[`lines.${i}.accountId`] && (
                    <small className="error">{fieldErrors[`lines.${i}.accountId`]}</small>
                  )}
                </td>
                <td>
                  <input
                    disabled={!editable}
                    className="num"
                    inputMode="decimal"
                    value={x.amount}
                    onChange={(e) => setLine(i, { amount: e.target.value })}
                  />
                </td>
                <td>
                  {editable && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => setLines((r) => r.filter((_, j) => j !== i))}
                      aria-label={l("Hapus baris", "Remove line")}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {editable && (
          <button
            type="button"
            className="link"
            onClick={() => setLines((r) => [...r, { accountId: "", amount: "" }])}
          >
            + {l("Tambah baris", "Add line")}
          </button>
        )}
      </form>

      {report && (
        <section className="panel report">
          <header className="toolbar">
            <h2>{l("Anggaran vs realisasi", "Budget vs actual")}</h2>
            <button
              onClick={() =>
                download(`/reports/budget/export?budgetId=${id}`, "anggaran.xlsx").catch((e: Error) =>
                  setError(e.message),
                )
              }
            >
              {l("Ekspor Excel", "Export Excel")}
            </button>
          </header>
          <table>
            <thead>
              <tr>
                <th>{l("Akun", "Account")}</th>
                <th className="num">{l("Anggaran", "Budget")}</th>
                <th className="num">{l("Realisasi", "Actual")}</th>
                <th className="num">{l("Selisih", "Variance")}</th>
                <th className="num">{l("Capaian", "Achieved")}</th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map((x) => (
                <tr key={x.id}>
                  <td>
                    <span className="muted">{x.code}</span> {x.name}
                  </td>
                  <td className="num">{m(x.budget)}</td>
                  <td className="num">{m(x.actual)}</td>
                  <td
                    className={`num ${(x.kind === "income" ? Number(x.variance) < 0 : Number(x.variance) > 0) ? "error" : ""}`}
                  >
                    {m(x.variance)}
                  </td>
                  <td className="num">{x.achievement === null ? "—" : `${x.achievement}%`}</td>
                </tr>
              ))}
              {(["income", "expense"] as const).map((k) => (
                <tr key={k} className="grand">
                  <td>
                    {k === "income"
                      ? l("Total pendapatan", "Total income")
                      : l("Total beban", "Total expenses")}
                  </td>
                  <td className="num">{m(report.totals[k].budget)}</td>
                  <td className="num">{m(report.totals[k].actual)}</td>
                  <td className="num">{m(report.totals[k].variance)}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
