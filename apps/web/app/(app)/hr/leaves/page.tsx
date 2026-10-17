"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
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
}

/** Pengajuan cuti karyawan: setujui/tolak, atau ajukan atas nama karyawan. */
export default function LeavesPage() {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const types = useOptions<{ id: string; name: string }>("/leave-types");
  const [state, setState] = useState("confirm");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState({
    employeeId: "",
    leaveTypeId: "",
    dateFrom: today(),
    dateTo: today(),
    reason: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const writable = can(me.permissions, "hr.write");

  useEffect(() => {
    api<Row[]>(`/leaves${state ? `?state=${state}` : ""}`)
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [state, version]);

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
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api("/leaves", { method: "POST", body: { ...form, reason: form.reason || null } }));
  };

  return (
    <>
      <header className="toolbar">
        <h1>{l("Pengajuan Cuti", "Time Off Requests")}</h1>
        <select value={state} onChange={(e) => setState(e.target.value)}>
          <option value="confirm">{l("Menunggu persetujuan", "To approve")}</option>
          <option value="approved">{l("Disetujui", "Approved")}</option>
          <option value="refused,cancel">{l("Ditolak / batal", "Refused / cancelled")}</option>
          <option value="">{l("Semua", "All")}</option>
        </select>
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
            <span>{l("Jenis", "Type")}</span>
            <select
              required
              value={form.leaveTypeId}
              onChange={(e) => setForm((f) => ({ ...f, leaveTypeId: e.target.value }))}
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
              value={form.dateFrom}
              onChange={(e) => setForm((f) => ({ ...f, dateFrom: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>{l("Sampai", "To")}</span>
            <input
              type="date"
              value={form.dateTo}
              onChange={(e) => setForm((f) => ({ ...f, dateTo: e.target.value }))}
            />
            {fieldErrors.dateTo && <small className="error">{fieldErrors.dateTo}</small>}
          </label>
          <label className="field">
            <span>{l("Alasan", "Reason")}</span>
            <input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </label>
          <button className="primary">{l("Ajukan", "Submit")}</button>
        </form>
      )}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Karyawan", "Employee")}</th>
                <th>{l("Jenis", "Type")}</th>
                <th>{l("Tanggal", "Dates")}</th>
                <th className="num">{l("Hari kerja", "Work days")}</th>
                <th>{l("Alasan", "Reason")}</th>
                <th>{l("Status", "Status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.employeeName}</td>
                  <td>{r.leaveTypeName}</td>
                  <td>
                    {formatDate(r.dateFrom, locale)} – {formatDate(r.dateTo, locale)}
                  </td>
                  <td className="num">{Number(r.days)}</td>
                  <td>{r.reason}</td>
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
                  <td colSpan={7} className="muted">
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
