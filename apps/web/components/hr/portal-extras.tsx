"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { formatDate, money, today } from "../../lib/format";
import { L, useI18n, type Text } from "../../lib/i18n";
import {
  APPRAISAL_STATE_LABEL,
  EXPENSE_STATE_LABEL,
  LEAVE_STATE_LABEL,
  MARITAL_OPTIONS,
  RELIGION_OPTIONS,
} from "../../lib/resources";
import { EDUCATION_LABEL, PhotoBox, RELATION_OPTIONS } from "./profile-panels";
import { REQUEST_STATE_LABEL } from "./approval-request-form";
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
  const [categories, setCategories] = useState<
    { id: string; name: string; annualLimit: string | null; used?: string; remaining?: string | null }[]
  >([]);
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
      {categories.some((c) => c.annualLimit !== null) && (
        <p className="muted claim-limits">
          {l("Sisa plafon tahun ini", "Remaining limit this year")}:{" "}
          {categories
            .filter((c) => c.annualLimit !== null)
            .map((c) => `${c.name} ${money(c.remaining ?? c.annualLimit!, locale)}`)
            .join(" · ")}
        </p>
      )}
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
        <div className="table-scroll">
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
        </div>
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
      <div className="table-scroll">
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
      </div>
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
      <div className="table-scroll">
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
      </div>
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
  domicileAddress: ["Alamat domisili", "Current address"],
  personalPhone: ["No. HP pribadi", "Personal phone"],
  personalEmail: ["Email pribadi", "Personal email"],
  maritalStatus: ["Status pernikahan", "Marital status"],
  religion: ["Agama", "Religion"],
  bloodType: ["Golongan darah", "Blood type"],
  rhesus: ["Rhesus", "Rhesus"],
} as const;

/** Pilihan untuk field perubahan data yang berupa daftar. */
const CHANGE_OPTIONS: Partial<Record<keyof typeof CHANGE_LABELS, [string, Text][]>> = {
  ptkpStatus: ["TK/0", "TK/1", "TK/2", "TK/3", "K/0", "K/1", "K/2", "K/3"].map((s) => [s, L(s, s)]),
  maritalStatus: MARITAL_OPTIONS,
  religion: RELIGION_OPTIONS,
  bloodType: ["A", "B", "AB", "O"].map((b) => [b, L(b, b)]),
  rhesus: [
    ["+", L("Positif (+)", "Positive (+)")],
    ["-", L("Negatif (−)", "Negative (−)")],
  ],
};

