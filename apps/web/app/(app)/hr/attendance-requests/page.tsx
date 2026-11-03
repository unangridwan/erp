"use client";

import { useEffect, useMemo, useState } from "react";
import { download } from "../../../../components/accounting/download";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { CORRECTION_KIND } from "../../../../components/hr/attendance-extras";
import { can, LEAVE_STATE_LABEL } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

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
    api<Correction[]>("/attendance-requests").then(setCorrections, (e: Error) => setError(e.message));
    api<ShiftChange[]>("/shift-requests").then(setShifts, (e: Error) => setError(e.message));
  }, [version]);

  const stateCol = useMemo(
    () => ({
      key: "state",
      label: l("Status", "Status"),
      type: "enum" as const,
      value: (r: { state: string }) => r.state,
      optionLabel: (v: string) => (LEAVE_STATE_LABEL[v] ? tx(LEAVE_STATE_LABEL[v]!) : v),
    }),
    [l, tx],
  );
  const pending = { state: { kind: "enum" as const, values: ["confirm"] } };
  const corrColumns = useMemo<ViewColumn<Correction>[]>(
    () => [
      { key: "employee", label: l("Karyawan", "Employee"), value: (c) => c.employeeName },
      {
        key: "kind",
        label: l("Jenis", "Kind"),
        type: "enum",
        value: (c) => c.kind,
        optionLabel: (v) => tx(CORRECTION_KIND[v as Correction["kind"]]),
      },
      { key: "date", label: l("Tanggal", "Date"), type: "date", value: (c) => c.date },
      {
        key: "checkIn",
        label: l("Masuk – pulang", "In – out"),
        type: "date",
        value: (c) => c.checkIn,
        filterable: false,
      },
      { key: "reason", label: l("Alasan", "Reason"), value: (c) => c.reason },
      stateCol,
    ],
    [l, tx, stateCol],
  );
  const corrTable = useTableView(corrections, corrColumns, {
    storageKey: "attendance-requests",
    defaultSort: { key: "date", dir: "desc" },
    initialFilters: pending,
  });
  const shiftColumns = useMemo<ViewColumn<ShiftChange>[]>(
    () => [
      { key: "employee", label: l("Karyawan", "Employee"), value: (s) => s.employeeName },
      {
        key: "schedule",
        label: l("Jadwal diminta", "Requested schedule"),
        type: "enum",
        value: (s) => s.scheduleName,
      },
      { key: "dateFrom", label: l("Periode", "Period"), type: "date", value: (s) => s.dateFrom },
      { key: "reason", label: l("Alasan", "Reason"), value: (s) => s.reason },
      stateCol,
    ],
    [l, stateCol],
  );
  const shiftTable = useTableView(shifts, shiftColumns, {
    storageKey: "shift-requests",
    defaultSort: { key: "dateFrom", dir: "desc" },
    initialFilters: pending,
  });

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
      </header>
      {error && <p className="error">{error}</p>}
      <section className="panel">
        <h2>{l("Koreksi absensi", "Attendance corrections")}</h2>
        <TableTools view={corrTable} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh view={corrTable} col="employee">
                  {l("Karyawan", "Employee")}
                </SortTh>
                <SortTh view={corrTable} col="kind">
                  {l("Jenis", "Kind")}
                </SortTh>
                <SortTh view={corrTable} col="date">
                  {l("Tanggal", "Date")}
                </SortTh>
                <SortTh view={corrTable} col="checkIn">
                  {l("Masuk – pulang", "In – out")}
                </SortTh>
                <SortTh view={corrTable} col="reason">
                  {l("Alasan", "Reason")}
                </SortTh>
                <SortTh view={corrTable} col="state">
                  {l("Status", "Status")}
                </SortTh>
                <th />
              </tr>
            </thead>
            <tbody>
              {corrTable.rows.map((c) => (
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
              {corrTable.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    {corrections.length
                      ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                      : l("Tidak ada koreksi absensi.", "No corrections.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePager view={corrTable} />
      </section>
      <section className="panel">
        <h2>{l("Tukar shift", "Shift changes")}</h2>
        <TableTools view={shiftTable} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh view={shiftTable} col="employee">
                  {l("Karyawan", "Employee")}
                </SortTh>
                <SortTh view={shiftTable} col="schedule">
                  {l("Jadwal diminta", "Requested schedule")}
                </SortTh>
                <SortTh view={shiftTable} col="dateFrom">
                  {l("Periode", "Period")}
                </SortTh>
                <SortTh view={shiftTable} col="reason">
                  {l("Alasan", "Reason")}
                </SortTh>
                <SortTh view={shiftTable} col="state">
                  {l("Status", "Status")}
                </SortTh>
                <th />
              </tr>
            </thead>
            <tbody>
              {shiftTable.rows.map((s) => (
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
              {shiftTable.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {shifts.length
                      ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                      : l("Tidak ada permintaan tukar shift.", "No shift change requests.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePager view={shiftTable} />
      </section>
    </div>
  );
}
