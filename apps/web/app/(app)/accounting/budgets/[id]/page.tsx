"use client";

import Link from "next/link";
import { PROFIT_LOSS_TYPES } from "@erp/shared";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { download } from "../../../../../components/accounting/download";
import { useOptions, type AccountOption } from "../../../../../components/accounting/use-options";
import {
  DrillAmount,
  DrilldownPanel,
  type DrilldownRequest,
} from "../../../../../components/drilldown-panel";
import { useMe } from "../../../../../components/me-context";
import { api, ApiError } from "../../../../../lib/api";
import { money } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";

interface BudgetLine {
  accountId: string;
  amount: string;
  businessUnitId?: string | null;
  branchId?: string | null;
  costCenterId?: string | null;
}
interface Report {
  lines: {
    id: string;
    code: string;
    name: string;
    kind: string;
    accountId: string;
    businessUnitId: string | null;
    branchId: string | null;
    costCenterId: string | null;
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
  const costCenters = useOptions<{ id: string; code: string; name: string }>("/cost-centers");
  const centerName = (cid: string | null) => {
    const c = costCenters.find((x) => x.id === cid);
    return c ? `${c.code} ${c.name}` : "";
  };
  const [header, setHeader] = useState({ name: "", ...yearRange() });
  const [lines, setLines] = useState<BudgetLine[]>([{ accountId: "", amount: "" }]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrilldownRequest | null>(null);
  const [source, setSource] = useState<"manual" | "manpower">("manual");
  const editable = can(me.permissions, "accounting.write") && source === "manual";

  useEffect(() => {
    if (isNew) return;
    api<{
      companyId: string;
      name: string;
      dateFrom: string;
      dateTo: string;
      source: "manual" | "manpower";
      lines: BudgetLine[];
    }>(`/budgets/${id}`)
      .then((b) => {
        setHeader({ name: b.name, dateFrom: b.dateFrom, dateTo: b.dateTo });
        setCompanyId(b.companyId);
        setSource(b.source);
        setLines(b.lines.map((x) => ({ ...x, amount: String(Number(x.amount)) })));
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
          .map((x) => ({
            accountId: x.accountId,
            amount: x.amount || "0",
            businessUnitId: x.businessUnitId ?? null,
            branchId: x.branchId ?? null,
            costCenterId: x.costCenterId || null,
          })),
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
        {source === "manpower" && (
          <p className="muted">
            <span className="pill ok">{l("Dikelola MPP", "Managed by MPP")}</span>{" "}
            {l(
              "Anggaran ini dibangun otomatis dari Man Power Planning yang disetujui (beban gaji & BPJS). Ubah lewat ",
              "This budget is built automatically from approved Manpower Planning (salary & BPJS expense). Change it via ",
            )}
            <Link href="/hr/manpower-plans">Man Power Planning</Link>.
          </p>
        )}
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
        <div className="table-scroll">
          <table className="lines">
            <thead>
              <tr>
                <th>{l("Akun pendapatan/beban", "Income/expense account")}</th>
                {costCenters.length > 0 && <th>{l("Cost center", "Cost center")}</th>}
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
                  {costCenters.length > 0 && (
                    <td>
                      <select
                        disabled={!editable}
                        aria-label={l("Cost center", "Cost center")}
                        value={x.costCenterId ?? ""}
                        onChange={(e) => setLine(i, { costCenterId: e.target.value || null })}
                      >
                        <option value="">{l("Semua", "All")}</option>
                        {costCenters.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code} {c.name}
                          </option>
                        ))}
                      </select>
                      {fieldErrors[`lines.${i}.costCenterId`] && (
                        <small className="error">{fieldErrors[`lines.${i}.costCenterId`]}</small>
                      )}
                    </td>
                  )}
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
        </div>
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
          <div className="table-scroll">
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
                      {x.costCenterId && <span className="muted"> · {centerName(x.costCenterId)}</span>}
                    </td>
                    <td className="num">{m(x.budget)}</td>
                    <td className="num">
                      <DrillAmount
                        value={m(x.actual)}
                        onDrill={
                          companyId
                            ? () =>
                                setDrill({
                                  title: `${x.code} ${x.name}`,
                                  params: {
                                    companyIds: companyId,
                                    accountId: x.accountId,
                                    dateFrom: header.dateFrom,
                                    dateTo: header.dateTo,
                                    basis: "range",
                                    excludeClosing: true,
                                    businessUnitId: x.businessUnitId,
                                    branchId: x.branchId,
                                    costCenterId: x.costCenterId,
                                  },
                                })
                            : undefined
                        }
                      />
                    </td>
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
          </div>
        </section>
      )}
      <DrilldownPanel request={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
