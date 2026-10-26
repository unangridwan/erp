"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { useI18n } from "../../lib/i18n";

interface Warning {
  code: string;
  severity: "error" | "warning";
  employeeId: string;
  employeeName: string;
  slipId: string;
  value: string | number | null;
}

/**
 * Dashboard peringatan payroll (pemeriksaan sebelum posting/transfer): dikelompokkan per jenis, tiap jenis
 * mencantumkan karyawan yang terkena dengan tautan ke slipnya.
 */
export function PayrollWarnings({ runId, version }: { runId: string; version: number }) {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Warning[] | null>(null);
  useEffect(() => {
    api<Warning[]>(`/payroll-runs/${runId}/warnings`).then(setRows, () => setRows([]));
  }, [runId, version]);
  if (!rows) return null;
  if (!rows.length)
    return <p className="notice">{l("Tidak ada peringatan payroll.", "No payroll warnings.")}</p>;

  const label = (w: Warning) => {
    const v = w.value;
    switch (w.code) {
      case "net_negative":
        return l("Gaji bersih minus", "Negative net pay");
      case "net_zero":
        return l("Gaji bersih nol", "Zero net pay");
      case "no_bank_account":
        return l("Rekening bank belum diisi", "No bank account");
      case "no_tax_id":
        return l("Tanpa NPWP/NIK (PPh 21 +20%)", "No NPWP/NIK (PPh 21 +20%)");
      case "no_bpjs_kes_no":
        return l("No. BPJS Kesehatan kosong", "No BPJS Health number");
      case "no_bpjs_tk_no":
        return l("No. BPJS Ketenagakerjaan kosong", "No BPJS Employment number");
      case "net_change":
        return l(`Gaji bersih berubah ${v}% dari bulan lalu`, `Net pay changed ${v}% from last month`);
      case "first_payslip":
        return l("Slip gaji pertama", "First payslip");
      case "contract_ending":
        return l(
          `Kontrak berakhir ${formatDate(String(v), locale)}`,
          `Contract ends ${formatDate(String(v), locale)}`,
        );
      case "held":
        return l(`Gaji ditahan: ${v}`, `Salary on hold: ${v}`);
      case "attendance_draft":
        return l(`${v} absensi belum divalidasi`, `${v} attendance records not validated`);
      case "pending_leave":
        return l(`${v} cuti menunggu persetujuan`, `${v} leave requests pending`);
      case "pending_overtime":
        return l(`${v} lembur menunggu persetujuan`, `${v} overtime requests pending`);
      case "pending_attendance_request":
        return l(`${v} koreksi absensi menunggu persetujuan`, `${v} attendance corrections pending`);
      case "pending_expense_claim":
        return l(`${v} klaim (via slip) menunggu persetujuan`, `${v} payslip claims pending`);
      default:
        return w.code;
    }
  };
  const errors = rows.filter((w) => w.severity === "error").length;
  return (
    <details className="payroll-warnings" open={errors > 0}>
      <summary>
        {errors > 0 && <span className="badge state-cancel">{errors}</span>}{" "}
        {l(`${rows.length} peringatan payroll`, `${rows.length} payroll warnings`)}
      </summary>
      <ul>
        {rows.map((w) => (
          <li key={w.code + w.slipId} className={w.severity}>
            <a href={`/payroll/payslips/${w.slipId}`}>{w.employeeName}</a> — {label(w)}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Buat payroll koreksi (off-cycle) untuk karyawan terpilih dari payroll reguler yang sudah diposting. */
export function CorrectionForm({
  runId,
  employees,
}: {
  runId: string;
  employees: { employeeId: string; employeeName: string }[];
}) {
  const { l } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [paymentDate, setPaymentDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const run = await api<{ id: string }>(`/payroll-runs/${runId}/corrections`, {
        method: "POST",
        body: { paymentDate, employeeIds: selected },
      });
      router.push(`/payroll/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)}>
        {l("Buat payroll koreksi", "Create correction payroll")}
      </button>
    );
  return (
    <form className="inline-panel correction-form" onSubmit={submit}>
      <p className="muted">
        {l(
          "Slip koreksi berisi selisih (isi tunjangan/potongan di tiap slip); PPh 21 dihitung ulang atas bruto gabungan bulan ini.",
          "Correction payslips hold the difference (enter allowances/deductions per slip); PPh 21 is recomputed on this month's combined gross.",
        )}
      </p>
      <fieldset>
        <legend>{l("Karyawan", "Employees")}</legend>
        {employees.map((e) => (
          <label key={e.employeeId} className="check">
            <input
              type="checkbox"
              checked={selected.includes(e.employeeId)}
              onChange={(ev) =>
                setSelected((s) =>
                  ev.target.checked ? [...s, e.employeeId] : s.filter((x) => x !== e.employeeId),
                )
              }
            />
            {e.employeeName}
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>{l("Tanggal bayar", "Payment date")}</span>
        <input type="date" required value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
      </label>
      <button className="primary" disabled={!selected.length}>
        {l("Buat koreksi", "Create correction")}
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        {l("Batal", "Cancel")}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
