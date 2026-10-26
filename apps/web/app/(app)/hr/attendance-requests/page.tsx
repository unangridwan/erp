"use client";

import { useEffect, useState } from "react";
import { download } from "../../../../components/accounting/download";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { CORRECTION_KIND } from "../../../../components/hr/attendance-extras";
import { can, LEAVE_STATE_LABEL } from "../../../../lib/resources";

interface Correction {
  id: string;
  employeeName: string;
  kind: "correction" | "business_trip" | "wfh";
  date: string;
  checkIn: string;
  checkOut: string | null;
  reason: string;
  attachmentName: string | null;
  state: string;
  approvalStep: number;
  approvalLevels: number;
}
interface ShiftChange {
  id: string;
  employeeName: string;
  scheduleName: string;
  dateFrom: string;
  dateTo: string;
  reason: string | null;
  state: string;
  approvalStep: number;
  approvalLevels: number;
}

/** Koreksi absensi & permintaan tukar shift: disetujui berjenjang (atasan → HR) atau lewat Kotak Persetujuan. */
export default function AttendanceRequestsPage() {
  const { l, tx, locale } = useI18n();
  const me = useMe();
  const writable = can(me.permissions, "hr.write");
  const [state, setState] = useState("confirm");
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [shifts, setShifts] = useState<ShiftChange[]>([]);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState("Asia/Jakarta");
  useEffect(() => {
    api<{ timezone: string }>("/payroll/settings").then(
      (s) => setTimeZone(s.timezone || "Asia/Jakarta"),
      () => undefined,
    );
  }, []);

  useEffect(() => {
    const q = state ? `?state=${state}` : "";
    api<Correction[]>(`/attendance-requests${q}`).then(setCorrections, (e: Error) => setError(e.message));
    api<ShiftChange[]>(`/shift-requests${q}`).then(setShifts, (e: Error) => setError(e.message));
  }, [state, version]);

  async function decide(path: string) {
    setError(null);
    try {
      await api(path, { method: "POST", body: {} });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : String(e));
    }
  }
  const clock = (v: string | null) =>
    v
      ? new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { timeStyle: "short", timeZone }).format(
          new Date(v),
        )
      : "—";
  const actions = (base: string, id: string, rowState: string) =>
    writable &&
    rowState === "confirm" && (
      <>
        <button type="button" className="link" onClick={() => decide(`${base}/${id}/approve`)}>
          {l("Setujui", "Approve")}
        </button>{" "}
        <button type="button" className="link" onClick={() => decide(`${base}/${id}/refuse`)}>
          {l("Tolak", "Refuse")}
        </button>
      </>
    );

  return (
    <div className="stack-wide">
      <header className="toolbar">
        <h1>{l("Koreksi Absensi & Tukar Shift", "Attendance Corrections & Shift Changes")}</h1>
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label={l("Status", "Status")}>
          <option value="confirm">{l("Menunggu persetujuan", "To approve")}</option>
          <option value="approved">{l("Disetujui", "Approved")}</option>
          <option value="refused">{l("Ditolak", "Refused")}</option>
          <option value="">{l("Semua", "All")}</option>
        </select>
      </header>
      {error && <p className="error">{error}</p>}
      <section className="panel">
        <h2>{l("Koreksi absensi", "Attendance corrections")}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Karyawan", "Employee")}</th>
                <th>{l("Jenis", "Kind")}</th>
                <th>{l("Tanggal", "Date")}</th>
                <th>{l("Masuk – pulang", "In – out")}</th>
                <th>{l("Alasan", "Reason")}</th>
                <th>{l("Status", "Status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {corrections.map((c) => (
                <tr key={c.id}>
                  <td>{c.employeeName}</td>
                  <td>{tx(CORRECTION_KIND[c.kind])}</td>
                  <td>{formatDate(c.date, locale)}</td>
                  <td>
                    {clock(c.checkIn)} – {clock(c.checkOut)}
                  </td>
                  <td>
                    {c.reason}
                    {c.attachmentName && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="link"
                          onClick={() =>
                            download(`/attendance-requests/${c.id}/attachment`, c.attachmentName!).catch(
                              (e: Error) => setError(e.message),
                            )
                          }
                        >
                          📎 {c.attachmentName}
                        </button>
                      </>
                    )}
                  </td>
                  <td>
                    {tx(LEAVE_STATE_LABEL[c.state]!)}
                    {c.state === "confirm" && (
                      <span className="muted">
                        {" "}
                        {c.approvalStep}/{c.approvalLevels}
                      </span>
                    )}
                  </td>
                  <td>{actions("/attendance-requests", c.id, c.state)}</td>
                </tr>
              ))}
              {corrections.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    {l("Tidak ada koreksi absensi.", "No corrections.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h2>{l("Tukar shift", "Shift changes")}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Karyawan", "Employee")}</th>
                <th>{l("Jadwal diminta", "Requested schedule")}</th>
                <th>{l("Periode", "Period")}</th>
                <th>{l("Alasan", "Reason")}</th>
                <th>{l("Status", "Status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id}>
                  <td>{s.employeeName}</td>
                  <td>{s.scheduleName}</td>
                  <td>
                    {formatDate(s.dateFrom, locale)} – {formatDate(s.dateTo, locale)}
                  </td>
                  <td>{s.reason}</td>
                  <td>
                    {tx(LEAVE_STATE_LABEL[s.state]!)}
                    {s.state === "confirm" && (
                      <span className="muted">
                        {" "}
                        {s.approvalStep}/{s.approvalLevels}
                      </span>
                    )}
                  </td>
                  <td>{actions("/shift-requests", s.id, s.state)}</td>
                </tr>
              ))}
              {shifts.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {l("Tidak ada permintaan tukar shift.", "No shift change requests.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
