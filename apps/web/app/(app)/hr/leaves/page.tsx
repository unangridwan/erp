"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { download } from "../../../../components/accounting/download";
import { useOptions } from "../../../../components/accounting/use-options";
import { LeaveRequestForm, type LeaveTypeOption } from "../../../../components/hr/leave-form";
import { useMe } from "../../../../components/me-context";
import { RefSelect } from "../../../../components/ref-select";
import { api, ApiError } from "../../../../lib/api";
import { formatDate, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can, LEAVE_STATE_LABEL } from "../../../../lib/resources";

interface Row {
  id: string;
  employeeName: string;
  leaveTypeName: string;
  dateFrom: string;
  dateTo: string;
  days: string;
  reason: string | null;
  state: string;
  halfDay: "am" | "pm" | null;
  hasAttachment: boolean;
  attachmentName: string | null;
  delegateName: string | null;
  bulkId: string | null;
}
interface Bulk {
  bulkId: string;
  leaveTypeName: string;
  dateFrom: string;
  dateTo: string;
  reason: string;
  employees: number;
}
interface BulkResult {
  created: { employeeName: string; days: number }[];
  skipped: { employeeName: string; reason: string }[];
}

/** Pengajuan cuti karyawan: setujui/tolak, ajukan atas nama karyawan, cuti massal (cuti bersama). */
export default function LeavesPage() {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const types = useOptions<LeaveTypeOption>("/leave-types");
  const [state, setState] = useState("confirm");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [bulks, setBulks] = useState<Bulk[]>([]);
  const [version, setVersion] = useState(0);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    leaveTypeId: "",
    dateFrom: today(),
    dateTo: today(),
    reason: "",
    departmentId: "",
  });
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const writable = can(me.permissions, "hr.write");

  useEffect(() => {
    api<Row[]>(`/leaves${state ? `?state=${state}` : ""}`)
      .then(setRows)
      .catch((e: Error) => setError(e.message));
    api<Bulk[]>("/leaves/bulk").then(setBulks, () => setBulks([]));
  }, [state, version]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : String(e));
    }
  }
  const submitBulk = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setBulkResult(
        await api<BulkResult>("/leaves/bulk", {
          method: "POST",
          body: { ...bulkForm, departmentId: bulkForm.departmentId || null },
        }),
      );
    });
  };

  return (
    <>
      <header className="toolbar">
        <h1>{l("Pengajuan Cuti", "Time Off Requests")}</h1>
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label={l("Status", "Status")}>
          <option value="confirm">{l("Menunggu persetujuan", "To approve")}</option>
          <option value="approved">{l("Disetujui", "Approved")}</option>
          <option value="refused,cancel">{l("Ditolak / batal", "Refused / cancelled")}</option>
          <option value="">{l("Semua", "All")}</option>
        </select>
        {writable && (
          <button type="button" onClick={() => setBulkOpen((o) => !o)}>
            {l("Cuti bersama / massal", "Mass time off")}
          </button>
        )}
        <Link href="/hr/leave-balances">{l("Saldo cuti", "Balances")}</Link>
      </header>
      {error && <p className="error">{error}</p>}
      {writable && bulkOpen && (
        <section className="panel">
          <h2>{l("Cuti bersama / massal", "Mass time off")}</h2>
          <p className="muted">
            {l(
              "Dibuat untuk semua karyawan aktif (atau satu departemen) dan langsung disetujui. Karyawan yang sudah punya cuti pada tanggal itu atau saldonya kurang dilewati.",
              "Created for all active employees (or one department) and approved immediately. Employees who already have time off on those dates or lack balance are skipped.",
            )}
          </p>
          <form className="inline-panel" onSubmit={submitBulk}>
            <label className="field">
              <span>{l("Jenis", "Type")}</span>
              <select
                required
                value={bulkForm.leaveTypeId}
                onChange={(e) => setBulkForm((f) => ({ ...f, leaveTypeId: e.target.value }))}
              >
                <option value="">—</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Dari", "From")}</span>
              <input
                type="date"
                value={bulkForm.dateFrom}
                onChange={(e) => setBulkForm((f) => ({ ...f, dateFrom: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>{l("Sampai", "To")}</span>
              <input
                type="date"
                value={bulkForm.dateTo}
                onChange={(e) => setBulkForm((f) => ({ ...f, dateTo: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>{l("Departemen (kosong = semua)", "Department (empty = all)")}</span>
              <RefSelect
                name="departmentId"
                resource="departments"
                display="name"
                value={bulkForm.departmentId}
                onChange={(v) => setBulkForm((f) => ({ ...f, departmentId: v }))}
              />
            </label>
            <label className="field">
              <span>{l("Alasan", "Reason")}</span>
              <input
                required
                value={bulkForm.reason}
                placeholder={l("mis. Cuti bersama Idulfitri", "e.g. Collective leave")}
                onChange={(e) => setBulkForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </label>
            <button className="primary">{l("Buat cuti massal", "Create mass time off")}</button>
          </form>
          {bulkResult && (
            <div className="notice">
              {l(
                `${bulkResult.created.length} karyawan dibuatkan cuti.`,
                `${bulkResult.created.length} employees.`,
              )}
              {bulkResult.skipped.length > 0 && (
                <ul>
                  {bulkResult.skipped.map((s) => (
                    <li key={s.employeeName}>
                      {s.employeeName}: {s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {bulks.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{l("Jenis", "Type")}</th>
                    <th>{l("Tanggal", "Dates")}</th>
                    <th>{l("Alasan", "Reason")}</th>
                    <th className="num">{l("Karyawan", "Employees")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {bulks.map((b) => (
                    <tr key={b.bulkId}>
                      <td>{b.leaveTypeName}</td>
                      <td>
                        {formatDate(b.dateFrom, locale)} – {formatDate(b.dateTo, locale)}
                      </td>
                      <td>{b.reason}</td>
                      <td className="num">{b.employees}</td>
                      <td>
                        {b.employees > 0 && (
                          <button
                            type="button"
                            className="link"
                            onClick={() =>
                              confirm(l("Batalkan cuti massal ini?", "Cancel this mass time off?")) &&
                              run(() => api(`/leaves/bulk/${b.bulkId}/cancel`, { method: "POST" }))
                            }
                          >
                            {l("Batalkan semua", "Cancel all")}
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
      )}
      {writable && <LeaveRequestForm types={types} chooseEmployee onSaved={() => setVersion((v) => v + 1)} />}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Karyawan", "Employee")}</th>
                <th>{l("Jenis", "Type")}</th>
                <th>{l("Tanggal", "Dates")}</th>
                <th className="num">{l("Hari", "Days")}</th>
                <th>{l("Alasan", "Reason")}</th>
                <th>{l("Delegasi", "Delegate")}</th>
                <th>{l("Status", "Status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.employeeName}</td>
                  <td>
                    {r.leaveTypeName}
                    {r.bulkId && <span className="muted"> · {l("massal", "mass")}</span>}
                  </td>
                  <td>
                    {formatDate(r.dateFrom, locale)}
                    {r.dateTo !== r.dateFrom && ` – ${formatDate(r.dateTo, locale)}`}
                    {r.halfDay && ` (${r.halfDay === "am" ? l("pagi", "AM") : l("siang", "PM")})`}
                  </td>
                  <td className="num">{Number(r.days)}</td>
                  <td>
                    {r.reason}
                    {r.hasAttachment && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="link"
                          onClick={() =>
                            download(`/leaves/${r.id}/attachment`, r.attachmentName ?? "lampiran").catch(
                              (e: Error) => setError(e.message),
                            )
                          }
                        >
                          📎 {r.attachmentName}
                        </button>
                      </>
                    )}
                  </td>
                  <td>{r.delegateName}</td>
                  <td>
                    <span
                      className={`badge state-${r.state === "approved" ? "sale" : r.state === "confirm" ? "sent" : "cancel"}`}
                    >
                      {tx(LEAVE_STATE_LABEL[r.state]!)}
                    </span>
                  </td>
                  <td>
                    {writable && r.state === "confirm" && (
                      <>
                        <button
                          type="button"
                          className="link"
                          onClick={() => run(() => api(`/leaves/${r.id}/approve`, { method: "POST" }))}
                        >
                          {l("Setujui", "Approve")}
                        </button>{" "}
                        <button
                          type="button"
                          className="link"
                          onClick={() => run(() => api(`/leaves/${r.id}/refuse`, { method: "POST" }))}
                        >
                          {l("Tolak", "Refuse")}
                        </button>
                      </>
                    )}
                    {writable && r.state === "approved" && (
                      <button
                        type="button"
                        className="link"
                        onClick={() => run(() => api(`/leaves/${r.id}/cancel`, { method: "POST" }))}
                      >
                        {l("Batalkan", "Cancel")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    {l("Tidak ada pengajuan.", "No requests.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
