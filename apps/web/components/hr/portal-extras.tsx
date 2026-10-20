"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { formatDate, money, today } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { EXPENSE_STATE_LABEL, LEAVE_STATE_LABEL } from "../../lib/resources";
import { ExpenseClaimForm } from "./expense-form";

const errorText = (e: unknown) =>
  e instanceof ApiError
    ? (Object.values(e.fieldErrors)[0] ?? e.message)
    : e instanceof Error
      ? e.message
      : String(e);

interface Claim {
  id: string;
  name: string;
  date: string;
  description: string | null;
  state: string;
  total: string;
  payMethod: string;
}

/** Klaim biaya milik sendiri: ajukan baru, lihat status, batalkan. */
export function MyClaims() {
  const { l, tx, locale } = useI18n();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string; annualLimit: string | null }[]>(
    [],
  );
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Claim[]>("/expense-claims?mine=1").then(setClaims, (e) => setError(errorText(e)));
    api<typeof categories>("/me/expense-categories").then(setCategories, () => setCategories([]));
  }, [version]);

  return (
    <section className="panel">
      <header className="toolbar">
        <h2>{l("Klaim biaya", "Expense claims")}</h2>
        {!open && categories.length > 0 && (
          <button type="button" className="primary" onClick={() => setOpen(true)}>
            {l("Ajukan klaim", "New claim")}
          </button>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {open && (
        <ExpenseClaimForm
          categories={categories}
          onSaved={() => {
            setOpen(false);
            setVersion((v) => v + 1);
          }}
          onCancel={() => setOpen(false)}
        />
      )}
      {claims.length === 0 ? (
        <p className="muted">{l("Belum ada klaim.", "No claims yet.")}</p>
      ) : (
        <table>
          <tbody>
            {claims.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{formatDate(c.date, locale)}</td>
                <td>{c.description}</td>
                <td className="num">{money(c.total, locale)}</td>
                <td>{tx(EXPENSE_STATE_LABEL[c.state]!)}</td>
                <td>
                  {c.state === "draft" && (
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        api(`/expense-claims/${c.id}/submit`, { method: "POST" }).then(
                          () => setVersion((v) => v + 1),
                          (e) => setError(errorText(e)),
                        )
                      }
                    >
                      {l("Ajukan", "Submit")}
                    </button>
                  )}
                  {["draft", "confirm", "approved"].includes(c.state) && (
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        api(`/expense-claims/${c.id}/cancel`, { method: "POST" }).then(
                          () => setVersion((v) => v + 1),
                          (e) => setError(errorText(e)),
                        )
                      }
                    >
                      {l("Batalkan", "Cancel")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Pengajuan lembur sendiri (menunggu persetujuan atasan). */
export function MyOvertime() {
  const { l, tx, locale } = useI18n();
  const [rows, setRows] = useState<
    { id: string; date: string; hours: string; description: string | null; state: string }[]
  >([]);
  const [form, setForm] = useState({ date: today(), hours: "1", dayType: "workday", description: "" });
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<typeof rows>("/me/overtimes").then(setRows, (e) => setError(errorText(e)));
  }, [version]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    api("/me/overtimes", { method: "POST", body: { ...form, description: form.description || null } }).then(
      () => setVersion((v) => v + 1),
      (err) => setError(errorText(err)),
    );
  };
  return (
    <section className="panel">
      <h2>{l("Lembur", "Overtime")}</h2>
      <form className="inline-panel" onSubmit={submit}>
        <label className="field">
          <span>{l("Tanggal", "Date")}</span>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Jam", "Hours")}</span>
          <input
            className="num"
            inputMode="decimal"
            value={form.hours}
            onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Hari", "Day")}</span>
          <select value={form.dayType} onChange={(e) => setForm((f) => ({ ...f, dayType: e.target.value }))}>
            <option value="workday">{l("Hari kerja", "Workday")}</option>
            <option value="rest_day">{l("Hari istirahat/libur", "Rest day/holiday")}</option>
          </select>
        </label>
        <label className="field">
          <span>{l("Pekerjaan", "Work done")}</span>
          <input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </label>
        <button className="primary">{l("Ajukan lembur", "Request overtime")}</button>
      </form>
      {error && <p className="error">{error}</p>}
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{formatDate(r.date, locale)}</td>
              <td className="num">
                {Number(r.hours)} {l("jam", "h")}
              </td>
              <td>{r.description}</td>
              <td>{tx(LEAVE_STATE_LABEL[r.state]!)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Pinjaman sendiri: pokok, sisa, cicilan. */
export function MyLoans() {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<
    { id: string; name: string; principal: string; installment: string; remaining: string; state: string }[]
  >([]);
  useEffect(() => {
    api<typeof rows>("/me/loans").then(setRows, () => setRows([]));
  }, []);
  if (!rows.length) return null;
  return (
    <section className="panel">
      <h2>{l("Pinjaman", "Loans")}</h2>
      <table>
        <thead>
          <tr>
            <th>{l("Pinjaman", "Loan")}</th>
            <th className="num">{l("Pokok", "Principal")}</th>
            <th className="num">{l("Cicilan/bulan", "Installment")}</th>
            <th className="num">{l("Sisa", "Remaining")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td className="num">{money(r.principal, locale)}</td>
              <td className="num">{money(r.installment, locale)}</td>
              <td className="num">
                <strong>{money(r.remaining, locale)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const CHANGE_LABELS = {
  address: ["Alamat", "Address"],
  workPhone: ["Telepon", "Phone"],
  emergencyContact: ["Kontak darurat", "Emergency contact"],
  emergencyPhone: ["Telepon kontak darurat", "Emergency phone"],
  bankName: ["Bank", "Bank"],
  bankAccount: ["No rekening", "Account number"],
  bankAccountName: ["Atas nama rekening", "Account holder"],
  ptkpStatus: ["Status PTKP", "PTKP status"],
} as const;

/** Ajukan perubahan data pribadi (disetujui HR). */
export function MyChangeRequest() {
  const { l } = useI18n();
  const [rows, setRows] = useState<
    {
      id: string;
      state: string;
      changes: Record<string, string | null>;
      createdAt: string;
      decisionNote: string | null;
    }[]
  >([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    api<typeof rows>("/me/change-requests").then(setRows, (e) => setError(errorText(e)));
  }, [version]);
  const pending = rows.some((r) => r.state === "confirm");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ""));
    api("/me/change-requests", { method: "POST", body }).then(
      () => {
        setForm({});
        setNotice(l("Pengajuan dikirim ke HR.", "Request sent to HR."));
        setVersion((v) => v + 1);
      },
      (err) => setError(errorText(err)),
    );
  };
  const label = (k: string) => {
    const t = CHANGE_LABELS[k as keyof typeof CHANGE_LABELS];
    return t ? l(t[0], t[1]) : k;
  };
  return (
    <section className="panel">
      <h2>{l("Perubahan data pribadi", "Personal data changes")}</h2>
      {pending ? (
        <p className="muted">
          {l("Pengajuan Anda sedang ditinjau HR.", "Your request is being reviewed by HR.")}
        </p>
      ) : (
        <form className="inline-panel" onSubmit={submit}>
          {(Object.keys(CHANGE_LABELS) as (keyof typeof CHANGE_LABELS)[]).map((k) =>
            k === "ptkpStatus" ? (
              <label key={k} className="field">
                <span>{label(k)}</span>
                <select
                  value={form[k] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                >
                  <option value="">{l("(tidak diubah)", "(unchanged)")}</option>
                  {["TK/0", "TK/1", "TK/2", "TK/3", "K/0", "K/1", "K/2", "K/3"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label key={k} className="field">
                <span>{label(k)}</span>
                <input
                  value={form[k] ?? ""}
                  placeholder={l("(tidak diubah)", "(unchanged)")}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                />
              </label>
            ),
          )}
          <button className="primary">{l("Ajukan perubahan", "Request change")}</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      {rows.length > 0 && (
        <table>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                <td>
                  {Object.entries(r.changes)
                    .map(([k, v]) => `${label(k)}: ${v ?? "—"}`)
                    .join(" · ")}
                </td>
                <td>
                  {r.state === "confirm"
                    ? l("Menunggu HR", "Awaiting HR")
                    : r.state === "approved"
                      ? l("Disetujui", "Approved")
                      : l("Ditolak", "Refused")}
                  {r.decisionNote ? ` — ${r.decisionNote}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Bukti potong PPh 21 tahunan (A1). */
export function MyTaxSlips() {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<
    {
      id: string;
      periodYear: number;
      bupotNumber: string | null;
      taxBase: string;
      taxAmount: string;
      state: string;
    }[]
  >([]);
  useEffect(() => {
    api<typeof rows>("/me/withholding-slips").then(setRows, () => setRows([]));
  }, []);
  if (!rows.length) return null;
  return (
    <section className="panel">
      <h2>{l("Bukti potong PPh 21 (A1)", "PPh 21 withholding slips (A1)")}</h2>
      <table>
        <thead>
          <tr>
            <th>{l("Tahun", "Year")}</th>
            <th>{l("Nomor", "Number")}</th>
            <th className="num">{l("Penghasilan bruto", "Gross income")}</th>
            <th className="num">PPh 21</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.periodYear}</td>
              <td>{r.bupotNumber ?? l("(belum bernomor)", "(not numbered yet)")}</td>
              <td className="num">{money(r.taxBase, locale)}</td>
              <td className="num">{money(r.taxAmount, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Tugas checklist onboarding/offboarding milik sendiri. */
export function MyChecklistTasks() {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<
    {
      id: string;
      name: string;
      dueDate: string;
      doneAt: string | null;
      checklistName: string;
      employeeName: string;
    }[]
  >([]);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<typeof rows>("/me/checklist-tasks").then(setRows, () => setRows([]));
  }, [version]);
  if (!rows.length) return null;
  return (
    <section className="panel">
      <h2>{l("Tugas onboarding/offboarding", "Onboarding/offboarding tasks")}</h2>
      {error && <p className="error">{error}</p>}
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <input
                  type="checkbox"
                  aria-label={r.name}
                  checked={Boolean(r.doneAt)}
                  onChange={(e) =>
                    api(`/hr-checklists/tasks/${r.id}`, {
                      method: "POST",
                      body: { done: e.target.checked },
                    }).then(
                      () => setVersion((v) => v + 1),
                      (err) => setError(errorText(err)),
                    )
                  }
                />
              </td>
              <td>{r.name}</td>
              <td className="muted">
                {r.checklistName} · {r.employeeName}
              </td>
              <td>{formatDate(r.dueDate, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
