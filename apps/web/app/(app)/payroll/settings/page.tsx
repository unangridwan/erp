"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { PayrollParametersPanel } from "../../../../components/payroll/parameters-panel";
import { api, ApiError } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

type Settings = Record<
  | "jkkRate"
  | "kesWageCap"
  | "jpWageCap"
  | "salaryExpenseAccountId"
  | "bpjsKesExpenseAccountId"
  | "bpjsTkExpenseAccountId"
  | "salaryPayableAccountId"
  | "pph21PayableAccountId"
  | "bpjsKesPayableAccountId"
  | "bpjsTkPayableAccountId"
  | "journalId"
  | "timezone"
  | "employeeLoanAccountId"
  | "leaveApprovalLevels"
  | "overtimeApprovalLevels"
  | "casualFullBpjsMonths"
  | "expenseApprovalLevels"
  | "thrComponentId"
  | "retroComponentId"
  | "transferSourceAccount"
  | "transferCompanyCode"
  | "attendanceValidation"
  | "attendanceLockDate"
  | "autoCheckoutHours"
  | "attendanceApprovalLevels"
  | "overtimeFromAttendance"
  | "overtimeMinMinutes"
  | "overtimeRoundMinutes"
  | "overtimeMaxHours"
  | "overtimeCountEarly"
  | "bp21NonPermanentCode"
  | "bp21NonEmployeeCode"
  | "payrollRunApproval"
  | "movementApproval"
  | "jobOfferApproval"
  | "applicantRetentionMonths"
  | "payslipPinRequired",
  string
>;