/** Ajukan perubahan data pribadi (disetujui HR). */
export function MyChangeRequest() {
  const { l, tx } = useI18n();
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
            CHANGE_OPTIONS[k] ? (
              <label key={k} className="field">
                <span>{label(k)}</span>
                <select
                  value={form[k] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                >
                  <option value="">{l("(tidak diubah)", "(unchanged)")}</option>
                  {CHANGE_OPTIONS[k]!.map(([v, t]) => (
                    <option key={v} value={v}>
                      {tx(t)}
                    </option>
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
        <div className="table-scroll">
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
        </div>
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
      <div className="table-scroll">
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
      </div>
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
      <div className="table-scroll">
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
      </div>
    </section>
  );
}

/** Penilaian kinerja: milik sendiri (penilaian diri) dan bawahan yang perlu dinilai. */
export function MyAppraisals() {
  const { l, tx } = useI18n();
  const [rows, setRows] = useState<
    {
      id: string;
      cycleName: string;
      employeeName: string;
      state: string;
      role: "self" | "manager";
      finalScore: string | null;
      rating: string | null;
    }[]
  >([]);
  useEffect(() => {
    api<typeof rows>("/me/appraisals").then(setRows, () => setRows([]));
  }, []);
  if (!rows.length) return null;
  const todo = (r: (typeof rows)[number]) => (r.role === "self" ? r.state === "self" : r.state === "manager");
  return (
    <section className="panel">
      <h2>{l("Penilaian kinerja", "Performance appraisals")}</h2>
      <div className="table-scroll">
        <table>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/hr/appraisal-forms/${r.id}`}>{r.cycleName}</Link>
                </td>
                <td>{r.role === "self" ? l("Diri sendiri", "Myself") : r.employeeName}</td>
                <td>
                  {todo(r) ? (
                    <strong>{l("Perlu diisi", "To do")}</strong>
                  ) : (
                    tx(APPRAISAL_STATE_LABEL[r.state]!)
                  )}
                </td>
                <td>{r.rating ? `${Number(r.finalScore).toFixed(2)} · ${r.rating}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface MyProfileData {
  hasPhoto: boolean;
  family: { id: string; relation: string; name: string; birthDate: string | null; dependent: boolean }[];
  education: {
    id: string;
    level: string;
    institution: string;
    major: string | null;
    yearEnd: number | null;
  }[];
  experiences: {
    id: string;
    company: string;
    position: string | null;
    dateStart: string | null;
    dateEnd: string | null;
  }[];
  warnings: {
    id: string;
    level: string;
    date: string;
    validUntil: string;
    reason: string;
    active: boolean;
  }[];
}

/** Profil sendiri: foto (bisa diganti), keluarga, pendidikan, pengalaman, surat peringatan (read-only). */
export function MyProfile({ name }: { name: string }) {
  const { l, tx, locale } = useI18n();
  const [p, setP] = useState<MyProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<MyProfileData>("/me/profile").then(setP, (e) => setError(errorText(e)));
  }, []);
  const relation = (r: string) => tx(RELATION_OPTIONS.find(([k]) => k === r)?.[1] ?? L(r, r));
  return (
    <section className="panel">
      <h2>{l("Profil saya", "My profile")}</h2>
      {error && <p className="error">{error}</p>}
      <div className="profile-head">
        {p && <PhotoBox path="/me/photo" name={name} editable hasPhoto={p.hasPhoto} />}
        {p && (
          <div className="stack" style={{ flex: 1, minWidth: 220 }}>
            <div>
              <strong>{l("Keluarga", "Family")}</strong>
              {p.family.length === 0 ? (
                <p className="muted">—</p>
              ) : (
                <ul>
                  {p.family.map((f) => (
                    <li key={f.id}>
                      {f.name} <small className="muted">({relation(f.relation)})</small>
                      {f.birthDate && ` · ${formatDate(f.birthDate, locale)}`}
                      {f.dependent && ` · ${l("tanggungan", "dependant")}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <strong>{l("Pendidikan", "Education")}</strong>
              {p.education.length === 0 ? (
                <p className="muted">—</p>
              ) : (
                <ul>
                  {p.education.map((e) => (
                    <li key={e.id}>
                      {EDUCATION_LABEL[e.level]} {e.institution}
                      {e.major && ` — ${e.major}`}
                      {e.yearEnd && ` (${e.yearEnd})`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {p.experiences.length > 0 && (
              <div>
                <strong>{l("Pengalaman kerja", "Work experience")}</strong>
                <ul>
                  {p.experiences.map((x) => (
                    <li key={x.id}>
                      {x.company}
                      {x.position && ` — ${x.position}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {p.warnings.some((w) => w.active) && (
              <div>
                <strong>{l("Surat peringatan aktif", "Active warning letters")}</strong>
                <ul>
                  {p.warnings
                    .filter((w) => w.active)
                    .map((w) => (
                      <li key={w.id}>
                        {w.level.toUpperCase()} · {w.reason} · {l("s.d.", "until")}{" "}
                        {formatDate(w.validUntil, locale)}
                      </li>
                    ))}
                </ul>
              </div>
            )}
            <small className="muted">
              {l(
                "Data keluarga & pendidikan dikelola HR; ajukan koreksi lewat HR.",
                "Family & education data are managed by HR; ask HR for corrections.",
              )}
            </small>
          </div>
        )}
      </div>
    </section>
  );
}

interface MyRequest {
  id: string;
  number: string | null;
  subject: string;
  categoryName: string;
  state: string;
}

/** Permintaan persetujuan milik sendiri (FPK, dinas, uang muka, dll.) dan jumlah yang perlu saya tinjau. */
export function MyApprovalRequests() {
  const { l, tx } = useI18n();
  const [rows, setRows] = useState<MyRequest[]>([]);
  const [toReview, setToReview] = useState(0);
  useEffect(() => {
    api<MyRequest[]>("/approval-requests?mine=1").then(
      (r) => setRows(r.slice(0, 5)),
      () => setRows([]),
    );
    api<{ toReview: number }>("/approval-requests/summary").then(
      (s) => setToReview(s.toReview),
      () => setToReview(0),
    );
  }, []);
  return (
    <section className="panel">
      <header className="toolbar">
        <h2>{l("Permintaan persetujuan", "Approval requests")}</h2>
        <Link className="button primary" href="/hr/approval-requests">
          {l("Buat / lihat semua", "New / view all")}
        </Link>
        {toReview > 0 && (
          <Link href="/hr/approvals">
            {l(`${toReview} perlu Anda tinjau`, `${toReview} waiting for you`)}
          </Link>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="muted">{l("Belum ada permintaan.", "No requests yet.")}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/hr/approval-requests/${r.id}`}>{r.number ?? l("(draft)", "(draft)")}</Link>
                  </td>
                  <td>{r.categoryName}</td>
                  <td>{r.subject}</td>
                  <td>{tx(REQUEST_STATE_LABEL[r.state]!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
