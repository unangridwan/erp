"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { useI18n, type Text, L } from "../../lib/i18n";
import { download } from "../accounting/download";

export const DOCUMENT_KIND_LABEL: Record<string, Text> = {
  ktp: L("KTP", "ID card (KTP)"),
  npwp: L("NPWP", "Tax ID (NPWP)"),
  kk: L("Kartu Keluarga", "Family card"),
  ijazah: L("Ijazah", "Diploma"),
  cv: L("CV", "CV"),
  contract: L("Kontrak", "Contract"),
  decree: L("SK", "Decree"),
  certificate: L("Sertifikat", "Certificate"),
  other: L("Lainnya", "Other"),
};

export const errorText = (e: unknown) =>
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

interface Doc {
  id: string;
  kind: string;
  name: string;
  fileName: string;
  size: number;
  issuedDate: string | null;
  expiryDate: string | null;
  expiry: { days: number; status: "expired" | "soon" | "ok" } | null;
}

/** Dokumen karyawan/pelamar: unggah (PDF/JPG/PNG maks. 5 MB), unduh, hapus, tanggal kedaluwarsa. */
export function DocumentsPanel({ employeeId, applicantId }: { employeeId?: string; applicantId?: string }) {
  const { l, tx, locale } = useI18n();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [form, setForm] = useState({ kind: "ktp", name: "", issuedDate: "", expiryDate: "" });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = employeeId ? `employeeId=${employeeId}` : `applicantId=${applicantId}`;
  const load = useCallback(
    () => api<Doc[]>(`/hr-documents?${query}`).then(setDocs, (e) => setError(errorText(e))),
    [query],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    if (file.size > 5 * 1024 * 1024) return setError(l("Berkas maksimal 5 MB", "Files may be at most 5 MB"));
    try {
      await api("/hr-documents", {
        method: "POST",
        body: {
          ...(employeeId ? { employeeId } : { applicantId }),
          kind: form.kind,
          name: form.name || file.name,
          issuedDate: form.issuedDate || null,
          expiryDate: form.expiryDate || null,
          file: { name: file.name, type: file.type, data: await readFile(file) },
        },
      });
      setForm({ kind: form.kind, name: "", issuedDate: "", expiryDate: "" });
      setFile(null);
      (e.target as HTMLFormElement).reset();
      void load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section className="panel">
      <h2>{l("Dokumen", "Documents")}</h2>
      {docs.length > 0 && (
        <table>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>{tx(DOCUMENT_KIND_LABEL[d.kind]!)}</td>
                <td>
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      download(`/hr-documents/${d.id}/file`, d.fileName).catch((e) => setError(errorText(e)))
                    }
                  >
                    {d.name}
                  </button>{" "}
                  <small className="muted">{Math.ceil(d.size / 1024)} KB</small>
                </td>
                <td>
                  {d.expiryDate ? (
                    <span className={d.expiry && d.expiry.status !== "ok" ? "error" : undefined}>
                      {l("berlaku s.d.", "valid until")} {formatDate(d.expiryDate, locale)}
                      {d.expiry?.status === "expired" ? ` — ${l("kedaluwarsa", "expired")}` : ""}
                    </span>
                  ) : (
                    <span className="muted">{l("tanpa masa berlaku", "no expiry")}</span>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      confirm(l("Hapus dokumen ini?", "Delete this document?")) &&
                      api(`/hr-documents/${d.id}`, { method: "DELETE" }).then(load, (e) =>
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
      )}
      <form className="inline-panel" onSubmit={upload}>
        <label className="field">
          <span>{l("Jenis", "Kind")}</span>
          <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
            {Object.entries(DOCUMENT_KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {tx(v)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{l("Nama", "Name")}</span>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </label>
        <label className="field">
          <span>{l("Terbit", "Issued")}</span>
          <input
            type="date"
            value={form.issuedDate}
            onChange={(e) => setForm((f) => ({ ...f, issuedDate: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Berlaku s.d.", "Expires")}</span>
          <input
            type="date"
            value={form.expiryDate}
            onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Berkas (PDF/JPG/PNG, maks. 5 MB)", "File (PDF/JPG/PNG, max 5 MB)")}</span>
          <input
            type="file"
            required
            accept="application/pdf,image/jpeg,image/png"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button className="primary" disabled={!file}>
          {l("Unggah", "Upload")}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

interface ChecklistRow {
  id: string;
  name: string;
  kind: string;
  state: string;
  baseDate: string;
  tasks: number;
  done: number;
  overdue: number;
}

/** Checklist onboarding/offboarding seorang karyawan. */
export function ChecklistsPanel({ employeeId }: { employeeId: string }) {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<ChecklistRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api<ChecklistRow[]>(`/hr-checklists?employeeId=${employeeId}`).then(setRows, (e) =>
        setError(errorText(e)),
      ),
    [employeeId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const start = (kind: string) =>
    api("/hr-checklists", { method: "POST", body: { employeeId, kind } }).then(load, (e) =>
      setError(errorText(e)),
    );
  return (
    <section className="panel">
      <header className="toolbar">
        <h2>{l("Checklist onboarding/offboarding", "Onboarding/offboarding checklists")}</h2>
        <button type="button" onClick={() => start("onboarding")}>
          {l("Mulai onboarding", "Start onboarding")}
        </button>
        <button type="button" onClick={() => start("offboarding")}>
          {l("Mulai offboarding", "Start offboarding")}
        </button>
      </header>
      {error && <p className="error">{error}</p>}
      {rows.length === 0 ? (
        <p className="muted">{l("Belum ada checklist.", "No checklists yet.")}</p>
      ) : (
        <table>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/hr/checklists/${r.id}`}>{r.name}</Link>
                </td>
                <td>{formatDate(r.baseDate, locale)}</td>
                <td>
                  {r.done}/{r.tasks} {l("selesai", "done")}
                  {r.overdue > 0 && (
                    <span className="error">
                      {" "}
                      · {r.overdue} {l("lewat tenggat", "overdue")}
                    </span>
                  )}
                </td>
                <td>{r.state === "done" ? l("Selesai", "Done") : l("Berjalan", "Open")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