/** Pengaturan payroll: tarif JKK, batas upah BPJS, serta akun & jurnal gaji. */
export default function PayrollSettingsPage() {
  const { l } = useI18n();
  const accounts = useOptions<{ id: string; code: string; name: string }>("/accounts");
  const journals = useOptions<{ id: string; code: string; name: string; journalType: string }>("/journals");
  const components = useOptions<{ id: string; code: string; name: string; kind: string }>(
    "/salary-components",
  );
  const [form, setForm] = useState<Settings | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Settings>("/payroll/settings")
      .then((s) =>
        setForm({
          ...s,
          jkkRate: String(Number(s.jkkRate)),
          kesWageCap: String(Number(s.kesWageCap)),
          jpWageCap: String(Number(s.jpWageCap)),
          employeeLoanAccountId: s.employeeLoanAccountId ?? "",
          leaveApprovalLevels: String(s.leaveApprovalLevels),
          overtimeApprovalLevels: String(s.overtimeApprovalLevels),
          casualFullBpjsMonths: String(s.casualFullBpjsMonths),
          expenseApprovalLevels: String(s.expenseApprovalLevels),
          thrComponentId: s.thrComponentId ?? "",
          retroComponentId: s.retroComponentId ?? "",
          transferSourceAccount: s.transferSourceAccount ?? "",
          transferCompanyCode: s.transferCompanyCode ?? "",
          attendanceValidation: s.attendanceValidation ? "1" : "",
          attendanceLockDate: s.attendanceLockDate ?? "",
          autoCheckoutHours: s.autoCheckoutHours ? String(s.autoCheckoutHours) : "",
          attendanceApprovalLevels: String(s.attendanceApprovalLevels ?? 1),
          overtimeFromAttendance: s.overtimeFromAttendance ? "1" : "",
          overtimeMinMinutes: String(s.overtimeMinMinutes ?? 30),
          overtimeRoundMinutes: String(s.overtimeRoundMinutes ?? 30),
          overtimeMaxHours: String(s.overtimeMaxHours ?? 4),
          overtimeCountEarly: s.overtimeCountEarly ? "1" : "",
          bp21NonPermanentCode: s.bp21NonPermanentCode ?? "",
          bp21NonEmployeeCode: s.bp21NonEmployeeCode ?? "",
          payrollRunApproval: s.payrollRunApproval ? "1" : "",
          movementApproval: s.movementApproval ? "1" : "",
          jobOfferApproval: s.jobOfferApproval ? "1" : "",
          applicantRetentionMonths: s.applicantRetentionMonths ? String(s.applicantRetentionMonths) : "",
          payslipPinRequired: s.payslipPinRequired ? "1" : "",
        }),
      )
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setNotice(null);
    try {
      const {
        jkkRate,
        kesWageCap,
        jpWageCap,
        salaryExpenseAccountId,
        bpjsKesExpenseAccountId,
        bpjsTkExpenseAccountId,
        salaryPayableAccountId,
        pph21PayableAccountId,
        bpjsKesPayableAccountId,
        bpjsTkPayableAccountId,
        journalId,
        timezone,
        employeeLoanAccountId,
        leaveApprovalLevels,
        overtimeApprovalLevels,
        casualFullBpjsMonths,
        expenseApprovalLevels,
        thrComponentId,
        retroComponentId,
        transferSourceAccount,
        transferCompanyCode,
        attendanceValidation,
        attendanceLockDate,
        autoCheckoutHours,
        attendanceApprovalLevels,
        overtimeFromAttendance,
        overtimeMinMinutes,
        overtimeRoundMinutes,
        overtimeMaxHours,
        overtimeCountEarly,
        bp21NonPermanentCode,
        bp21NonEmployeeCode,
        payrollRunApproval,
        movementApproval,
        jobOfferApproval,
        applicantRetentionMonths,
        payslipPinRequired,
      } = form;
      await api("/payroll/settings", {
        method: "PUT",
        body: {
          jkkRate: Number(jkkRate).toFixed(2),
          kesWageCap,
          jpWageCap,
          salaryExpenseAccountId,
          bpjsKesExpenseAccountId,
          bpjsTkExpenseAccountId,
          salaryPayableAccountId,
          pph21PayableAccountId,
          bpjsKesPayableAccountId,
          bpjsTkPayableAccountId,
          journalId,
          timezone,
          employeeLoanAccountId: employeeLoanAccountId || null,
          leaveApprovalLevels: Number(leaveApprovalLevels),
          overtimeApprovalLevels: Number(overtimeApprovalLevels),
          casualFullBpjsMonths: Number(casualFullBpjsMonths),
          expenseApprovalLevels: Number(expenseApprovalLevels),
          thrComponentId: thrComponentId || null,
          retroComponentId: retroComponentId || null,
          transferSourceAccount: transferSourceAccount || null,
          transferCompanyCode: transferCompanyCode || null,
          attendanceValidation: attendanceValidation === "1",
          attendanceLockDate: attendanceLockDate || null,
          autoCheckoutHours: autoCheckoutHours ? Number(autoCheckoutHours) : null,
          attendanceApprovalLevels: Number(attendanceApprovalLevels),
          overtimeFromAttendance: overtimeFromAttendance === "1",
          overtimeMinMinutes: Number(overtimeMinMinutes),
          overtimeRoundMinutes: Number(overtimeRoundMinutes),
          overtimeMaxHours: Number(overtimeMaxHours),
          overtimeCountEarly: overtimeCountEarly === "1",
          bp21NonPermanentCode: bp21NonPermanentCode || null,
          bp21NonEmployeeCode: bp21NonEmployeeCode || null,
          payrollRunApproval: payrollRunApproval === "1",
          movementApproval: movementApproval === "1",
          jobOfferApproval: jobOfferApproval === "1",
          applicantRetentionMonths: applicantRetentionMonths ? Number(applicantRetentionMonths) : null,
          payslipPinRequired: payslipPinRequired === "1",
        },
      });
      setNotice(l("Pengaturan disimpan.", "Settings saved."));
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : String(err));
    }
  }

  if (!form) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  const set = (k: keyof Settings) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f!, [k]: e.target.value }));
  const accountSelect = (k: keyof Settings, label: string, optional = false) => (
    <label className="field">
      <span>{label}</span>
      <select value={form[k]} onChange={set(k)}>
        {optional && <option value="">—</option>}
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} {a.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <form className="panel narrow stack" onSubmit={save}>
        <h1>{l("Pengaturan Payroll", "Payroll Settings")}</h1>
        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        <label className="field">
          <span>{l("Tarif JKK (kelompok risiko)", "JKK rate (risk group)")}</span>
          <select value={form.jkkRate} onChange={set("jkkRate")}>
            {["0.24", "0.54", "0.89", "1.27", "1.74"].map((r) => (
              <option key={r} value={String(Number(r))}>
                {r}%
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{l("Batas upah BPJS Kesehatan", "BPJS Health wage cap")}</span>
          <input className="num" inputMode="decimal" value={form.kesWageCap} onChange={set("kesWageCap")} />
        </label>
        <label className="field">
          <span>
            {l(
              "Batas upah Jaminan Pensiun (disesuaikan BPJS tiap Maret)",
              "Pension (JP) wage cap (updated each March)",
            )}
          </span>
          <input className="num" inputMode="decimal" value={form.jpWageCap} onChange={set("jpWageCap")} />
        </label>
        <p className="muted small">
          {l(
            "Tarif & batas di atas mengubah parameter yang berlaku hari ini. Perubahan mulai tanggal tertentu (mis. batas JP baru per Maret) ditambahkan di tabel per tanggal berlaku di bawah.",
            "The rate & caps above change the parameter in effect today. Changes from a given date (e.g. a new JP cap from March) are added in the table by effective date below.",
          )}
        </p>
        <label className="field">
          <span>
            {l(
              "Kode objek pajak BP21 — pegawai tidak tetap",
              "BP21 tax object code — non-permanent employees",
            )}
          </span>
          <input
            value={form.bp21NonPermanentCode}
            placeholder="21-100-xx"
            onChange={set("bp21NonPermanentCode")}
          />
        </label>
        <label className="field">
          <span>{l("Kode objek pajak BP21 — bukan pegawai", "BP21 tax object code — non-employees")}</span>
          <input
            value={form.bp21NonEmployeeCode}
            placeholder="21-100-xx"
            onChange={set("bp21NonEmployeeCode")}
          />
          <small className="muted">
            {l(
              'Pilih sesuai "Nama Objek Pajak" di e-Bupot BP21 Coretax; kosong = diisi per bukti potong sebelum ekspor.',
              'Choose to match the "tax object name" in the Coretax BP21 e-Bupot; empty = fill in per slip before export.',
            )}
          </small>
        </label>
        {accountSelect("salaryExpenseAccountId", l("Akun beban gaji", "Salary expense account"))}
        {accountSelect("salaryPayableAccountId", l("Akun utang gaji", "Salary payable account"))}
        {accountSelect("pph21PayableAccountId", l("Akun utang PPh 21", "PPh 21 payable account"))}
        {accountSelect(
          "bpjsKesExpenseAccountId",
          l("Akun beban BPJS Kesehatan (perusahaan)", "BPJS Health expense account (employer)"),
        )}
        {accountSelect(
          "bpjsKesPayableAccountId",
          l("Akun utang BPJS Kesehatan", "BPJS Health payable account"),
        )}
        {accountSelect(
          "bpjsTkExpenseAccountId",
          l("Akun beban BPJS Ketenagakerjaan (perusahaan)", "BPJS Employment expense account (employer)"),
        )}
        {accountSelect(
          "bpjsTkPayableAccountId",
          l("Akun utang BPJS Ketenagakerjaan", "BPJS Employment payable account"),
        )}
        {accountSelect(
          "employeeLoanAccountId",
          l("Akun piutang karyawan (pinjaman/kasbon)", "Employee loan receivable account"),
          true,
        )}
        <label className="field">
          <span>{l("Jurnal gaji", "Payroll journal")}</span>
          <select value={form.journalId} onChange={set("journalId")}>
            {journals
              .filter((j) => j.journalType === "general")
              .map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code} {j.name}
                </option>
              ))}
          </select>
        </label>
        <h2>{l("THR, rapel & transfer gaji", "THR, back pay & salary transfer")}</h2>
        {(
          [
            ["thrComponentId", l("Komponen THR otomatis", "Automatic THR component")],
            ["retroComponentId", l("Komponen rapel otomatis", "Automatic back-pay component")],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="field">
            <span>{label}</span>
            <select value={form[k]} onChange={set(k)}>
              <option value="">—</option>
              {components
                .filter((c) => c.kind === "allowance")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} {c.name}
                  </option>
                ))}
            </select>
          </label>
        ))}
        <label className="field">
          <span>
            {l(
              "Rekening sumber transfer gaji (didebet di file unggah bank)",
              "Salary transfer source account (debited in bank upload files)",
            )}
          </span>
          <input
            inputMode="numeric"
            value={form.transferSourceAccount}
            onChange={set("transferSourceAccount")}
          />
        </label>
        <label className="field">
          <span>
            {l("Corporate ID / kode perusahaan di bank (opsional)", "Bank corporate ID (optional)")}
          </span>
          <input value={form.transferCompanyCode} onChange={set("transferCompanyCode")} />
        </label>
        <h2>{l("Absensi & persetujuan", "Attendance & approvals")}</h2>
        <label className="field">
          <span>{l("Zona waktu absensi", "Attendance time zone")}</span>
          <select value={form.timezone} onChange={set("timezone")}>
            {[
              ["Asia/Jakarta", "WIB (Asia/Jakarta)"],
              ["Asia/Makassar", "WITA (Asia/Makassar)"],
              ["Asia/Jayapura", "WIT (Asia/Jayapura)"],
            ].map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{l("Tahap persetujuan cuti", "Time-off approval steps")}</span>
          <select value={form.leaveApprovalLevels} onChange={set("leaveApprovalLevels")}>
            <option value="1">{l("1 — atasan langsung", "1 — direct manager")}</option>
            <option value="2">{l("2 — + atasan dari atasan", "2 — + manager's manager")}</option>
            <option value="3">{l("3 — + HR", "3 — + HR")}</option>
          </select>
        </label>
        <label className="field">
          <span>{l("Tahap persetujuan lembur", "Overtime approval steps")}</span>
          <select value={form.overtimeApprovalLevels} onChange={set("overtimeApprovalLevels")}>
            <option value="0">{l("0 — langsung disetujui", "0 — approved on entry")}</option>
            <option value="1">{l("1 — atasan langsung", "1 — direct manager")}</option>
            <option value="2">{l("2 — + atasan dari atasan", "2 — + manager's manager")}</option>
            <option value="3">{l("3 — + HR", "3 — + HR")}</option>
          </select>
        </label>
        <label className="field">
          <span>{l("Lembur dari absensi", "Overtime from attendance")}</span>
          <select value={form.overtimeFromAttendance} onChange={set("overtimeFromAttendance")}>
            <option value="">{l("Tidak — diajukan manual", "No — entered manually")}</option>
            <option value="1">
              {l("Ya — dari absensi, disetujui atasan", "Yes — from attendance, manager approves")}
            </option>
          </select>
        </label>
        {form.overtimeFromAttendance === "1" && (
          <>
            <label className="field">
              <span>{l("Lembur minimal dihitung (menit)", "Minimum overtime counted (minutes)")}</span>
              <input
                className="num"
                type="number"
                min="0"
                max="240"
                value={form.overtimeMinMinutes}
                onChange={set("overtimeMinMinutes")}
              />
            </label>
            <label className="field">
              <span>{l("Dibulatkan ke bawah per (menit)", "Rounded down to (minutes)")}</span>
              <select value={form.overtimeRoundMinutes} onChange={set("overtimeRoundMinutes")}>
                {["1", "15", "30", "60"].map((m) => (
                  <option key={m} value={m}>
                    {m === "1" ? l("Tanpa pembulatan", "No rounding") : `${m} ${l("menit", "minutes")}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Maksimal lembur per hari kerja (jam)", "Max overtime per workday (hours)")}</span>
              <input
                className="num"
                type="number"
                min="1"
                max="12"
                value={form.overtimeMaxHours}
                onChange={set("overtimeMaxHours")}
              />
            </label>
            <label className="field">
              <span>{l("Datang sebelum jam masuk", "Arriving before start time")}</span>
              <select value={form.overtimeCountEarly} onChange={set("overtimeCountEarly")}>
                <option value="">{l("Tidak dihitung lembur", "Not counted as overtime")}</option>
                <option value="1">{l("Dihitung lembur", "Counted as overtime")}</option>
              </select>
            </label>
          </>
        )}
        <label className="field">
          <span>{l("Tahap persetujuan klaim biaya", "Expense claim approval steps")}</span>
          <select value={form.expenseApprovalLevels} onChange={set("expenseApprovalLevels")}>
            <option value="1">{l("1 — atasan langsung", "1 — direct manager")}</option>
            <option value="2">{l("2 — + atasan dari atasan", "2 — + manager's manager")}</option>
            <option value="3">{l("3 — + HR", "3 — + HR")}</option>
          </select>
        </label>
        <label className="field">
          <span>
            {l(
              "Tahap persetujuan koreksi absensi & tukar shift",
              "Attendance correction & shift change steps",
            )}
          </span>
          <select value={form.attendanceApprovalLevels} onChange={set("attendanceApprovalLevels")}>
            <option value="1">{l("1 — atasan langsung", "1 — direct manager")}</option>
            <option value="2">{l("2 — + atasan dari atasan", "2 — + manager's manager")}</option>
            <option value="3">{l("3 — + HR", "3 — + HR")}</option>
          </select>
        </label>
        <label className="field">
          <span>{l("Validasi absensi", "Attendance validation")}</span>
          <select value={form.attendanceValidation} onChange={set("attendanceValidation")}>
            <option value="">
              {l("Tidak — absensi langsung dipakai payroll", "No — attendance is used by payroll directly")}
            </option>
            <option value="1">
              {l("Ya — absensi baru harus divalidasi HR", "Yes — new attendance must be validated by HR")}
            </option>
          </select>
        </label>
        <label className="field">
          <span>
            {l(
              "Kunci absensi s.d. tanggal (maju otomatis saat payroll diposting)",
              "Lock attendance up to (advances automatically when payroll is posted)",
            )}
          </span>
          <input type="date" value={form.attendanceLockDate} onChange={set("attendanceLockDate")} />
        </label>
        <label className="field">
          <span>
            {l(
              "Tutup otomatis absensi yang lupa pulang setelah (jam, kosong = tidak)",
              "Auto check-out forgotten attendance after (hours, empty = off)",
            )}
          </span>
          <input
            className="num"
            type="number"
            min="4"
            max="24"
            value={form.autoCheckoutHours}
            onChange={set("autoCheckoutHours")}
          />
        </label>
        <label className="field">
          <span>
            {l(
              "Pekerja harian/borongan: bulan masa kerja sebelum ikut BPJS penuh (sebelumnya JKK & JKM saja)",
              "Daily/piece workers: months of service before full BPJS (JKK & JKM only before that)",
            )}
          </span>
          <input
            className="num"
            inputMode="numeric"
            value={form.casualFullBpjsMonths}
            onChange={set("casualFullBpjsMonths")}
          />
        </label>
        <h3 className="o-group-title">{l("Persetujuan dokumen", "Document approvals")}</h3>
        <p className="muted small">
          {l(
            "Bila diaktifkan, dokumen harus diajukan dan disetujui (mengikuti Aturan Persetujuan & batas wewenang) sebelum diproses.",
            "When enabled, documents must be submitted and approved (following Approval Rules & limits) before processing.",
          )}
        </p>
        {(
          [
            [
              "payrollRunApproval",
              l("Payroll run disetujui sebelum diposting", "Payroll runs approved before posting"),
            ],
            [
              "movementApproval",
              l("Mutasi/promosi disetujui sebelum diterapkan", "Movements approved before applying"),
            ],
            [
              "jobOfferApproval",
              l("Penawaran kerja disetujui sebelum dikirim", "Job offers approved before sending"),
            ],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="field check">
            <input
              type="checkbox"
              checked={form[k] === "1"}
              onChange={(e) => setForm((f) => ({ ...f!, [k]: e.target.checked ? "1" : "" }))}
            />
            <span>{label}</span>
          </label>
        ))}
        <h3 className="o-group-title">{l("Perlindungan data pribadi", "Personal data protection")}</h3>
        <label className="field check">
          <input
            type="checkbox"
            checked={form.payslipPinRequired === "1"}
            onChange={(e) => setForm((f) => ({ ...f!, payslipPinRequired: e.target.checked ? "1" : "" }))}
          />
          <span>
            {l(
              "Karyawan wajib memasukkan PIN slip (6 digit) sebelum melihat slip gaji di portal",
              "Employees must enter a 6-digit payslip PIN before viewing payslips in the portal",
            )}
          </span>
        </label>
        <label className="field">
          <span>
            {l(
              "Masa simpan data pelamar ditolak / lowongan ditutup (bulan; kosong = tidak dianonimkan otomatis)",
              "Retention of refused applicants / closed openings (months; empty = no automatic anonymization)",
            )}
          </span>
          <input
            className="num"
            inputMode="numeric"
            value={form.applicantRetentionMonths}
            onChange={set("applicantRetentionMonths")}
          />
        </label>
        <button className="primary">{l("Simpan", "Save")}</button>
      </form>
      <PayrollParametersPanel onChange={load} />
    </>
  );
}
