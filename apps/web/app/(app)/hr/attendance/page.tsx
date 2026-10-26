"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { AuthImage } from "../../../../components/auth-image";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { today } from "../../../../lib/format";
import { L, useI18n, type Text } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Row {
  id: string;
  employeeId: string;
  employeeName: string;
  checkIn: string;
  checkOut: string | null;
  workedHours: string | null;
  source: string;
  state: "draft" | "validated" | "refused";
  distanceM: number | null;
  photoType: string | null;
  autoCheckout: boolean;
  ip: string | null;
  note: string | null;
}
interface Day {
  date: string;
  status: string;
  lateMinutes: number;
  earlyMinutes: number;
  workedMinutes: number;
}
interface Summary {
  from: string;
  to: string;
  rows: {
    employeeId: string;
    employeeName: string;
    employeeNumber: string;
    days: Day[];
    summary: { counts: Record<string, number>; lateMinutes: number; present: number };
  }[];
}

const STATUS_LABEL: Record<string, Text> = {
  on_time: L("Tepat waktu", "On time"),
  late: L("Terlambat", "Late"),
  early_out: L("Pulang cepat", "Early out"),
  no_checkout: L("Tidak absen pulang", "No check-out"),
  working: L("Sedang bekerja", "Working"),
  absent: L("Tidak hadir", "Absent"),
  not_yet: L("Belum hadir", "Not in yet"),
  upcoming: L("Mendatang", "Upcoming"),
  day_off: L("Hari libur kerja", "Day off"),
  holiday: L("Libur nasional", "Holiday"),
  time_off: L("Cuti", "Time off"),
  extra_day: L("Masuk di hari libur", "Worked a day off"),
};
const STATUS_CODE: Record<string, string> = {
  on_time: "H",
  late: "T",
  early_out: "PC",
  no_checkout: "TP",
  working: "•",
  absent: "A",
  not_yet: "·",
  upcoming: "",
  day_off: "-",
  holiday: "L",
  time_off: "C",
  extra_day: "HL",
};
const SOURCE_LABEL: Record<string, Text> = {
  web: L("Web/ponsel", "Web/mobile"),
  manual: L("Manual HR", "Manual"),
  import: L("Impor", "Import"),
  kiosk: L("Kiosk", "Kiosk"),
  device: L("Mesin", "Device"),
  request: L("Koreksi", "Correction"),
};
const STATE_BADGE = { draft: "state-draft", validated: "state-sale", refused: "state-lost" } as const;

type Tab = "list" | "today" | "month";

