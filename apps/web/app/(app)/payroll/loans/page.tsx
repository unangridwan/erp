"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { useMe } from "../../../../components/me-context";
import { RefSelect } from "../../../../components/ref-select";
import { api, ApiError } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { L, useI18n, type Text } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";
import { ask } from "../../../../components/feedback";

interface Loan {
  id: string;
  employeeName: string;
  name: string;
  principal: string;
  installment: string;
  startPeriod: string;
  state: string;
  paid: string;
  remaining: string;
  disbursementDate: string | null;
}
interface LoanDetail extends Loan {
  installments: { runId: string; runName: string; periodStart: string; state: string; amount: string }[];
  disbursementMove: { id: string; name: string } | null;
}

const STATE: Record<string, Text> = {
  draft: L("Draft", "Draft"),
  running: L("Berjalan", "Running"),
  done: L("Lunas", "Paid off"),
  cancel: L("Batal", "Cancelled"),
};

/** Pinjaman/kasbon karyawan: dicairkan lewat kas/bank, dicicil otomatis lewat slip gaji sampai lunas. */
export default function LoansPage() {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const journals = useOptions<{ id: string; code: string; name: string; journalType: string }>("/journals");
  const cashJournals = journals.filter((j) => j.journalType === "bank" || j.journalType === "cash");
  const [rows, setRows] = useState<Loan[] | null>(null);
  const [detail, setDetail] = useState<LoanDetail | null>(null);
  const [disburse, setDisburse] = useState({ journalId: "", date: today() });
  const [form, setForm] = useState({
    employeeId: "",
    name: "",
    principal: "",
    installment: "",
    startPeriod: today().slice(0, 7),
  });
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const writable = can(me.permissions, "payroll.write");
  const manage = can(me.permissions, "payroll.manage");

  useEffect(() => {
    api<Loan[]>("/employee-loans")
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [version]);
  const columns = useMemo<ViewColumn<Loan>[]>(
    () => [
      { key: "employee", label: l("Karyawan", "Employee"), value: (r) => r.employeeName },
      { key: "name", label: l("Keperluan", "Purpose"), value: (r) => r.name },
      { key: "principal", label: l("Pokok", "Principal"), type: "number", value: (r) => Number(r.principal) },
      {
        key: "installment",
        label: l("Cicilan", "Installment"),
        type: "number",
        value: (r) => Number(r.installment),
      },
      { key: "startPeriod", label: l("Mulai", "From"), type: "enum", value: (r) => r.startPeriod },
      { key: "paid", label: l("Terbayar", "Paid"), type: "number", value: (r) => Number(r.paid) },
      { key: "remaining", label: l("Sisa", "Remaining"), type: "number", value: (r) => Number(r.remaining) },
      {
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (r) => r.state,
        optionLabel: (v) => (STATE[v] ? tx(STATE[v]!) : v),
      },
    ],
    [l, tx],
  );
  const table = useTableView(rows ?? [], columns, { storageKey: "employee-loans" });

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setFieldErrors({});
    try {
      await fn();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
    }
  }
  const open = (id: string) =>
    detail?.id === id
      ? setDetail(null)
      : api<LoanDetail>(`/employee-loans/${id}`)
          .then(setDetail)
          .catch((e: Error) => setError(e.message));
  const refresh = (id: string) => api<LoanDetail>(`/employee-loans/${id}`).then(setDetail);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api("/employee-loans", { method: "POST", body: form });
      setForm((f) => ({ ...f, name: "", principal: "", installment: "" }));
    });
  };
  const err = (p: string) => fieldErrors[p] && <small className="error">{fieldErrors[p]}</small>;

  return (
    <>
      <header className="toolbar">
        <h1>{l("Pinjaman Karyawan", "Employee Loans")}</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {writable && (
        <form className="inline-panel" onSubmit={submit}>
          <label className="field">
            <span>{l("Karyawan", "Employee")}</span>
            <RefSelect
              name="employeeId"
              resource="employees"
              display="name"
              required
              value={form.employeeId}
              onChange={(v) => setForm((f) => ({ ...f, employeeId: v }))}
            />
          </label>
          <label className="field">
            <span>{l("Keperluan", "Purpose")}</span>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>{l("Pokok pinjaman", "Principal")}</span>
            <input
              className="num"
              inputMode="decimal"
              required
              value={form.principal}
              onChange={(e) => setForm((f) => ({ ...f, principal: e.target.value }))}
            />
            {err("principal")}
          </label>
          <label className="field">
            <span>{l("Cicilan / bulan", "Installment / month")}</span>
            <input
              className="num"
              inputMode="decimal"
              required
              value={form.installment}
              onChange={(e) => setForm((f) => ({ ...f, installment: e.target.value }))}
            />
            {err("installment")}
          </label>
          <label className="field">
            <span>{l("Mulai dipotong", "First deduction")}</span>
            <input
              type="month"
              required
              value={form.startPeriod}
              onChange={(e) => setForm((f) => ({ ...f, startPeriod: e.target.value }))}
            />
          </label>
          <button className="primary">{l("Buat", "Create")}</button>
        </form>
      )}
      {rows && <TableTools view={table} />}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh view={table} col="employee">
                  {l("Karyawan", "Employee")}
                </SortTh>
                <SortTh view={table} col="name">
                  {l("Keperluan", "Purpose")}
                </SortTh>
                <SortTh view={table} col="principal" className="num">
                  {l("Pokok", "Principal")}
                </SortTh>
                <SortTh view={table} col="installment" className="num">
                  {l("Cicilan", "Installment")}
                </SortTh>
                <SortTh view={table} col="startPeriod">
                  {l("Mulai", "From")}
                </SortTh>
                <SortTh view={table} col="paid" className="num">
                  {l("Terbayar", "Paid")}
                </SortTh>
                <SortTh view={table} col="remaining" className="num">
                  {l("Sisa", "Remaining")}
                </SortTh>
                <SortTh view={table} col="state">
                  {l("Status", "Status")}
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td>{r.employeeName}</td>
                    <td>
                      <button type="button" className="link" onClick={() => open(r.id)}>
                        {detail?.id === r.id ? "▾" : "▸"} {r.name}
                      </button>
                    </td>
                    <td className="num">{money(r.principal, locale)}</td>
                    <td className="num">{money(r.installment, locale)}</td>
                    <td>{r.startPeriod}</td>
                    <td className="num">{money(r.paid, locale)}</td>
                    <td className="num">{money(r.remaining, locale)}</td>
                    <td>
                      <span
                        className={`badge state-${r.state === "running" ? "sent" : r.state === "done" ? "sale" : r.state}`}
                      >
                        {tx(STATE[r.state]!)}
                      </span>
                    </td>
                  </tr>
                  {detail?.id === r.id && (
                    <tr>
                      <td colSpan={8}>
                        <div className="stack">
                          {detail.disbursementMove && (
                            <p>
                              {l("Dicairkan", "Disbursed")} {formatDate(detail.disbursementDate!, locale)} —{" "}
                              <Link href={`/accounting/moves/${detail.disbursementMove.id}`}>
                                {detail.disbursementMove.name}
                              </Link>
                            </p>
                          )}
                          {manage && detail.state === "draft" && (
                            <div className="inline-panel">
                              <label className="field">
                                <span>{l("Dicairkan dari", "Paid from")}</span>
                                <select
                                  value={disburse.journalId}
                                  onChange={(e) => setDisburse((d) => ({ ...d, journalId: e.target.value }))}
                                >
                                  <option value="">—</option>
                                  {cashJournals.map((j) => (
                                    <option key={j.id} value={j.id}>
                                      {j.code} {j.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="field">
                                <span>{l("Tanggal", "Date")}</span>
                                <input
                                  type="date"
                                  value={disburse.date}
                                  onChange={(e) => setDisburse((d) => ({ ...d, date: e.target.value }))}
                                />
                              </label>
                              <button
                                type="button"
                                className="primary"
                                disabled={!disburse.journalId}
                                onClick={() =>
                                  run(async () => {
                                    await api(`/employee-loans/${r.id}/disburse`, {
                                      method: "POST",
                                      body: disburse,
                                    });
                                    await refresh(r.id);
                                  })
                                }
                              >
                                {l("Cairkan", "Disburse")}
                              </button>
                            </div>
                          )}
                          {detail.installments.length > 0 ? (
                            <div className="table-scroll">
                              <table className="lines">
                                <thead>
                                  <tr>
                                    <th>{l("Penggajian", "Payroll")}</th>
                                    <th className="num">{l("Cicilan", "Installment")}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {detail.installments.map((i) => (
                                    <tr key={i.runId}>
                                      <td>
                                        <Link href={`/payroll/runs/${i.runId}`}>{i.runName}</Link>
                                        {i.state === "draft" && ` (${l("draft", "draft")})`}
                                      </td>
                                      <td className="num">{money(i.amount, locale)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="muted">{l("Belum ada cicilan.", "No installments yet.")}</p>
                          )}
                          {manage &&
                            (detail.state === "draft" || detail.state === "running") &&
                            detail.installments.length === 0 && (
                              <div>
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={async () =>
                                    (await ask(l("Batalkan pinjaman ini?", "Cancel this loan?"))) &&
                                    run(async () => {
                                      await api(`/employee-loans/${r.id}/cancel`, { method: "POST" });
                                      await refresh(r.id);
                                    })
                                  }
                                >
                                  {l("Batalkan", "Cancel loan")}
                                </button>
                              </div>
                            )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    {rows.length
                      ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                      : l("Belum ada pinjaman.", "No loans.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {rows && <TablePager view={table} />}
    </>
  );
}
