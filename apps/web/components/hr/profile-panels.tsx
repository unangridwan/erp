"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApprovalStatus, approvalCleared, type ApprovalInfo } from "../approval-status";
import { api } from "../../lib/api";
import { formatDate, money } from "../../lib/format";
import { useI18n, type Text, L } from "../../lib/i18n";
import { can } from "../../lib/resources";
import { download } from "../accounting/download";
import { AuthImage, bumpImage } from "../auth-image";
import { useMe } from "../me-context";
import { RefSelect } from "../ref-select";
import { errorText } from "./hr-panels";
import { ask } from "../feedback";

const readFile = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** Perkecil foto di browser (sisi terpanjang 600 px, JPEG) agar jauh di bawah batas 1 MB. */
export async function resizePhoto(file: File): Promise<{ type: string; data: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas"))), "image/jpeg", 0.85),
  );
  return { type: "image/jpeg", data: await readFile(blob) };
}

/** Foto 3×4 dengan tombol ganti/hapus; `path` = endpoint foto (karyawan atau /me/photo). */
export function PhotoBox({
  path,
  name,
  editable,
  onChange,
  hasPhoto = true,
}: {
  path: string;
  name: string;
  editable: boolean;
  onChange?: () => void;
  /** Belum ada foto: tampilkan placeholder tanpa meminta gambar (hindari 404). */
  hasPhoto?: boolean;
}) {
  const { l } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const placeholder = (
    <div className="profile-photo">
      {name ? name.slice(0, 1).toUpperCase() : <small>{l("Belum ada foto", "No photo")}</small>}
    </div>
  );
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) return setError(l("Pilih berkas gambar", "Choose an image file"));
    try {
      await api(path, { method: "PUT", body: await resizePhoto(file) });
      bumpImage(path);
      setUploaded(true);
      onChange?.();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <div className="stack">
      {hasPhoto || uploaded ? (
        <AuthImage path={path} alt={name} className="profile-photo" fallback={placeholder} />
      ) : (
        placeholder
      )}
      {editable && (
        <label className="link" style={{ cursor: "pointer" }}>
          {l("Ganti foto", "Change photo")}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            aria-label={l("Unggah foto", "Upload photo")}
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </label>
      )}
      {error && <small className="error">{error}</small>}
    </div>
  );
}

const PROFILE_ITEM_LABEL: Record<string, Text> = {
  photo: L("Foto", "Photo"),
  nik: L("NIK", "NIK"),
  kkNo: L("No. KK", "Family card no."),
  npwp: L("NPWP", "NPWP"),
  birthPlace: L("Tempat lahir", "Place of birth"),
  birthDate: L("Tanggal lahir", "Birth date"),
  gender: L("Jenis kelamin", "Gender"),
  religion: L("Agama", "Religion"),
  maritalStatus: L("Status pernikahan", "Marital status"),
  bloodType: L("Golongan darah", "Blood type"),
  address: L("Alamat KTP", "ID address"),
  personalPhone: L("No. HP pribadi", "Personal phone"),
  emergencyContact: L("Kontak darurat", "Emergency contact"),
  bankAccount: L("No. rekening", "Bank account"),
  bpjsKesNo: L("No. BPJS Kesehatan", "BPJS Health no."),
  bpjsTkNo: L("No. BPJS Ketenagakerjaan", "BPJS Employment no."),
  family: L("Data keluarga", "Family"),
  education: L("Riwayat pendidikan", "Education"),
  "doc:ktp": L("Scan KTP", "ID card scan"),
  "doc:kk": L("Scan KK", "Family card scan"),
};

export const EDUCATION_LABEL: Record<string, string> = {
  sd: "SD",
  smp: "SMP",
  sma: "SMA/SMK",
  d1: "D1",
  d2: "D2",
  d3: "D3",
  d4: "D4",
  s1: "S1",
  s2: "S2",
  s3: "S3",
  other: "—",
};

interface Summary {
  completeness: { percent: number; missing: string[] };
  hasPhoto: boolean;
  suggestedPtkp: string;
  ptkpMismatch: boolean;
  highestEducation: { level: string; institution: string; major: string | null } | null;
  activeWarnings: { id: string; level: string; validUntil: string }[];
}

