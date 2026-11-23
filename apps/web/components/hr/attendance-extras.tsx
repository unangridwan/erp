"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { formatDate, today } from "../../lib/format";
import { L, useI18n, type Text } from "../../lib/i18n";
import { LEAVE_STATE_LABEL } from "../../lib/resources";

export const CORRECTION_KIND: Record<"correction" | "business_trip" | "wfh", Text> = {
  correction: L("Lupa absen / koreksi", "Missed punch / correction"),
  business_trip: L("Dinas luar", "Business trip"),
  wfh: L("Kerja dari rumah", "Work from home"),
};

const SUMMARY_ITEMS: [string, Text][] = [
  ["on_time", L("Tepat waktu", "On time")],
  ["late", L("Terlambat", "Late")],
  ["early_out", L("Pulang cepat", "Early out")],
  ["no_checkout", L("Tidak absen pulang", "No check-out")],
  ["absent", L("Tidak hadir", "Absent")],
  ["time_off", L("Cuti", "Time off")],
  ["day_off", L("Hari libur", "Day off")],
  ["upcoming", L("Hari kerja berikutnya", "Next workdays")],
];

const errorText = (e: unknown) =>
  e instanceof ApiError
    ? (Object.values(e.fieldErrors)[0] ?? e.message)
    : e instanceof Error
      ? e.message
      : String(e);

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * Portal "Absensi saya": rekap bulanan (seperti log kehadiran), ajukan koreksi absensi (satu lampiran
 * PDF/JPG/PNG/CSV/XLSX maks. 5 MB), ajukan tukar shift, dan atur PIN kiosk.
 */
