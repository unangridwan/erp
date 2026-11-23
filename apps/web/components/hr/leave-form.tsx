"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { formatDate, today } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { RefSelect } from "../ref-select";

interface DaysPreview {
  days: number;
  calendarDays: boolean;
  skipped: { date: string; reason: "day_off" | "national" | "collective" | "company"; name?: string }[];
}

export interface LeaveTypeOption {
  id: string;
  name: string;
  allowHalfDay?: boolean;
  requiresAttachment?: boolean;
  maxConsecutiveDays?: string | null;
  countCalendarDays?: boolean;
}

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * Form pengajuan cuti (HR & portal): setengah hari bila cuti sehari & jenisnya mengizinkan, lampiran (wajib bila
 * jenis cuti mewajibkan), delegasi tugas ke rekan. `chooseEmployee` = HR mengajukan atas nama karyawan.
 */
export function LeaveRequestForm(props: {
  types: LeaveTypeOption[];
  chooseEmployee?: boolean;
  /** Pilihan rekan untuk delegasi (portal); tanpa ini dipakai pencarian karyawan (HR). */
  colleagues?: { id: string; name: string }[];
  onSaved: () => void;
}) {
  const { l, locale } = useI18n();
  const empty = {
    employeeId: "",
    leaveTypeId: "",
    dateFrom: today(),
    dateTo: today(),
    halfDay: "",
    reason: "",
    delegateEmployeeId: "",
    delegateNote: "",
  };
  const [form, setForm] = useState(empty);
  const [file, setFile] = useState<{ name: string; type: string; data: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const type = props.types.find((t) => t.id === form.leaveTypeId);
  const single = form.dateFrom === form.dateTo;
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  // Pratinjau durasi menurut jadwal kerja & hari libur karyawan (portal: milik sendiri; HR: karyawan terpilih).
  const [preview, setPreview] = useState<DaysPreview | null>(null);
  const previewEmployee = props.chooseEmployee ? form.employeeId : "me";
  useEffect(() => {
    setPreview(null);
    if (!previewEmployee || !form.dateFrom || !form.dateTo || form.dateTo < form.dateFrom) return;
    const timer = setTimeout(() => {
      const body = {
        leaveTypeId: form.leaveTypeId || null,
        dateFrom: form.dateFrom,
        dateTo: form.dateTo,
        halfDay: single && form.halfDay ? form.halfDay : null,
      };
      api<DaysPreview>(props.chooseEmployee ? "/work-calendar/leave-days" : "/me/leave-days", {
        method: "POST",
        body: props.chooseEmployee ? { ...body, employeeId: form.employeeId } : body,
      }).then(setPreview, () => setPreview(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [
    previewEmployee,
    props.chooseEmployee,
    form.employeeId,
    form.leaveTypeId,
    form.dateFrom,
    form.dateTo,
    form.halfDay,
    single,
  ]);
  const skipLabel = (s: DaysPreview["skipped"][number]) =>
    s.reason === "day_off" ? l("libur jadwal", "scheduled day off") : (s.name ?? l("hari libur", "holiday"));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setErrors({});
    setBusy(true);
    try {
      await api("/leaves", {
        method: "POST",
        body: {
          ...(props.chooseEmployee && form.employeeId ? { employeeId: form.employeeId } : {}),
          leaveTypeId: form.leaveTypeId,
          dateFrom: form.dateFrom,
          dateTo: form.dateTo,
          halfDay: single && form.halfDay ? form.halfDay : null,
          reason: form.reason || null,
          attachment: file,
          delegateEmployeeId: form.delegateEmployeeId || null,
          delegateNote: form.delegateNote || null,
        },
      });
      setForm(empty);
      setFile(null);
      props.onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setError(Object.values(err.fieldErrors)[0] ?? err.message);
      } else setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="inline-panel" onSubmit={submit}>
      {props.chooseEmployee && (
        <label className="field">
          <span>{l("Karyawan", "Employee")}</span>
          <RefSelect
            name="employeeId"
            resource="employees"
            display="name"
            required
            value={form.employeeId}
            onChange={(v) => set({ employeeId: v })}
          />
        </label>
      )}
      <label className="field">
        <span>{l("Jenis", "Type")}</span>
        <select required value={form.leaveTypeId} onChange={(e) => set({ leaveTypeId: e.target.value })}>
          <option value="">—</option>
          {props.types.map((t) => (
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
          onChange={(e) =>
            set({
              dateFrom: e.target.value,
              dateTo: form.dateTo < e.target.value ? e.target.value : form.dateTo,
            })
          }
        />
        {errors.dateFrom && <small className="error">{errors.dateFrom}</small>}
      </label>
      <label className="field">
        <span>{l("Sampai", "To")}</span>
        <input type="date" value={form.dateTo} onChange={(e) => set({ dateTo: e.target.value })} />
        {errors.dateTo && <small className="error">{errors.dateTo}</small>}
      </label>
      {single && type?.allowHalfDay !== false && (
        <label className="field">
          <span>{l("Durasi", "Duration")}</span>
          <select value={form.halfDay} onChange={(e) => set({ halfDay: e.target.value })}>
            <option value="">{l("Sehari penuh", "Full day")}</option>
            <option value="am">{l("Setengah hari (pagi)", "Half day (morning)")}</option>
            <option value="pm">{l("Setengah hari (siang)", "Half day (afternoon)")}</option>
          </select>
        </label>
      )}
      <label className="field">
        <span>{l("Alasan", "Reason")}</span>
        <input value={form.reason} onChange={(e) => set({ reason: e.target.value })} />
      </label>
      <label className="field">
        <span>
          {l("Lampiran", "Attachment")}
          {type?.requiresAttachment && " *"}
        </span>
        <input
          type="file"
          aria-label={l("Lampiran", "Attachment")}
          accept="application/pdf,image/jpeg,image/png"
          required={type?.requiresAttachment}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setFile(f ? { name: f.name, type: f.type, data: await readFile(f) } : null);
          }}
        />
        {errors.attachment && <small className="error">{errors.attachment}</small>}
      </label>
      <label className="field">
        <span>{l("Delegasi tugas ke", "Delegate tasks to")}</span>
        {props.colleagues ? (
          <select
            value={form.delegateEmployeeId}
            onChange={(e) => set({ delegateEmployeeId: e.target.value })}
          >
            <option value="">—</option>
            {props.colleagues.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <RefSelect
            name="delegateEmployeeId"
            resource="employees"
            display="name"
            value={form.delegateEmployeeId}
            onChange={(v) => set({ delegateEmployeeId: v })}
          />
        )}
      </label>
      {form.delegateEmployeeId && (
        <label className="field">
          <span>{l("Catatan delegasi", "Delegation note")}</span>
          <input value={form.delegateNote} onChange={(e) => set({ delegateNote: e.target.value })} />
        </label>
      )}
      <button className="primary" disabled={busy}>
        {l("Ajukan", "Submit")}
      </button>
      {preview && (
        <p className="muted leave-preview" aria-live="polite">
          <strong>
            {preview.calendarDays
              ? l(`${preview.days} hari kalender`, `${preview.days} calendar days`)
              : l(`${preview.days} hari kerja`, `${preview.days} working days`)}
          </strong>
          {!preview.calendarDays && preview.skipped.length > 0 && (
            <>
              {" — "}
              {l("tidak dihitung: ", "not counted: ")}
              {preview.skipped
                .slice(0, 6)
                .map((s) => `${formatDate(s.date, locale)} (${skipLabel(s)})`)
                .join(", ")}
              {preview.skipped.length > 6 && ` +${preview.skipped.length - 6}`}
            </>
          )}
        </p>
      )}
      {type?.maxConsecutiveDays && (
        <small className="muted">
          {l(
            `Maksimal ${Number(type.maxConsecutiveDays)} hari per pengajuan.`,
            `At most ${Number(type.maxConsecutiveDays)} days per request.`,
          )}
        </small>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
