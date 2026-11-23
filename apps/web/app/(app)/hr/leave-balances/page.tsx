"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useMe } from "../../../../components/me-context";
import { RefSelect } from "../../../../components/ref-select";
import { api } from "../../../../lib/api";
import { formatDate, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface Balance {
  leaveTypeId: string;
  allocated: string;
  taken: string;
  remaining: string;
  expiringSoon: string;
  expiringOn: string | null;
}
interface Report {
  date: string;
  types: { id: string; name: string }[];
  rows: {
    id: string;
    name: string;
    employeeNumber: string;
    departmentName: string | null;
    balances: Balance[];
  }[];
}
interface Ledger {
  employee: { name: string };
  leaveType: { name: string };
  entries: {
    date: string;
    kind: "credit" | "debit" | "expire";
    days: string;
    label: string;
    balance: string;
  }[];
}
interface Overtime {
  id: string;
  employeeName: string;
  date: string;
  hours: string;
  description: string | null;
}

const n = (v: string) => Number(v).toLocaleString("id-ID", { maximumFractionDigits: 2 });

/** Laporan saldo cuti per karyawan × jenis, buku besar per karyawan, dan cuti pengganti dari lembur hari libur. */
export default function LeaveBalancesPage() {
  const { l, locale } = useI18n();
  const me = useMe();
  const [date, setDate] = useState(today());
  const [departmentId, setDepartmentId] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [ledger, setLedger] = useState<{ key: string; data: Ledger } | null>(null);
  const [overtimes, setOvertimes] = useState<Overtime[]>([]);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams({ date });
    if (departmentId) q.set("departmentId", departmentId);
    api<Report>(`/leaves/balance-report?${q}`).then(setReport, (e: Error) => setError(e.message));
  }, [date, departmentId, version]);
  useEffect(() => {
    api<Overtime[]>("/leaves/compensable-overtimes").then(setOvertimes, () => setOvertimes([]));
  }, [version]);

  async function openLedger(employeeId: string, leaveTypeId: string) {
    const key = `${employeeId}:${leaveTypeId}`;
    if (ledger?.key === key) return setLedger(null);
    const data = await api<Ledger>(`/leaves/ledger?employeeId=${employeeId}&leaveTypeId=${leaveTypeId}`);
    setLedger({ key, data });
  }
  async function compensate(id: string) {
    setError(null);
    try {
      await api(`/overtimes/${id}/compensate`, { method: "POST" });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  type BalanceRow = Report["rows"][number];
  const columns = useMemo<ViewColumn<BalanceRow>[]>(
    () => [
      {
        key: "employee",
        label: l("Karyawan", "Employee"),
        value: (r) => r.name,
        text: (r) => `${r.name} ${r.employeeNumber}`,
      },
      {
        key: "department",
        label: l("Departemen", "Department"),
        type: "enum",
        value: (r) => r.departmentName,
      },
      ...(report?.types ?? []).map((t): ViewColumn<BalanceRow> => ({
        key: `type:${t.id}`,
        label: t.name,
        type: "number",
        value: (r) => Number(r.balances.find((b) => b.leaveTypeId === t.id)?.remaining ?? 0),
        searchable: false,
      })),
    ],
    [l, report?.types],
  );
  const table = useTableView(report?.rows ?? [], columns, { storageKey: "leave-balances" });
  const KIND: Record<string, string> = {
    credit: l("Jatah", "Credit"),
    debit: l("Dipakai", "Taken"),
    expire: l("Kedaluwarsa", "Expired"),
  };

  return (
    <div className="stack-wide">
      <section className="panel">
        <header className="toolbar">
          <h1>{l("Saldo Cuti", "Time Off Balances")}</h1>
          <label className="field">
            <span>{l("Per tanggal", "As of")}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>{l("Departemen", "Department")}</span>
            <RefSelect
              name="departmentId"
              resource="departments"
              display="name"
              value={departmentId}
              onChange={setDepartmentId}
            />
          </label>
        </header>
        <p className="muted">
          {l(
            "Saldo = jatah yang berlaku pada tanggal itu − cuti yang dipakai. Jatah yang kedaluwarsa paling awal (mis. sisa tahun lalu) dipakai lebih dulu. Klik angka sisa untuk melihat buku besar.",
            "Balance = allocations valid on that date − time off taken. The allocation that expires first (e.g. last year's carry-over) is used first. Click a balance to see the ledger.",
          )}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {report && <TableTools view={table} placeholder={l("Cari karyawan…", "Search employee…")} />}
        {report && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortTh view={table} col="employee">
                    {l("Karyawan", "Employee")}
                  </SortTh>
                  <SortTh view={table} col="department">
                    {l("Departemen", "Department")}
                  </SortTh>
                  {report.types.map((t) => (
                    <SortTh key={t.id} view={table} col={`type:${t.id}`} className="num">
                      {t.name}
                    </SortTh>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr>
                      <td>
                        {r.name} <span className="muted">{r.employeeNumber}</span>
                      </td>
                      <td>{r.departmentName}</td>
                      {r.balances.map((b) => (
                        <td key={b.leaveTypeId} className="num">
                          <button
                            type="button"
                            className="link"
                            title={l(
                              `Jatah ${n(b.allocated)}, dipakai ${n(b.taken)}`,
                              `Allocated ${n(b.allocated)}, taken ${n(b.taken)}`,
                            )}
                            onClick={() => openLedger(r.id, b.leaveTypeId)}
                          >
                            <span className={Number(b.remaining) < 0 ? "error" : ""}>{n(b.remaining)}</span>
                            {" / "}
                            {n(b.allocated)}
                          </button>
                          {Number(b.expiringSoon) > 0 && (
                            <div>
                              <small className="muted">
                                {l(
                                  `${n(b.expiringSoon)} hangus ${formatDate(b.expiringOn, locale)}`,
                                  `${n(b.expiringSoon)} expire ${formatDate(b.expiringOn, locale)}`,
                                )}
                              </small>
                            </div>
                          )}
                        </td>
                      ))}
                    </tr>
                    {ledger && ledger.key.startsWith(`${r.id}:`) && (
                      <tr>
                        <td colSpan={2 + report.types.length}>
                          <strong>
                            {l("Buku besar", "Ledger")} {ledger.data.leaveType.name} —{" "}
                            {ledger.data.employee.name}
                          </strong>
                          <div className="table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>{l("Tanggal", "Date")}</th>
                                  <th>{l("Jenis", "Kind")}</th>
                                  <th>{l("Keterangan", "Description")}</th>
                                  <th className="num">{l("Hari", "Days")}</th>
                                  <th className="num">{l("Saldo berjalan", "Running")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ledger.data.entries.length === 0 && (
                                  <tr>
                                    <td colSpan={5} className="muted">
                                      {l("Belum ada jatah atau pemakaian.", "No allocations or usage yet.")}
                                    </td>
                                  </tr>
                                )}
                                {ledger.data.entries.map((e, i) => (
                                  <tr key={i}>
                                    <td>{formatDate(e.date, locale)}</td>
                                    <td>{KIND[e.kind]}</td>
                                    <td>{e.label}</td>
                                    <td className="num">
                                      {e.kind === "credit" ? "+" : "−"}
                                      {n(e.days)}
                                    </td>
                                    <td className="num">{n(e.balance)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {table.rows.length === 0 && (
                  <tr>
                    <td colSpan={2 + report.types.length} className="muted">
                      {report.rows.length
                        ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                        : l("Tidak ada karyawan.", "No employees.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {report && <TablePager view={table} />}
      </section>

      <section className="panel">
        <h2>{l("Cuti pengganti dari lembur hari libur", "Compensatory leave from rest-day overtime")}</h2>
        <p className="muted">
          {l(
            "Lembur hari istirahat/libur yang sudah disetujui (≥ 4 jam) bisa dijadikan jatah Cuti pengganti (8 jam = 1 hari, berlaku 3 bulan). Lembur yang dijadikan cuti tidak dibayar di payroll.",
            "Approved rest-day overtime (≥ 4 hours) can become Compensatory leave (8 hours = 1 day, valid 3 months). Converted overtime is not paid in payroll.",
          )}
        </p>
        {overtimes.length === 0 ? (
          <p className="muted">{l("Tidak ada lembur yang bisa dijadikan cuti.", "No eligible overtime.")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Karyawan", "Employee")}</th>
                  <th>{l("Tanggal", "Date")}</th>
                  <th className="num">{l("Jam", "Hours")}</th>
                  <th>{l("Keterangan", "Description")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {overtimes.map((o) => (
                  <tr key={o.id}>
                    <td>{o.employeeName}</td>
                    <td>{formatDate(o.date, locale)}</td>
                    <td className="num">{Number(o.hours)}</td>
                    <td>{o.description}</td>
                    <td>
                      {can(me.permissions, "hr.write") && (
                        <button type="button" className="link" onClick={() => compensate(o.id)}>
                          {l("Jadikan cuti pengganti", "Convert to leave")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