/** Kepala profil: foto, kelengkapan data, saran PTKP dari data keluarga, pendidikan tertinggi, SP aktif. */
export function ProfileHeader({ employeeId }: { employeeId: string }) {
  const { l, tx, locale } = useI18n();
  const me = useMe();
  const [s, setS] = useState<Summary | null>(null);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Summary>(`/employees/${employeeId}/profile-summary`).then(setS, (e) => setError(errorText(e)));
  }, [employeeId, tick]);
  return (
    <section className="panel">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="profile-head">
        <PhotoBox
          key={String(s?.hasPhoto)}
          path={`/employees/${employeeId}/photo`}
          name=""
          hasPhoto={s?.hasPhoto ?? false}
          editable={can(me.permissions, "hr.manage")}
          onChange={() => setTick((t) => t + 1)}
        />
        {s && (
          <div className="stack" style={{ flex: 1, minWidth: 220 }}>
            <div>
              <strong>{l("Kelengkapan profil", "Profile completeness")}</strong> {s.completeness.percent}%
              <div
                className="meter"
                role="meter"
                aria-valuenow={s.completeness.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={l("Kelengkapan profil", "Profile completeness")}
              >
                <span style={{ width: `${s.completeness.percent}%` }} />
              </div>
              {s.completeness.missing.length > 0 && (
                <small className="muted">
                  {l("Belum diisi", "Missing")}:{" "}
                  {s.completeness.missing.map((m) => tx(PROFILE_ITEM_LABEL[m] ?? L(m, m))).join(", ")}
                </small>
              )}
            </div>
            <div>
              {l("Saran PTKP dari data keluarga", "PTKP suggested by family data")}:{" "}
              <strong>{s.suggestedPtkp}</strong>
              {s.ptkpMismatch && (
                <small className="error">
                  {" "}
                  · {l("berbeda dengan status saat ini", "differs from current status")}
                </small>
              )}
            </div>
            {s.highestEducation && (
              <div>
                {l("Pendidikan terakhir", "Highest education")}:{" "}
                <strong>{EDUCATION_LABEL[s.highestEducation.level]}</strong> {s.highestEducation.institution}
                {s.highestEducation.major && ` — ${s.highestEducation.major}`}
              </div>
            )}
            {s.activeWarnings.map((w) => (
              <div key={w.id}>
                <span className="badge state-cancel">{w.level.toUpperCase()}</span>{" "}
                {l("berlaku s.d.", "valid until")} {formatDate(w.validUntil, locale)}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ---- Tabel baris (keluarga, pendidikan, pengalaman) ----

interface Col {
  name: string;
  label: Text;
  type: "text" | "date" | "number" | "select" | "boolean";
  options?: [string, Text][];
  required?: boolean;
  /** Tampilkan di tabel (bawaan ya). */
  list?: boolean;
}

type Row = Record<string, unknown> & { id: string };

/** Daftar baris sederhana dengan tambah/ubah/hapus inline (sub-data karyawan). */
function RowsPanel({
  title,
  endpoint,
  cols,
  editable,
  defaults,
  render,
}: {
  title: Text;
  endpoint: string;
  cols: Col[];
  editable: boolean;
  defaults: Record<string, unknown>;
  render?: Record<string, (row: Row) => React.ReactNode>;
}) {
  const { l, tx, locale } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () => api<Row[]>(endpoint).then(setRows, (e) => setError(errorText(e))),
    [endpoint],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const cell = (c: Col, row: Row) => {
    if (render?.[c.name]) return render[c.name]!(row);
    const v = row[c.name];
    if (v === null || v === undefined || v === "") return "—";
    if (c.type === "boolean") return v ? "✓" : "—";
    if (c.type === "date") return formatDate(String(v), locale);
    if (c.type === "select") return tx(c.options?.find(([k]) => k === v)?.[1] ?? L(String(v), String(v)));
    return String(v);
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setError(null);
    const { id, ...values } = edit;
    const body = Object.fromEntries(
      cols.map((c) => {
        const v = values[c.name];
        if (c.type === "boolean") return [c.name, Boolean(v)];
        if (v === "" || v === undefined || v === null) return [c.name, null];
        return [c.name, c.type === "number" ? Number(v) : v];
      }),
    );
    try {
      await api(id ? `${endpoint}/${id}` : endpoint, { method: id ? "PUT" : "POST", body });
      setEdit(null);
      void load();
    } catch (err) {
      setError(errorText(err));
    }
  }
  const shown = cols.filter((c) => c.list !== false);
  return (
    <section className="panel">
      <header className="toolbar">
        <h2>{tx(title)}</h2>
        {editable && !edit && (
          <button type="button" className="link" onClick={() => setEdit({ ...defaults })}>
            + {l("Tambah", "Add")}
          </button>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {edit && (
        <form className="inline-panel" onSubmit={save}>
          {cols.map((c) => {
            const v = edit[c.name];
            const set = (value: unknown) => setEdit((x) => ({ ...x, [c.name]: value }));
            return (
              <label key={c.name} className={c.type === "boolean" ? "field check" : "field"}>
                <span>
                  {tx(c.label)}
                  {c.required ? " *" : ""}
                </span>
                {c.type === "boolean" ? (
                  <input type="checkbox" checked={Boolean(v)} onChange={(e) => set(e.target.checked)} />
                ) : c.type === "select" ? (
                  <select required={c.required} value={String(v ?? "")} onChange={(e) => set(e.target.value)}>
                    {!c.required && <option value="">—</option>}
                    {c.options!.map(([k, label]) => (
                      <option key={k} value={k}>
                        {tx(label)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={c.type}
                    step={c.type === "number" ? "any" : undefined}
                    required={c.required}
                    value={String(v ?? "")}
                    onChange={(e) => set(e.target.value)}
                  />
                )}
              </label>
            );
          })}
          <div className="form-actions">
            <button className="primary">{l("Simpan", "Save")}</button>
            <button type="button" className="link" onClick={() => setEdit(null)}>
              {l("Batal", "Cancel")}
            </button>
          </div>
        </form>
      )}
      {rows.length === 0 ? (
        !edit && <p className="muted">{l("Belum ada data.", "No data yet.")}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {shown.map((c) => (
                  <th key={c.name}>{tx(c.label)}</th>
                ))}
                {editable && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {shown.map((c) => (
                    <td key={c.name}>{cell(c, row)}</td>
                  ))}
                  {editable && (
                    <td>
                      <button type="button" className="link" onClick={() => setEdit({ ...row })}>
                        {l("Ubah", "Edit")}
                      </button>{" "}
                      <button
                        type="button"
                        className="link"
                        onClick={async () =>
                          (await ask(l("Hapus data ini?", "Delete this entry?"))) &&
                          api(`${endpoint}/${row.id}`, { method: "DELETE" }).then(load, (e) =>
                            setError(errorText(e)),
                          )
                        }
                      >
                        {l("Hapus", "Delete")}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export const RELATION_OPTIONS: [string, Text][] = [
  ["spouse", L("Suami/istri", "Spouse")],
  ["child", L("Anak", "Child")],
  ["father", L("Ayah", "Father")],
  ["mother", L("Ibu", "Mother")],
  ["sibling", L("Saudara kandung", "Sibling")],
  ["other", L("Lainnya", "Other")],
];

const GENDER_OPTIONS: [string, Text][] = [
  ["male", L("Laki-laki", "Male")],
  ["female", L("Perempuan", "Female")],
];

export function FamilyPanel({ employeeId, editable }: { employeeId: string; editable: boolean }) {
  return (
    <RowsPanel
      title={L("Data keluarga", "Family")}
      endpoint={`/employees/${employeeId}/family`}
      editable={editable}
      defaults={{ relation: "child", alive: true }}
      cols={[
        {
          name: "relation",
          label: L("Hubungan", "Relation"),
          type: "select",
          options: RELATION_OPTIONS,
          required: true,
        },
        { name: "name", label: L("Nama", "Name"), type: "text", required: true },
        { name: "nik", label: L("NIK", "NIK"), type: "text" },
        {
          name: "gender",
          label: L("Jenis kelamin", "Gender"),
          type: "select",
          options: GENDER_OPTIONS,
          list: false,
        },
        { name: "birthPlace", label: L("Tempat lahir", "Place of birth"), type: "text", list: false },
        { name: "birthDate", label: L("Tanggal lahir", "Birth date"), type: "date" },
        { name: "education", label: L("Pendidikan", "Education"), type: "text", list: false },
        { name: "occupation", label: L("Pekerjaan", "Occupation"), type: "text" },
        { name: "phone", label: L("Telepon", "Phone"), type: "text", list: false },
        { name: "dependent", label: L("Tanggungan PTKP", "PTKP dependant"), type: "boolean" },
        {
          name: "bpjsCovered",
          label: L("Ditanggung BPJS Kesehatan", "Covered by BPJS Health"),
          type: "boolean",
        },
        { name: "alive", label: L("Masih hidup", "Living"), type: "boolean", list: false },
      ]}
    />
  );
}

const LEVEL_OPTIONS: [string, Text][] = Object.entries(EDUCATION_LABEL)
  .filter(([k]) => k !== "other")
  .map(([k, v]) => [k, L(v, v)] as [string, Text])
  .concat([["other", L("Lainnya (kursus, dll.)", "Other (courses, etc.)")]]);

export function EducationPanel({ employeeId, editable }: { employeeId: string; editable: boolean }) {
  const { l } = useI18n();
  return (
    <RowsPanel
      title={L("Riwayat pendidikan", "Education")}
      endpoint={`/employees/${employeeId}/education`}
      editable={editable}
      defaults={{ level: "s1" }}
      cols={[
        {
          name: "level",
          label: L("Jenjang", "Level"),
          type: "select",
          options: LEVEL_OPTIONS,
          required: true,
        },
        { name: "institution", label: L("Institusi", "Institution"), type: "text", required: true },
        { name: "major", label: L("Jurusan", "Major"), type: "text" },
        { name: "yearStart", label: L("Tahun masuk", "Start year"), type: "number" },
        { name: "yearEnd", label: L("Tahun lulus", "Graduation year"), type: "number" },
        { name: "gpa", label: L("IPK/nilai", "GPA/score"), type: "number" },
      ]}
      render={{
        institution: (row) => (
          <>
            {String(row.institution)}
            {row.documentName ? (
              <small className="muted">
                {" "}
                · {l("ijazah", "diploma")}: {String(row.documentName)}
              </small>
            ) : null}
          </>
        ),
      }}
    />
  );
}

export function ExperiencePanel({ employeeId, editable }: { employeeId: string; editable: boolean }) {
  return (
    <RowsPanel
      title={L("Pengalaman kerja sebelumnya", "Previous work experience")}
      endpoint={`/employees/${employeeId}/experiences`}
      editable={editable}
      defaults={{}}
      cols={[
        { name: "company", label: L("Perusahaan", "Company"), type: "text", required: true },
        { name: "position", label: L("Jabatan", "Position"), type: "text" },
        { name: "dateStart", label: L("Mulai", "Start"), type: "date" },
        { name: "dateEnd", label: L("Selesai", "End"), type: "date" },
        { name: "reasonLeaving", label: L("Alasan keluar", "Reason for leaving"), type: "text" },
      ]}
    />
  );
}

// ---- Surat peringatan ----

interface Warning {
  id: string;
  employeeId: string;
  employeeName: string;
  level: string;
  decreeNo: string | null;
  date: string;
  validUntil: string;
  reason: string;
  documentId: string | null;
  documentName: string | null;
  active: boolean;
}

/** Surat peringatan (SP1–SP3, berlaku 6 bulan) — per karyawan atau semua karyawan. */
export function WarningsPanel({ employeeId }: { employeeId?: string }) {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Warning[]>([]);
  const empty = {
    employeeId: employeeId ?? "",
    level: "sp1",
    decreeNo: "",
    date: "",
    validUntil: "",
    reason: "",
  };
  const [form, setForm] = useState<typeof empty | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api<Warning[]>(`/employee-warnings${employeeId ? `?employeeId=${employeeId}` : ""}`).then(
        setRows,
        (e) => setError(errorText(e)),
      ),
    [employeeId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    try {
      let documentId: string | null = null;
      if (file) {
        if (file.size > 5 * 1024 * 1024)
          return setError(l("Berkas maksimal 5 MB", "Files may be at most 5 MB"));
        documentId = (
          await api<{ id: string }>("/hr-documents", {
            method: "POST",
            body: {
              employeeId: form.employeeId,
              kind: "warning",
              name: `${form.level.toUpperCase()} ${form.decreeNo}`.trim(),
              file: { name: file.name, type: file.type, data: await readFile(file) },
            },
          })
        ).id;
      }
      await api("/employee-warnings", {
        method: "POST",
        body: {
          ...form,
          decreeNo: form.decreeNo || null,
          validUntil: form.validUntil || null,
          documentId,
        },
      });
      setForm(null);
      setFile(null);
      void load();
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <section className="panel">
      <header className="toolbar">
        <h2>{l("Surat peringatan", "Warning letters")}</h2>
        {!form && (
          <button type="button" className="link" onClick={() => setForm(empty)}>
            + {l("Terbitkan SP", "Issue warning")}
          </button>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {form && (
        <form className="inline-panel" onSubmit={save}>
          {!employeeId && (
            <label className="field">
              <span>{l("Karyawan *", "Employee *")}</span>
              <RefSelect
                name="employeeId"
                resource="employees"
                display="name"
                required
                value={form.employeeId}
                onChange={(v) => setForm({ ...form, employeeId: v })}
              />
            </label>
          )}
          <label className="field">
            <span>{l("Tingkat", "Level")}</span>
            <select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
              <option value="sp1">SP1</option>
              <option value="sp2">SP2</option>
              <option value="sp3">SP3</option>
            </select>
          </label>
          <label className="field">
            <span>{l("No. surat", "Letter no.")}</span>
            <input value={form.decreeNo} onChange={(e) => setForm({ ...form, decreeNo: e.target.value })} />
          </label>
          <label className="field">
            <span>{l("Tanggal *", "Date *")}</span>
            <input
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Berlaku s.d. (kosong = 6 bulan)", "Valid until (empty = 6 months)")}</span>
            <input
              type="date"
              value={form.validUntil}
              onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Alasan/pelanggaran *", "Reason/violation *")}</span>
            <input
              required
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Scan surat (opsional)", "Letter scan (optional)")}</span>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="form-actions">
            <button className="primary" disabled={!form.employeeId}>
              {l("Simpan", "Save")}
            </button>
            <button type="button" className="link" onClick={() => setForm(null)}>
              {l("Batal", "Cancel")}
            </button>
          </div>
        </form>
      )}
      {rows.length === 0 ? (
        <p className="muted">{l("Belum ada surat peringatan.", "No warning letters.")}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {!employeeId && <th>{l("Karyawan", "Employee")}</th>}
                <th>{l("Tingkat", "Level")}</th>
                <th>{l("Tanggal", "Date")}</th>
                <th>{l("Berlaku s.d.", "Valid until")}</th>
                <th>{l("Alasan", "Reason")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  {!employeeId && <td>{w.employeeName}</td>}
                  <td>
                    <span className={`badge ${w.active ? "state-cancel" : "state-draft"}`}>
                      {w.level.toUpperCase()}
                    </span>{" "}
                    {w.decreeNo && <small className="muted">{w.decreeNo}</small>}
                  </td>
                  <td>{formatDate(w.date, locale)}</td>
                  <td>
                    {formatDate(w.validUntil, locale)}
                    {!w.active && <small className="muted"> · {l("tidak berlaku", "expired")}</small>}
                  </td>
                  <td>
                    {w.reason}
                    {w.documentId && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="link"
                          onClick={() =>
                            download(`/hr-documents/${w.documentId}/file`, w.documentName ?? "sp.pdf").catch(
                              (e) => setError(errorText(e)),
                            )
                          }
                        >
                          {l("surat", "letter")}
                        </button>
                      </>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={async () =>
                        (await ask(l("Hapus surat peringatan ini?", "Delete this warning letter?"))) &&
                        api(`/employee-warnings/${w.id}`, { method: "DELETE" }).then(load, (e) =>
                          setError(errorText(e)),
                        )
                      }
                    >
                      {l("Hapus", "Delete")}
                    </button>
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

// ---- Promosi, demosi, mutasi ----

export const MOVEMENT_KIND_LABEL: Record<string, Text> = {
  promotion: L("Promosi", "Promotion"),
  demotion: L("Demosi", "Demotion"),
  transfer: L("Mutasi", "Transfer"),
  rotation: L("Rotasi", "Rotation"),
  wage_adjustment: L("Penyesuaian upah", "Wage adjustment"),
};

/** Penyesuaian upah hanya mengubah upah; isian jabatan/organisasi disembunyikan & dikosongkan. */
const STRUCTURE_KEYS = ["toJobId", "toDepartmentId", "toBranchId", "toManagerId", "toGradeId"] as const;

interface Movement {
  approval?: ApprovalInfo;
  id: string;
  employeeId: string;
  employeeName: string;
  kind: string;
  decreeNo: string | null;
  effectiveDate: string;
  oldWage: string | null;
  newWage: string | null;
  reason: string | null;
  state: "draft" | "done" | "cancel";
  names: Record<string, string | null>;
}

const MOVE_PAIRS = [
  ["fromJobId", "toJobId", L("Jabatan", "Job")],
  ["fromDepartmentId", "toDepartmentId", L("Departemen", "Department")],
  ["fromBranchId", "toBranchId", L("Cabang", "Branch")],
  ["fromManagerId", "toManagerId", L("Atasan", "Manager")],
  ["fromGradeId", "toGradeId", L("Golongan", "Grade")],
] as const;

/** Promosi/demosi/mutasi/rotasi berdasarkan SK: draft → terapkan (data karyawan + kontrak upah baru). */
export function MovementsPanel({ employeeId }: { employeeId?: string }) {
  const { l, tx, locale } = useI18n();
  const me = useMe();
  const manage = can(me.permissions, "hr.manage");
  const [rows, setRows] = useState<Movement[]>([]);
  const empty = {
    employeeId: employeeId ?? "",
    kind: "promotion",
    decreeNo: "",
    effectiveDate: "",
    toJobId: "",
    toDepartmentId: "",
    toBranchId: "",
    toManagerId: "",
    toGradeId: "",
    newWage: "",
    reason: "",
  };
  const [form, setForm] = useState<typeof empty | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api<Movement[]>(`/employee-movements${employeeId ? `?employeeId=${employeeId}` : ""}`).then(
        setRows,
        (e) => setError(errorText(e)),
      ),
    [employeeId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (id: string, action: "apply" | "cancel") => {
    setError(null);
    const question =
      action === "apply"
        ? l(
            "Terapkan SK ini? Data karyawan diperbarui dan (bila ada upah baru) kontrak baru dimulai.",
            "Apply this decree? Employee data is updated and (with a new wage) a new contract starts.",
          )
        : l("Batalkan mutasi ini?", "Cancel this movement?");
    if (!(await ask(question))) return;
    api(`/employee-movements/${id}/${action}`, { method: "POST" }).then(load, (e) => setError(errorText(e)));
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    try {
      let documentId: string | null = null;
      if (file) {
        if (file.size > 5 * 1024 * 1024)
          return setError(l("Berkas maksimal 5 MB", "Files may be at most 5 MB"));
        documentId = (
          await api<{ id: string }>("/hr-documents", {
            method: "POST",
            body: {
              employeeId: form.employeeId,
              kind: "decree",
              name: `SK ${tx(MOVEMENT_KIND_LABEL[form.kind]!)} ${form.decreeNo}`.trim(),
              file: { name: file.name, type: file.type, data: await readFile(file) },
            },
          })
        ).id;
      }
      const wageOnly = form.kind === "wage_adjustment";
      const body = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [
          k,
          v === "" || (wageOnly && (STRUCTURE_KEYS as readonly string[]).includes(k)) ? null : v,
        ]),
      );
      await api("/employee-movements", { method: "POST", body: { ...body, documentId } });
      setForm(null);
      setFile(null);
      void load();
    } catch (err) {
      setError(errorText(err));
    }
  }
  const ref = (name: keyof typeof empty, label: Text, resource: string) =>
    form && (
      <label className="field">
        <span>{tx(label)}</span>
        <RefSelect
          name={name}
          resource={resource}
          display="name"
          value={form[name]}
          onChange={(v) => setForm({ ...form, [name]: v })}
        />
      </label>
    );
  const STATE: Record<string, Text> = {
    draft: L("Draft", "Draft"),
    done: L("Diterapkan", "Applied"),
    cancel: L("Batal", "Cancelled"),
  };
  return (
    <section className="panel">
      <header className="toolbar">
        <h2>{l("Promosi, demosi & mutasi", "Promotions, demotions & transfers")}</h2>
        {manage && !form && (
          <button type="button" className="link" onClick={() => setForm(empty)}>
            + {l("Buat SK", "New decree")}
          </button>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {form && (
        <form className="inline-panel" onSubmit={save}>
          {!employeeId && ref("employeeId", L("Karyawan *", "Employee *"), "employees")}
          <label className="field">
            <span>{l("Jenis", "Kind")}</span>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(MOVEMENT_KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {tx(v)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("No. SK", "Decree no.")}</span>
            <input value={form.decreeNo} onChange={(e) => setForm({ ...form, decreeNo: e.target.value })} />
          </label>
          <label className="field">
            <span>{l("Tanggal efektif *", "Effective date *")}</span>
            <input
              type="date"
              required
              value={form.effectiveDate}
              onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
            />
          </label>
          {form.kind !== "wage_adjustment" && (
            <>
              {ref("toJobId", L("Jabatan baru", "New job"), "job-positions")}
              {ref("toDepartmentId", L("Departemen baru", "New department"), "departments")}
              {ref("toBranchId", L("Cabang baru", "New branch"), "branches")}
              {ref("toManagerId", L("Atasan baru", "New manager"), "employees")}
              {ref("toGradeId", L("Golongan baru", "New grade"), "salary-grades")}
            </>
          )}
          <label className="field">
            <span>
              {form.kind === "wage_adjustment"
                ? l("Upah pokok baru *", "New base wage *")
                : l("Upah pokok baru (kosong = tetap)", "New base wage (empty = unchanged)")}
            </span>
            <input
              className="num"
              inputMode="decimal"
              required={form.kind === "wage_adjustment"}
              value={form.newWage}
              onChange={(e) => setForm({ ...form, newWage: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Alasan", "Reason")}</span>
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </label>
          <label className="field">
            <span>{l("Scan SK (opsional)", "Decree scan (optional)")}</span>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="form-actions">
            <button className="primary" disabled={!form.employeeId}>
              {l("Simpan draft", "Save draft")}
            </button>
            <button type="button" className="link" onClick={() => setForm(null)}>
              {l("Batal", "Cancel")}
            </button>
          </div>
        </form>
      )}
      {rows.length === 0 ? (
        <p className="muted">{l("Belum ada SK mutasi.", "No movements yet.")}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {!employeeId && <th>{l("Karyawan", "Employee")}</th>}
                <th>{l("Jenis", "Kind")}</th>
                <th>{l("Efektif", "Effective")}</th>
                <th>{l("Perubahan", "Changes")}</th>
                <th>{l("Status", "Status")}</th>
                {manage && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  {!employeeId && <td>{m.employeeName}</td>}
                  <td>
                    {tx(MOVEMENT_KIND_LABEL[m.kind]!)}
                    {m.decreeNo && <small className="muted"> · {m.decreeNo}</small>}
                  </td>
                  <td>{formatDate(m.effectiveDate, locale)}</td>
                  <td>
                    {MOVE_PAIRS.filter(([, to]) => m.names[to]).map(([from, to, label]) => (
                      <div key={to}>
                        {tx(label)}: {m.names[from] && <span className="muted">{m.names[from]} → </span>}
                        <strong>{m.names[to]}</strong>
                      </div>
                    ))}
                    {m.newWage && (
                      <div>
                        {l("Upah", "Wage")}:{" "}
                        {m.oldWage && <span className="muted">{money(m.oldWage, locale)} → </span>}
                        <strong>{money(m.newWage, locale)}</strong>
                      </div>
                    )}
                    {m.reason && <small className="muted">{m.reason}</small>}
                  </td>
                  <td>
                    <span className={`badge state-${m.state === "done" ? "sale" : m.state}`}>
                      {tx(STATE[m.state]!)}
                    </span>
                  </td>
                  {manage && (
                    <td>
                      {m.state === "draft" && (
                        <>
                          <ApprovalStatus
                            approval={m.approval}
                            onSubmit={() =>
                              api(`/employee-movements/${m.id}/submit-approval`, { method: "POST" }).then(
                                load,
                                (e) => setError(errorText(e)),
                              )
                            }
                          />{" "}
                          <button
                            type="button"
                            className="primary"
                            disabled={!approvalCleared(m.approval)}
                            title={
                              approvalCleared(m.approval)
                                ? undefined
                                : l(
                                    "SK harus disetujui sebelum diterapkan",
                                    "The decree must be approved first",
                                  )
                            }
                            onClick={() => act(m.id, "apply")}
                          >
                            {l("Terapkan", "Apply")}
                          </button>{" "}
                          <button type="button" className="link" onClick={() => act(m.id, "cancel")}>
                            {l("Batalkan", "Cancel")}
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
