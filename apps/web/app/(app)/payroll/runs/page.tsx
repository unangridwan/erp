"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can, PAYROLL_STATE_LABEL } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface Run {
  id: string;
  name: string;
  periodStart: string;
  paymentDate: string;
  state: string;
  kind: "regular" | "correction";
  employees: number;
  net: string;
  pph21: string;
}

export default function PayrollRunsPage() {
  const me = useMe();
  const router = useRouter();
  const { l, tx, locale } = useI18n();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [paymentDate, setPaymentDate] = useState(today());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Run[]>("/payroll-runs")
      .then(setRuns)
      .catch((e: Error) => setError(e.message));
  }, []);

  const columns = useMemo<ViewColumn<Run>[]>(
    () => [
      { key: "name", label: l("Payroll", "Payroll"), value: (r) => r.name },
      {
        key: "paymentDate",
        label: l("Tanggal bayar", "Payment date"),
        type: "date",
        value: (r) => r.paymentDate,
      },
      { key: "employees", label: l("Karyawan", "Employees"), type: "number", value: (r) => r.employees },
      { key: "pph21", label: "PPh 21", type: "number", value: (r) => Number(r.pph21) },
      { key: "net", label: l("Gaji bersih", "Net pay"), type: "number", value: (r) => Number(r.net) },
      {
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (r) => r.state,
        optionLabel: (v) => (PAYROLL_STATE_LABEL[v] ? tx(PAYROLL_STATE_LABEL[v]!) : v),
      },
      {
        key: "kind",
        label: l("Jenis", "Kind"),
        type: "enum",
        value: (r) => r.kind,
        optionLabel: (v) => (v === "correction" ? l("Koreksi", "Correction") : l("Reguler", "Regular")),
        hidden: true,
      },
    ],
    [l, tx],
  );
  const table = useTableView(runs ?? [], columns, {
    storageKey: "payroll-runs",
    defaultSort: { key: "paymentDate", dir: "desc" },
  });

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const run = await api<{ id: string }>("/payroll-runs", {
        method: "POST",
        body: { period, paymentDate },
      });
      router.push(`/payroll/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <header className="toolbar">
        <h1>{l("Penggajian", "Payroll Runs")}</h1>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {can(me.permissions, "payroll.write") && (
        <form className="inline-panel" onSubmit={create}>
          <label className="field">
            <span>{l("Bulan", "Month")}</span>
            <input type="month" required value={period} onChange={(e) => setPeriod(e.target.value)} />
          </label>
          <label className="field">
            <span>{l("Tanggal bayar", "Payment date")}</span>
            <input
              type="date"
              required
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </label>
          <button className="primary">{l("Buat & hitung payroll", "Create & compute payroll")}</button>
        </form>
      )}
      {runs && <TableTools view={table} />}
      {runs && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh view={table} col="name">
                  {l("Payroll", "Payroll")}
                </SortTh>
                <SortTh view={table} col="paymentDate">
                  {l("Tanggal bayar", "Payment date")}
                </SortTh>
                <SortTh view={table} col="employees" className="num">
                  {l("Karyawan", "Employees")}
                </SortTh>
                <SortTh view={table} col="pph21" className="num">
                  PPh 21
                </SortTh>
                <SortTh view={table} col="net" className="num">
                  {l("Gaji bersih", "Net pay")}
                </SortTh>
                <SortTh view={table} col="state">
                  {l("Status", "Status")}
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/payroll/runs/${r.id}`}>{r.name}</Link>
                    {r.kind === "correction" && <span className="badge"> {l("Koreksi", "Correction")}</span>}
                  </td>
                  <td>{formatDate(r.paymentDate, locale)}</td>
                  <td className="num">{r.employees}</td>
                  <td className="num">{money(r.pph21, locale)}</td>
                  <td className="num">{money(r.net, locale)}</td>
                  <td>
                    <span
                      className={`badge state-${r.state === "paid" ? "sale" : r.state === "done" ? "posted" : r.state}`}
                    >
                      {tx(PAYROLL_STATE_LABEL[r.state]!)}
                    </span>
                  </td>
                </tr>
              ))}
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {runs.length
                      ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                      : l("Belum ada payroll.", "No payroll runs yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {runs && <TablePager view={table} />}
    </>
  );
}