export function MyAttendance() {
  const { l, tx, locale } = useI18n();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [summary, setSummary] = useState<{
    row: {
      summary: { counts: Record<string, number>; lateMinutes: number };
      days: { date: string; status: string; lateMinutes: number }[];
    } | null;
  } | null>(null);
  const [requests, setRequests] = useState<
    { id: string; kind: keyof typeof CORRECTION_KIND; date: string; reason: string; state: string }[]
  >([]);
  const [shifts, setShifts] = useState<
    { id: string; scheduleName: string; dateFrom: string; dateTo: string; state: string }[]
  >([]);
  const [schedules, setSchedules] = useState<
    { id: string; name: string; startTime: string; endTime: string }[]
  >([]);
  const [mode, setMode] = useState<"" | "correction" | "shift" | "pin">("");
  const [form, setForm] = useState({
    kind: "correction",
    date: today(),
    checkIn: "08:00",
    checkOut: "17:00",
    reason: "",
  });
  const [file, setFile] = useState<{ name: string; type: string; data: string } | null>(null);
  const [shift, setShift] = useState({ scheduleId: "", dateFrom: today(), dateTo: today(), reason: "" });
  const [pin, setPin] = useState("");
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<typeof summary>(`/me/attendance-summary?month=${month}`).then(setSummary, () => setSummary(null));
  }, [month, version]);
  useEffect(() => {
    api<typeof requests>("/attendance-requests?mine=1").then(setRequests, () => setRequests([]));
    api<typeof shifts>("/shift-requests?mine=1").then(setShifts, () => setShifts([]));
    api<typeof schedules>("/me/work-schedules").then(setSchedules, () => setSchedules([]));
  }, [version]);

  async function run(fn: () => Promise<unknown>, message: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setMode("");
      setNotice(message);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(errorText(e));
    }
  }
  const submitCorrection = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () =>
        api("/attendance-requests", {
          method: "POST",
          body: { ...form, checkOut: form.checkOut || null, attachment: file },
        }),
      l("Koreksi absensi diajukan.", "Correction submitted."),
    );
  };
  const submitShift = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () => api("/shift-requests", { method: "POST", body: { ...shift, reason: shift.reason || null } }),
      l("Permintaan tukar shift diajukan.", "Shift change submitted."),
    );
  };
  const submitPin = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () => api("/me/attendance-pin", { method: "PUT", body: { pin } }),
      l("PIN kiosk disimpan.", "Kiosk PIN saved."),
    );
    setPin("");
  };
  const counts = summary?.row?.summary.counts ?? {};

  return (
    <section className="panel">
      <header className="toolbar">
        <h2>{l("Absensi saya", "My attendance")}</h2>
        <input
          type="month"
          aria-label={l("Bulan", "Month")}
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
        <button type="button" onClick={() => setMode(mode === "correction" ? "" : "correction")}>
          {l("Ajukan koreksi", "Request correction")}
        </button>
        <button type="button" onClick={() => setMode(mode === "shift" ? "" : "shift")}>
          {l("Tukar shift", "Change shift")}
        </button>
        <button type="button" className="link" onClick={() => setMode(mode === "pin" ? "" : "pin")}>
          {l("PIN kiosk", "Kiosk PIN")}
        </button>
      </header>
      {notice && <p className="notice">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="grid">
        {SUMMARY_ITEMS.map(([k, label]) => (
          <li key={k} className="card">
            <span>{tx(label)}</span>
            <strong>
              {counts[k] ?? 0}
              {k === "late" && (summary?.row?.summary.lateMinutes ?? 0) > 0 && (
                <small className="muted">
                  {" "}
                  ({summary!.row!.summary.lateMinutes} {l("mnt", "min")})
                </small>
              )}
            </strong>
          </li>
        ))}
      </ul>
      {mode === "correction" && (
        <form className="inline-panel" onSubmit={submitCorrection}>
          <label className="field">
            <span>{l("Jenis", "Kind")}</span>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(CORRECTION_KIND).map(([k, v]) => (
                <option key={k} value={k}>
                  {tx(v)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Tanggal", "Date")}</span>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Jam masuk", "Check in")}</span>
            <input
              type="time"
              value={form.checkIn}
              onChange={(e) => setForm({ ...form, checkIn: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Jam pulang", "Check out")}</span>
            <input
              type="time"
              value={form.checkOut}
              onChange={(e) => setForm({ ...form, checkOut: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Alasan (maks. 200 karakter)", "Reason (max 200 chars)")}</span>
            <input
              required
              maxLength={200}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Lampiran (maks. 5 MB)", "Attachment (max 5 MB)")}</span>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                setFile(
                  f
                    ? { name: f.name, type: f.type || "application/octet-stream", data: await readFile(f) }
                    : null,
                );
              }}
            />
          </label>
          <button className="primary">{l("Ajukan", "Submit")}</button>
        </form>
      )}
      {mode === "shift" && (
        <form className="inline-panel" onSubmit={submitShift}>
          <label className="field">
            <span>{l("Jadwal yang diminta", "Requested schedule")}</span>
            <select
              required
              value={shift.scheduleId}
              onChange={(e) => setShift({ ...shift, scheduleId: e.target.value })}
            >
              <option value="">—</option>
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.startTime}–{s.endTime})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Dari", "From")}</span>
            <input
              type="date"
              value={shift.dateFrom}
              onChange={(e) => setShift({ ...shift, dateFrom: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Sampai", "To")}</span>
            <input
              type="date"
              value={shift.dateTo}
              onChange={(e) => setShift({ ...shift, dateTo: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Alasan", "Reason")}</span>
            <input value={shift.reason} onChange={(e) => setShift({ ...shift, reason: e.target.value })} />
          </label>
          <button className="primary">{l("Ajukan", "Submit")}</button>
        </form>
      )}
      {mode === "pin" && (
        <form className="inline-panel" onSubmit={submitPin}>
          <label className="field">
            <span>
              {l("PIN baru (4–8 angka) untuk absen di kiosk", "New PIN (4–8 digits) for the kiosk")}
            </span>
            <input
              type="password"
              inputMode="numeric"
              pattern="\d{4,8}"
              required
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </label>
          <button className="primary">{l("Simpan PIN", "Save PIN")}</button>
        </form>
      )}
      {(requests.length > 0 || shifts.length > 0) && (
        <div className="table-wrap">
          <table>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{tx(CORRECTION_KIND[r.kind])}</td>
                  <td>{formatDate(r.date, locale)}</td>
                  <td>{r.reason}</td>
                  <td>{tx(LEAVE_STATE_LABEL[r.state]!)}</td>
                </tr>
              ))}
              {shifts.map((s) => (
                <tr key={s.id}>
                  <td>{l("Tukar shift", "Shift change")}</td>
                  <td>
                    {formatDate(s.dateFrom, locale)} – {formatDate(s.dateTo, locale)}
                  </td>
                  <td>{s.scheduleName}</td>
                  <td>{tx(LEAVE_STATE_LABEL[s.state]!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
