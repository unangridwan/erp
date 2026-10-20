"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { today } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { RefSelect } from "../ref-select";

export interface ClaimLineForm {
  id?: string;
  categoryId: string;
  date: string;
  amount: string;
  note: string;
  attachmentName?: string | null;
  attachment?: { name: string; type: string; data: string } | null;
}
export interface ClaimForm {
  employeeId?: string;
  date: string;
  description: string;
  payMethod: "payslip" | "cash";
  lines: ClaimLineForm[];
}

const emptyLine = (): ClaimLineForm => ({ categoryId: "", date: today(), amount: "", note: "" });
export const emptyClaim = (): ClaimForm => ({
  date: today(),
  description: "",
  payMethod: "payslip",
  lines: [emptyLine()],
});

/** Baca berkas bukti sebagai base64 (tanpa prefiks data URL). */
const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * Form klaim biaya (portal & HR): baris per kategori dengan bukti PDF/JPG/PNG maks. 2 MB.
 * `chooseEmployee` menampilkan pilihan karyawan (HR membuat klaim untuk orang lain).
 */
export function ExpenseClaimForm(props: {
  categories: { id: string; name: string; annualLimit?: string | null }[];
  initial?: ClaimForm;
  claimId?: string;
  chooseEmployee?: boolean;
  onSaved: (claim: { id: string }) => void;
  onCancel?: () => void;
}) {
  const { l } = useI18n();
  const [form, setForm] = useState<ClaimForm>(props.initial ?? emptyClaim());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setLine = (i: number, patch: Partial<ClaimLineForm>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  async function save(e: FormEvent, submit: boolean) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        ...(form.employeeId ? { employeeId: form.employeeId } : {}),
        date: form.date,
        description: form.description || null,
        payMethod: form.payMethod,
        lines: form.lines.map((x) => ({
          ...(x.id ? { id: x.id } : {}),
          categoryId: x.categoryId,
          date: x.date,
          amount: x.amount,
          note: x.note || null,
          ...(x.attachment ? { attachment: x.attachment } : {}),
        })),
      };
      const claim = await api<{ id: string }>(
        props.claimId ? `/expense-claims/${props.claimId}` : "/expense-claims",
        {
          method: props.claimId ? "PUT" : "POST",
          body,
        },
      );
      if (submit) await api(`/expense-claims/${claim.id}/submit`, { method: "POST" });
      props.onSaved(claim);
      if (!props.claimId) setForm(emptyClaim());
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(e) => save(e, true)}>
      <div className="inline-panel">
        {props.chooseEmployee && (
          <label className="field">
            <span>{l("Karyawan *", "Employee *")}</span>
            <RefSelect
              name="employeeId"
              resource="employees"
              display="name"
              required
              value={form.employeeId ?? ""}
              onChange={(v) => setForm((f) => ({ ...f, employeeId: v }))}
            />
          </label>
        )}
        <label className="field">
          <span>{l("Tanggal", "Date")}</span>
          <input
            type="date"
            required
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Keperluan", "Purpose")}</span>
          <input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Dibayar", "Paid")}</span>
          <select
            value={form.payMethod}
            onChange={(e) => setForm((f) => ({ ...f, payMethod: e.target.value as ClaimForm["payMethod"] }))}
          >
            <option value="payslip">{l("Bersama gaji berikutnya", "With the next payslip")}</option>
            <option value="cash">{l("Langsung (kas/bank)", "Directly (cash/bank)")}</option>
          </select>
        </label>
      </div>
      <table className="lines">
        <thead>
          <tr>
            <th>{l("Kategori", "Category")}</th>
            <th>{l("Tanggal", "Date")}</th>
            <th className="num">{l("Jumlah", "Amount")}</th>
            <th>{l("Catatan", "Note")}</th>
            <th>{l("Bukti", "Receipt")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {form.lines.map((x, i) => (
            <tr key={i}>
              <td>
                <select
                  required
                  aria-label={l("Kategori", "Category")}
                  value={x.categoryId}
                  onChange={(e) => setLine(i, { categoryId: e.target.value })}
                >
                  <option value="">—</option>
                  {props.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  type="date"
                  required
                  value={x.date}
                  onChange={(e) => setLine(i, { date: e.target.value })}
                />
              </td>
              <td>
                <input
                  className="num"
                  inputMode="decimal"
                  required
                  aria-label={l("Jumlah", "Amount")}
                  value={x.amount}
                  onChange={(e) => setLine(i, { amount: e.target.value })}
                />
              </td>
              <td>
                <input
                  aria-label={l("Catatan", "Note")}
                  value={x.note}
                  onChange={(e) => setLine(i, { note: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  aria-label={l("Bukti", "Receipt")}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 2 * 1024 * 1024) {
                      setError(l("Berkas maksimal 2 MB", "Files may be at most 2 MB"));
                      return;
                    }
                    setLine(i, {
                      attachment: { name: file.name, type: file.type, data: await readFile(file) },
                    });
                  }}
                />
                {!x.attachment && x.attachmentName && <small className="muted"> {x.attachmentName}</small>}
              </td>
              <td>
                {form.lines.length > 1 && (
                  <button
                    type="button"
                    className="link"
                    onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))}
                  >
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button
          type="button"
          className="link"
          onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }))}
        >
          + {l("Tambah baris", "Add line")}
        </button>
        <button type="button" disabled={busy} onClick={(e) => save(e as unknown as FormEvent, false)}>
          {l("Simpan draft", "Save draft")}
        </button>
        <button className="primary" disabled={busy}>
          {l("Simpan & ajukan", "Save & submit")}
        </button>
        {props.onCancel && (
          <button type="button" className="link" onClick={props.onCancel}>
            {l("Batal", "Cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