/** Absensi: daftar & validasi, kehadiran hari ini, rekap bulanan (kode status per tanggal). */
export default function AttendancePage() {
  const { l, tx, locale } = useI18n();
  const me = useMe();
  const writable = can(me.permissions, "hr.write");
  const employees = useOptions<{ id: string; name: string }>("/employees");
  const [tab, setTab] = useState<Tab>("list");
  const [from, setFrom] = useState(today().slice(0, 8) + "01");
  const [to, setTo] = useState(today());
  const [month, setMonth] = useState(today().slice(0, 7));
  const [employeeId, setEmployeeId] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [todayView, setTodayView] = useState<{
    date: string;
    groups: Record<string, { employeeName: string; lateMinutes: number; firstIn: string | null }[]>;
  } | null>(null);
  const [lock, setLock] = useState<string | null>(null);
  // Jam ditampilkan dalam zona waktu perusahaan (Pengaturan Payroll), bukan zona waktu browser.
  const [timeZone, setTimeZone] = useState("Asia/Jakarta");
  const [version, setVersion] = useState(0);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ attendanceLockDate: string | null; timezone: string }>("/payroll/settings").then(
      (s) => {
        setLock(s.attendanceLockDate);
        setTimeZone(s.timezone || "Asia/Jakarta");
      },
      () => setLock(null),
    );
  }, [version]);
  useEffect(() => {
    if (tab !== "list") return;
    const params = new URLSearchParams({ from, to });
    if (employeeId) params.set("employeeId", employeeId);
    api<Row[]>(`/attendance?${params}`)
      .then((r) => {
        setRows(r);
        setSelected(new Set());
      })
      .catch((e: Error) => setError(e.message));
  }, [tab, from, to, employeeId, version]);
  useEffect(() => {
    if (tab !== "month") return;
    const params = new URLSearchParams({ month });
    if (employeeId) params.set("employeeId", employeeId);
    api<Summary>(`/attendance/summary?${params}`).then(setSummary, (e: Error) => setError(e.message));
  }, [tab, month, employeeId]);
  useEffect(() => {
    if (tab !== "today") return;
    api<typeof todayView>("/attendance/today").then(setTodayView, (e: Error) => setError(e.message));
  }, [tab, version]);

  const totals = useMemo(() => {
    const map = new Map<string, { name: string; days: Set<string>; hours: number }>();
    for (const r of rows ?? []) {
      if (r.state === "refused") continue;
      const s = map.get(r.employeeId) ?? { name: r.employeeName, days: new Set<string>(), hours: 0 };
      s.days.add(r.checkIn.slice(0, 10));
      s.hours += Number(r.workedHours ?? 0);
      map.set(r.employeeId, s);
    }
    return [...map.values()];
  }, [rows]);
  const time = (v: string | null) =>
    v
      ? new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone,
        }).format(new Date(v))
      : "—";
  const clock = (v: string | null) =>
    v
      ? new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { timeStyle: "short", timeZone }).format(
          new Date(v),
        )
      : "";
  const drafts = (rows ?? []).filter((r) => r.state === "draft");

  async function decide(decision: "validated" | "refused") {
    setError(null);
    try {
      await api("/attendance/validate", { method: "POST", body: { ids: [...selected], decision } });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : String(e));
    }
  }
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <header className="toolbar">
        <h1>{l("Absensi", "Attendance")}</h1>
        <select
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          aria-label={l("Karyawan", "Employee")}
        >
          <option value="">{l("Semua karyawan", "All employees")}</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <Link href="/hr/attendance-requests">
          {l("Koreksi & tukar shift", "Corrections & shift changes")}
        </Link>
        <Link href="/hr/kiosk">{l("Mode kiosk", "Kiosk mode")}</Link>
      </header>
      <div className="tabs" role="tablist">
        {(
          [
            ["list", l("Daftar & validasi", "List & validation")],
            ["today", l("Hari ini", "Today")],
            ["month", l("Rekap bulanan", "Monthly recap")],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? "active" : ""}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>
      {lock && (
        <p className="muted">
          {l(`Absensi s.d. ${lock} terkunci (tidak bisa diubah).`, `Attendance up to ${lock} is locked.`)}
        </p>
      )}
      {error && <p className="error">{error}</p>}

      {tab === "list" && (
        <>
          <div className="toolbar">
            <input
              type="date"
              aria-label={l("Dari", "From")}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <input
              type="date"
              aria-label={l("Sampai", "To")}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            {writable && (
              <>
                <button
                  type="button"
                  disabled={!drafts.length}
                  onClick={() => setSelected(new Set(drafts.map((d) => d.id)))}
                >
                  {l(`Pilih semua draft (${drafts.length})`, `Select all drafts (${drafts.length})`)}
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={!selected.size}
                  onClick={() => decide("validated")}
                >
                  {l(`Validasi (${selected.size})`, `Validate (${selected.size})`)}
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={!selected.size}
                  onClick={() => decide("refused")}
                >
                  {l("Tolak", "Refuse")}
                </button>
              </>
            )}
          </div>
          {totals.length > 0 && (
            <ul className="grid">
              {totals.map((s) => (
                <li key={s.name} className="card">
                  <span>{s.name}</span>
                  <strong>
                    {s.days.size} {l("hari", "days")} · {s.hours.toFixed(1)} {l("jam", "hours")}
                  </strong>
                </li>
              ))}
            </ul>
          )}
          {photo && (
            <div className="inline-panel">
              <AuthImage
                path={`/attendance/${photo}/photo`}
                alt={l("Foto absen", "Check-in photo")}
                className="attendance-photo"
              />
              <button type="button" className="link" onClick={() => setPhoto(null)}>
                {l("Tutup", "Close")}
              </button>
            </div>
          )}
          {rows && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {writable && <th />}
                    <th>{l("Karyawan", "Employee")}</th>
                    <th>{l("Masuk", "Check in")}</th>
                    <th>{l("Pulang", "Check out")}</th>
                    <th className="num">{l("Jam kerja", "Worked hours")}</th>
                    <th>{l("Sumber", "Source")}</th>
                    <th className="num">{l("Jarak", "Distance")}</th>
                    <th>{l("Status", "Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      {writable && (
                        <td>
                          <input
                            type="checkbox"
                            aria-label={l("Pilih", "Select")}
                            checked={selected.has(r.id)}
                            onChange={() => toggle(r.id)}
                          />
                        </td>
                      )}
                      <td>{r.employeeName}</td>
                      <td>{time(r.checkIn)}</td>
                      <td>
                        {time(r.checkOut)}
                        {r.autoCheckout && <span className="muted"> ({l("otomatis", "auto")})</span>}
                      </td>
                      <td className="num">{r.workedHours ?? ""}</td>
                      <td>
                        {tx(SOURCE_LABEL[r.source] ?? L(r.source, r.source))}
                        {r.photoType && (
                          <>
                            {" "}
                            <button type="button" className="link" onClick={() => setPhoto(r.id)}>
                              📷
                            </button>
                          </>
                        )}
                        {r.note && <div className="muted">{r.note}</div>}
                      </td>
                      <td className="num">{r.distanceM !== null ? `${r.distanceM} m` : ""}</td>
                      <td>
                        <span className={`badge ${STATE_BADGE[r.state]}`}>
                          {r.state === "draft"
                            ? l("Draft", "Draft")
                            : r.state === "validated"
                              ? l("Valid", "Validated")
                              : l("Ditolak", "Refused")}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="muted">
                        {l("Belum ada absensi pada periode ini.", "No attendance in this period.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "today" && todayView && (
        <div className="data-grid">
          {Object.entries(todayView.groups)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([status, list]) => (
              <section key={status} className="panel">
                <h2>
                  {tx(STATUS_LABEL[status] ?? L(status, status))} ({list.length})
                </h2>
                <ul>
                  {list.map((p) => (
                    <li key={p.employeeName}>
                      {p.employeeName}
                      {p.firstIn && <span className="muted"> · {clock(p.firstIn)}</span>}
                      {p.lateMinutes > 0 && (
                        <span className="error"> · {l(`${p.lateMinutes} mnt`, `${p.lateMinutes} min`)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          {Object.keys(todayView.groups).length === 0 && (
            <p className="muted">{l("Tidak ada karyawan.", "No employees.")}</p>
          )}
        </div>
      )}

      {tab === "month" && (
        <>
          <div className="toolbar">
            <input
              type="month"
              aria-label={l("Bulan", "Month")}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
            <small className="muted">
              {Object.entries(STATUS_CODE)
                .filter(([, c]) => c && c !== "·" && c !== "•")
                .map(([k, c]) => `${c} = ${tx(STATUS_LABEL[k]!)}`)
                .join(" · ")}
            </small>
          </div>
          {summary && (
            <div className="table-wrap">
              <table className="attendance-matrix">
                <thead>
                  <tr>
                    <th>{l("Karyawan", "Employee")}</th>
                    {summary.rows[0]?.days.map((d) => (
                      <th key={d.date} className="num">
                        {Number(d.date.slice(8))}
                      </th>
                    ))}
                    <th className="num">{l("Hadir", "Present")}</th>
                    <th className="num">{l("Telat", "Late")}</th>
                    <th className="num">{l("Absen", "Absent")}</th>
                    <th className="num">{l("Cuti", "Leave")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((r) => (
                    <tr key={r.employeeId}>
                      <td>{r.employeeName}</td>
                      {r.days.map((d) => (
                        <td
                          key={d.date}
                          className={`num status-${d.status}`}
                          title={`${d.date}: ${tx(STATUS_LABEL[d.status]!)}${d.lateMinutes ? ` (${d.lateMinutes} mnt)` : ""}`}
                        >
                          {STATUS_CODE[d.status]}
                        </td>
                      ))}
                      <td className="num">{r.summary.present}</td>
                      <td className="num">
                        {r.summary.counts.late}
                        {r.summary.lateMinutes > 0 && (
                          <small className="muted"> ({r.summary.lateMinutes}′)</small>
                        )}
                      </td>
                      <td className="num">{r.summary.counts.absent}</td>
                      <td className="num">{r.summary.counts.time_off}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
