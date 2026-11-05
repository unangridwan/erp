"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { download } from "../accounting/download";
import { api, apiRaw, ApiError } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { ContractComponentsEditor, type ComponentLine } from "./contract-components";
import { errorText } from "./hr-panels";
import { useContractTypes } from "../../lib/use-contract-types";
import { ContractTypeOptions } from "./contract-type-options";

export type SignState = "unsigned" | "pending" | "partial" | "signed";
export type SignMethod = "digital" | "manual" | "external";

export const SIGN_STATE_LABEL: Record<SignState, [string, string]> = {
  unsigned: ["Belum ditandatangani", "Not signed"],
  pending: ["Menunggu tanda tangan karyawan", "Awaiting employee signature"],
  partial: ["Ditandatangani sebagian", "Partially signed"],
  signed: ["Ditandatangani", "Signed"],
};
export const signStatePill = (s: SignState) => (s === "signed" ? "ok" : s === "unsigned" ? "" : "warn");
export const SIGN_METHOD_LABEL: Record<SignMethod, [string, string]> = {
  digital: ["tanda tangan digital di aplikasi", "digital signature in the app"],
  manual: ["tanda tangan basah (dicetak & discan)", "wet signature (printed & scanned)"],
  external: ["e-sign layanan luar", "external e-sign service"],
};

interface Signature {
  role: "company" | "employee";
  signerName: string;
  signerTitle: string | null;
  signedAt: string;
  inPerson: boolean;
}
export interface ContractDocument {
  contractId: string;
  templateId: string | null;
  templateName: string | null;
  title: string;
  body: string;
  bodyCustom: boolean;
  signerName: string | null;
  signerTitle: string | null;
  city: string | null;
  signState: SignState;
  signMethod: SignMethod | null;
  signRequestedAt: string | null;
  verifyCode: string | null;
  verifyUrl: string | null;
  documentHash: string | null;
  signedFile: { name: string; type: string; uploadedAt: string } | null;
  signatures: Signature[];
  employeeHasAccount?: boolean;
}
interface Template {
  id: string;
  name: string;
  contractType: string | null;
  active: boolean;
  isDefault: boolean;
}

/**
 * Buka PDF dari API di tab baru (tab dibuka lebih dulu agar tidak diblokir popup), atau unduh bila tab tidak bisa
 * dibuka.
 */
export async function openPdf(path: string, filename: string, post?: unknown) {
  const tab = window.open("", "_blank");
  try {
    const res = await apiRaw(path, post === undefined ? {} : { method: "POST", body: post });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const errors = (body.errors ?? []) as { path: string; message: string }[];
      throw new ApiError(
        res.status,
        body.message ?? res.statusText,
        Object.fromEntries(errors.map((e) => [e.path, e.message])),
      );
    }
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Kanvas tanda tangan (mouse, sentuh, pena). `onChange` menerima PNG data URL, atau null saat kosong. */
export function SignaturePad({ onChange, label }: { onChange: (png: string | null) => void; label: string }) {
  const { l } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const ink = useRef(0);

  const resize = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = Math.round(c.clientWidth * ratio);
    c.height = Math.round(c.clientHeight * ratio);
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#14215b";
    ink.current = 0;
    onChange(null);
  }, [onChange]);

  useEffect(() => {
    resize();
  }, [resize]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext("2d")!;
    const [x, y] = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d")!;
    const [x, y] = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    ink.current += 1;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    // Coretan sangat pendek (klik tak sengaja) belum dianggap tanda tangan.
    onChange(ink.current > 8 && canvas.current ? canvas.current.toDataURL("image/png") : null);
  };

  return (
    <div className="signature-pad">
      <canvas
        ref={canvas}
        aria-label={label}
        role="img"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
      />
      <div className="signature-pad-foot">
        <small className="muted">{l("Tanda tangan di dalam kotak", "Sign inside the box")}</small>
        <button type="button" className="link" onClick={resize}>
          {l("Hapus", "Clear")}
        </button>
      </div>
    </div>
  );
}

/** Formulir tanda tangan: kanvas + centang persetujuan isi. */
function SignForm({
  title,
  hint,
  onSubmit,
  onCancel,
}: {
  title: string;
  hint?: string;
  onSubmit: (image: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { l } = useI18n();
  const [image, setImage] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="sign-form">
      <h3>{title}</h3>
      {hint && <p className="muted">{hint}</p>}
      <SignaturePad onChange={setImage} label={title} />
      <label className="check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          {l(
            "Saya telah membaca dan menyetujui seluruh isi kontrak ini.",
            "I have read and agree to the entire contract.",
          )}
        </span>
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row-actions">
        <button
          type="button"
          className="primary"
          disabled={!image || !agree || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onSubmit(image!);
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {l("Tanda tangani", "Sign")}
        </button>
        <button type="button" onClick={onCancel}>
          {l("Batal", "Cancel")}
        </button>
      </div>
    </div>
  );
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function SignatureList({ doc }: { doc: ContractDocument }) {
  const { l, locale } = useI18n();
  if (!doc.signatures.length) return null;
  return (
    <ul className="activity-list">
      {doc.signatures.map((s) => (
        <li key={s.role}>
          <span className="pill ok">
            {s.role === "company" ? l("Perusahaan", "Company") : l("Karyawan", "Employee")}
          </span>
          <span>
            {s.signerName}
            {s.signerTitle ? ` (${s.signerTitle})` : ""} · {formatDate(s.signedAt.slice(0, 10), locale)}{" "}
            {new Date(s.signedAt).toLocaleTimeString(locale === "en" ? "en-GB" : "id-ID", {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {s.inPerson ? ` · ${l("di hadapan HR", "in person with HR")}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Dokumen kontrak (HR): pilih template & penandatangan, ubah isi, PDF cetak (tanda tangan basah) / e-sign layanan
 * luar / bertanda tangan, tanda tangan di aplikasi, minta tanda tangan karyawan, unggah hasil tanda tangan.
 */
export function ContractDocumentPanel({
  contractId,
  contractType,
  onChange,
}: {
  contractId: string;
  contractType: string;
  onChange?: () => void;
}) {
  const { l, locale } = useI18n();
  const [doc, setDoc] = useState<ContractDocument | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState({ templateId: "", signerName: "", signerTitle: "", city: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [signing, setSigning] = useState<"company" | "employee" | null>(null);
  const [upload, setUpload] = useState<{ method: "manual" | "external"; file: File | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((d: ContractDocument) => {
    setDoc(d);
    setForm({
      templateId: d.templateId ?? "",
      signerName: d.signerName ?? "",
      signerTitle: d.signerTitle ?? "",
      city: d.city ?? "",
    });
  }, []);
  const load = useCallback(
    () =>
      api<ContractDocument>(`/contracts/${contractId}/document`).then(apply, (e) => setError(errorText(e))),
    [contractId, apply],
  );
  useEffect(() => {
    void load();
    api<{ items: Template[] }>("/contract-templates").then(
      (r) => setTemplates(r.items),
      () => setTemplates([]),
    );
  }, [load]);

  const run = async (fn: () => Promise<ContractDocument | void>, message?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const d = await fn();
      if (d) apply(d);
      if (message) setNotice(message);
      onChange?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!doc) return error ? <p className="error">{error}</p> : null;
  const locked = doc.signatures.length > 0 || !!doc.signedFile;
  const signed = (role: "company" | "employee") => doc.signatures.some((s) => s.role === role);
  const options = templates.filter(
    (t) => (t.active || t.id === doc.templateId) && (!t.contractType || t.contractType === contractType),
  );
  const changed =
    form.templateId !== (doc.templateId ?? "") ||
    form.signerName !== (doc.signerName ?? "") ||
    form.signerTitle !== (doc.signerTitle ?? "") ||
    form.city !== (doc.city ?? "");
  const pdfName = (suffix: string) => `kontrak-${suffix}.pdf`;
  const pdf = (mode: "print" | "esign" | "signed") =>
    run(() => openPdf(`/contracts/${contractId}/pdf?mode=${mode}`, pdfName(mode)));

  return (
    <section className="panel contract-doc">
      <header className="toolbar">
        <h2>{l("Dokumen & tanda tangan", "Document & signatures")}</h2>
        <span className={`pill ${signStatePill(doc.signState)}`}>
          {l(...SIGN_STATE_LABEL[doc.signState])}
        </span>
        {doc.signMethod && <span className="muted">{l(...SIGN_METHOD_LABEL[doc.signMethod])}</span>}
      </header>
      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <fieldset className="fields" disabled={locked || busy}>
        <label className="field">
          <span>{l("Template", "Template")}</span>
          <select
            value={form.templateId}
            onChange={(e) => setForm((f) => ({ ...f, templateId: e.target.value }))}
          >
            <option value="">
              {l("— bawaan sesuai jenis kontrak —", "— default for the contract type —")}
            </option>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isDefault ? ` (${l("bawaan", "default")})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{l("Penandatangan perusahaan", "Company signatory")}</span>
          <input
            value={form.signerName}
            maxLength={200}
            onChange={(e) => setForm((f) => ({ ...f, signerName: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Jabatan penandatangan", "Signatory title")}</span>
          <input
            value={form.signerTitle}
            maxLength={200}
            onChange={(e) => setForm((f) => ({ ...f, signerTitle: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Kota penandatanganan", "Place of signing")}</span>
          <input
            value={form.city}
            maxLength={100}
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
          />
        </label>
      </fieldset>
      {!locked && changed && (
        <p>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  api<ContractDocument>(`/contracts/${contractId}/document`, {
                    method: "PUT",
                    body: {
                      templateId: form.templateId || null,
                      signerName: form.signerName || null,
                      signerTitle: form.signerTitle || null,
                      city: form.city || null,
                      // Ganti template = isi dirender ulang; isi kustom dipertahankan bila template sama.
                      body: form.templateId === (doc.templateId ?? "") && doc.bodyCustom ? doc.body : null,
                    },
                  }),
                l("Dokumen diperbarui.", "Document updated."),
              )
            }
          >
            {l("Terapkan", "Apply")}
          </button>
        </p>
      )}

      <div className="contract-doc-actions">
        <div>
          <h3>{l("Tanda tangan basah", "Wet signature")}</h3>
          <p className="muted">
            {l(
              "Cetak, tanda tangani kedua pihak di atas meterai, lalu unggah hasil scan.",
              "Print, have both parties sign over the duty stamp, then upload the scan.",
            )}
          </p>
          <div className="row-actions">
            <button type="button" disabled={busy} onClick={() => pdf("print")}>
              {l("PDF untuk dicetak", "Printable PDF")}
            </button>
            {!doc.signatures.length && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setUpload({ method: "manual", file: null })}
              >
                {l("Unggah hasil scan", "Upload scan")}
              </button>
            )}
          </div>
        </div>
        <div>
          <h3>{l("E-sign layanan luar", "External e-sign")}</h3>
          <p className="muted">
            {l(
              "PDF dengan kolom tanda tangan untuk PrivyID, Peruri, Adobe Sign, dll. Unggah PDF hasilnya di sini.",
              "PDF with signature fields for PrivyID, Peruri, Adobe Sign, etc. Upload the signed PDF here.",
            )}
          </p>
          <div className="row-actions">
            <button type="button" disabled={busy} onClick={() => pdf("esign")}>
              {l("PDF e-sign", "E-sign PDF")}
            </button>
            {!doc.signatures.length && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setUpload({ method: "external", file: null })}
              >
                {l("Unggah PDF bertanda tangan", "Upload signed PDF")}
              </button>
            )}
          </div>
        </div>
        <div>
          <h3>{l("Tanda tangan digital di aplikasi", "Digital signature in the app")}</h3>
          <p className="muted">
            {l(
              "Tanda tangan digambar di layar, dengan jejak audit (waktu, IP) dan kode verifikasi pada PDF.",
              "Signatures drawn on screen, with an audit trail (time, IP) and a verification code on the PDF.",
            )}
          </p>
          {!doc.signedFile && (
            <div className="row-actions">
              {!signed("company") && (
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => setSigning("company")}
                >
                  {l("Tanda tangan perusahaan", "Sign for the company")}
                </button>
              )}
              {!signed("employee") && (
                <button
                  type="button"
                  disabled={busy || doc.employeeHasAccount === false}
                  title={
                    doc.employeeHasAccount === false
                      ? l("Karyawan belum punya akun portal", "The employee has no portal account")
                      : undefined
                  }
                  onClick={() =>
                    run(
                      () =>
                        api<ContractDocument>(`/contracts/${contractId}/request-signature`, {
                          method: "POST",
                        }),
                      l(
                        "Permintaan tanda tangan dikirim ke portal karyawan.",
                        "Signature request sent to the employee portal.",
                      ),
                    )
                  }
                >
                  {doc.signRequestedAt
                    ? l("Kirim ulang permintaan ke portal", "Resend request to the portal")
                    : l("Minta tanda tangan karyawan (portal)", "Request employee signature (portal)")}
                </button>
              )}
              {!signed("employee") && (
                <button type="button" disabled={busy} onClick={() => setSigning("employee")}>
                  {l("Karyawan tanda tangan di sini", "Employee signs here")}
                </button>
              )}
              {doc.signatures.length > 0 && (
                <button type="button" disabled={busy} onClick={() => pdf("signed")}>
                  {l("PDF bertanda tangan", "Signed PDF")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {signing && (
        <SignForm
          title={
            signing === "company"
              ? l(
                  `Tanda tangan pihak perusahaan — ${form.signerName || "…"}`,
                  `Company signature — ${form.signerName || "…"}`,
                )
              : l("Tanda tangan karyawan (di hadapan HR)", "Employee signature (in person)")
          }
          hint={
            signing === "employee"
              ? l(
                  "Serahkan perangkat kepada karyawan; karyawan membaca kontrak (PDF) lalu menandatangani sendiri.",
                  "Hand the device to the employee; they read the contract (PDF) and sign it themselves.",
                )
              : undefined
          }
          onCancel={() => setSigning(null)}
          onSubmit={async (image) => {
            const d = await api<ContractDocument>(`/contracts/${contractId}/sign`, {
              method: "POST",
              body: { role: signing, image, agree: true, inPerson: signing === "employee" },
            });
            apply(d);
            setSigning(null);
            setNotice(l("Tanda tangan tersimpan.", "Signature saved."));
            onChange?.();
          }}
        />
      )}

      {upload && (
        <div className="inline-panel">
          <label className="field">
            <span>
              {upload.method === "manual"
                ? l(
                    "Scan kontrak bertanda tangan (PDF/JPG/PNG, maks. 7 MB)",
                    "Signed scan (PDF/JPG/PNG, max 7 MB)",
                  )
                : l("PDF hasil e-sign (maks. 7 MB)", "Signed PDF (max 7 MB)")}
            </span>
            <input
              type="file"
              accept={upload.method === "manual" ? "application/pdf,image/jpeg,image/png" : "application/pdf"}
              onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] ?? null })}
            />
          </label>
          <button
            type="button"
            className="primary"
            disabled={!upload.file || busy}
            onClick={() =>
              run(
                async () => {
                  const file = upload.file!;
                  const d = await api<ContractDocument>(`/contracts/${contractId}/signed-file`, {
                    method: "POST",
                    body: {
                      method: upload.method,
                      name: file.name,
                      type: file.type,
                      data: await readFile(file),
                    },
                  });
                  setUpload(null);
                  return d;
                },
                l("Kontrak bertanda tangan tersimpan.", "Signed contract saved."),
              )
            }
          >
            {l("Unggah", "Upload")}
          </button>
          <button type="button" onClick={() => setUpload(null)}>
            {l("Batal", "Cancel")}
          </button>
        </div>
      )}

      {doc.signRequestedAt && !signed("employee") && (
        <p className="muted">
          {l(
            "Tanda tangan karyawan diminta lewat portal pada",
            "Employee signature requested via the portal on",
          )}{" "}
          {formatDate(doc.signRequestedAt.slice(0, 10), locale)}.
        </p>
      )}
      <SignatureList doc={doc} />
      {doc.signedFile && (
        <p>
          <button
            type="button"
            className="link"
            onClick={() => run(() => download(`/contracts/${contractId}/signed-file`, doc.signedFile!.name))}
          >
            {doc.signedFile.name}
          </button>{" "}
          <span className="muted">· {l(...SIGN_METHOD_LABEL[doc.signMethod ?? "manual"])}</span>
        </p>
      )}
      {doc.verifyCode && (
        <p className="muted">
          {l("Kode verifikasi", "Verification code")}: <strong>{doc.verifyCode}</strong>
          {doc.verifyUrl && (
            <>
              {" · "}
              <a href={doc.verifyUrl} target="_blank" rel="noreferrer">
                {l("Halaman verifikasi", "Verification page")}
              </a>
            </>
          )}
        </p>
      )}
      {locked && (
        <p>
          <span className="muted">
            {l(
              "Isi & syarat kontrak terkunci karena sudah ditandatangani.",
              "The contract text and terms are locked because it has been signed.",
            )}
          </span>{" "}
          <button
            type="button"
            className="link danger"
            disabled={busy}
            onClick={() =>
              confirm(
                l(
                  "Batalkan semua tanda tangan & berkas bertanda tangan? Kontrak harus ditandatangani ulang.",
                  "Revoke all signatures and the signed file? The contract will have to be signed again.",
                ),
              ) &&
              run(
                () => api<ContractDocument>(`/contracts/${contractId}/signatures`, { method: "DELETE" }),
                l("Tanda tangan dibatalkan.", "Signatures revoked."),
              )
            }
          >
            {l("Batalkan tanda tangan", "Revoke signatures")}
          </button>
        </p>
      )}

      <details className="contract-body" open={editing !== null}>
        <summary>
          {doc.title}
          {doc.templateName && <span className="muted"> · {doc.templateName}</span>}
          {doc.bodyCustom && <span className="pill warn">{l("diedit manual", "edited")}</span>}
        </summary>
        {editing !== null ? (
          <>
            <textarea
              className="contract-editor"
              value={editing}
              maxLength={80000}
              onChange={(e) => setEditing(e.target.value)}
              aria-label={l("Isi kontrak", "Contract text")}
            />
            <div className="row-actions">
              <button
                type="button"
                className="primary"
                disabled={busy || !editing.trim()}
                onClick={() =>
                  run(
                    async () => {
                      const d = await api<ContractDocument>(`/contracts/${contractId}/document`, {
                        method: "PUT",
                        body: { body: editing },
                      });
                      setEditing(null);
                      return d;
                    },
                    l("Isi kontrak disimpan.", "Contract text saved."),
                  )
                }
              >
                {l("Simpan isi", "Save text")}
              </button>
              <button type="button" onClick={() => setEditing(null)}>
                {l("Batal", "Cancel")}
              </button>
            </div>
          </>
        ) : (
          <>
            <pre className="contract-preview">{doc.body}</pre>
            {!locked && (
              <div className="row-actions">
                <button type="button" onClick={() => setEditing(doc.body)}>
                  {l("Ubah isi untuk kontrak ini", "Edit text for this contract")}
                </button>
                {doc.bodyCustom && (
                  <button
                    type="button"
                    onClick={() =>
                      run(
                        () =>
                          api<ContractDocument>(`/contracts/${contractId}/document`, {
                            method: "PUT",
                            body: { templateId: doc.templateId, body: null },
                          }),
                        l("Isi kembali mengikuti template.", "The text follows the template again."),
                      )
                    }
                  >
                    {l("Kembalikan ke template", "Reset to template")}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </details>
    </section>
  );
}

interface MyContract {
  id: string;
  name: string;
  contractType: string;
  contractTypeName: string | null;
  state: string;
  dateStart: string;
  dateEnd: string | null;
  signState: SignState;
  signMethod: SignMethod | null;
  hasSignedFile: boolean;
  canSign: boolean;
  signatures: { role: "company" | "employee"; signedAt: string }[];
}

/** Portal karyawan: kontrak kerja saya — baca PDF, tanda tangani bila diminta, unduh hasil bertanda tangan. */
export function MyContracts() {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<MyContract[] | null>(null);
  const [signing, setSigning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(
    () => api<MyContract[]>("/me/contracts").then(setRows, (e) => setError(errorText(e))),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!rows?.length) return error ? <p className="error">{error}</p> : null;
  const open = (path: string, name: string) => openPdf(path, name).catch((e) => setError(errorText(e)));

  return (
    <section className="panel">
      <h2>{l("Kontrak kerja saya", "My employment contracts")}</h2>
      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{l("Kontrak", "Contract")}</th>
              <th>{l("Periode", "Period")}</th>
              <th>{l("Tanda tangan", "Signature")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.name} · {c.contractTypeName ?? c.contractType.toUpperCase()}
                </td>
                <td>
                  {formatDate(c.dateStart, locale)} –{" "}
                  {c.dateEnd ? formatDate(c.dateEnd, locale) : l("tidak terbatas", "open-ended")}
                </td>
                <td>
                  <span className={`pill ${c.canSign ? "warn" : signStatePill(c.signState)}`}>
                    {c.canSign
                      ? l("Menunggu tanda tangan Anda", "Awaiting your signature")
                      : l(...SIGN_STATE_LABEL[c.signState])}
                  </span>
                </td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="link"
                    onClick={() => open(`/me/contracts/${c.id}/pdf`, `${c.name}.pdf`)}
                  >
                    {l("Baca kontrak", "Read contract")}
                  </button>
                  {c.signatures.length > 0 && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => open(`/me/contracts/${c.id}/pdf?mode=signed`, `${c.name}-ttd.pdf`)}
                    >
                      {l("PDF bertanda tangan", "Signed PDF")}
                    </button>
                  )}
                  {c.hasSignedFile && (
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        download(`/me/contracts/${c.id}/signed-file`, `${c.name}-ttd`).catch((e) =>
                          setError(errorText(e)),
                        )
                      }
                    >
                      {l("Berkas bertanda tangan", "Signed file")}
                    </button>
                  )}
                  {c.canSign && (
                    <button type="button" className="primary" onClick={() => setSigning(c.id)}>
                      {l("Tanda tangani", "Sign")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {signing && (
        <SignForm
          title={l("Tanda tangan kontrak kerja", "Sign the employment contract")}
          hint={l(
            "Baca kontrak terlebih dahulu (tombol Baca kontrak). Tanda tangan Anda dicatat bersama waktu dan alamat IP.",
            "Read the contract first (Read contract). Your signature is recorded with the time and IP address.",
          )}
          onCancel={() => setSigning(null)}
          onSubmit={async (image) => {
            await api(`/me/contracts/${signing}/sign`, { method: "POST", body: { image, agree: true } });
            setSigning(null);
            setNotice(l("Kontrak berhasil ditandatangani.", "Contract signed."));
            await load();
          }}
        />
      )}
    </section>
  );
}

export interface NewContractValues {
  /** Tanggal mulai kontrak = tanggal masuk karyawan (hanya diinput di sini). */
  dateStart: string;
  templateId: string;
  contractType: string;
  dateEnd: string;
  wage: string;
  wageType: "monthly" | "daily" | "piece";
  taxMethod: "gross" | "gross_up";
  /** Komponen gaji lain: tunjangan tetap/tidak tetap & potongan. */
  allowances: ComponentLine[];
}
export const NEW_CONTRACT: NewContractValues = {
  dateStart: "",
  templateId: "",
  contractType: "pkwt",
  dateEnd: "",
  wage: "",
  wageType: "monthly",
  taxMethod: "gross",
  allowances: [],
};
/** Tanggal berakhir kontrak `months` bulan sejak `start` (inklusif: 16 Nov + 12 bln → 15 Nov tahun depan). */
export function contractEnd(start: string, months: number) {
  const [y, m, d] = start.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last) - 1);
  return target.toISOString().slice(0, 10);
}

/**
 * Kontrak kerja karyawan baru: tanggal mulainya adalah tanggal masuk karyawan (satu-satunya tempat tanggal masuk
 * diinput). Kontrak langsung berlaku saat karyawan disimpan.
 */
export function NewEmployeeContract({
  value,
  onChange,
  errors,
}: {
  value: NewContractValues;
  onChange: (v: NewContractValues) => void;
  errors: Record<string, string>;
}) {
  const { l } = useI18n();
  const types = useContractTypes();
  const type = types.find(value.contractType);
  const fixedTerm = types.fixedTerm(value.contractType);
  const [templates, setTemplates] = useState<Template[]>([]);
  useEffect(() => {
    api<{ items: Template[] }>("/contract-templates").then(
      (r) => setTemplates(r.items.filter((t) => t.active)),
      () => setTemplates([]),
    );
  }, []);
  const set = <K extends keyof NewContractValues>(k: K, v: NewContractValues[K]) =>
    onChange({ ...value, [k]: v });
  const fe = (k: string) =>
    errors[`contract.${k}`] && <small className="error">{errors[`contract.${k}`]}</small>;
  const options = templates.filter((t) => !t.contractType || t.contractType === value.contractType);

  return (
    <section className="o-group new-contract">
      <h3 className="o-group-title">{l("Kontrak kerja", "Employment contract")}</h3>
      <p className="muted small">
        {l(
          "Tanggal mulai kontrak menjadi tanggal masuk karyawan. Kontrak langsung berlaku saat karyawan disimpan; tanggal keluar nanti diisi lewat Akhiri kontrak.",
          "The contract start date becomes the employee's join date. The contract takes effect when the employee is saved; the leaving date is later set with End contract.",
        )}
      </p>
      <fieldset className="fields">
        <label className="field">
          <span>{l("Tanggal mulai (tanggal masuk) *", "Start date (join date) *")}</span>
          <input
            type="date"
            required
            value={value.dateStart}
            onChange={(e) => set("dateStart", e.target.value)}
          />
          {fe("dateStart")}
        </label>
        <label className="field">
          <span>{l("Jenis kontrak", "Contract type")}</span>
          <select
            value={value.contractType}
            onChange={(e) =>
              onChange({
                ...value,
                contractType: e.target.value,
                templateId: "",
                dateEnd: types.fixedTerm(e.target.value) ? value.dateEnd : "",
              })
            }
          >
            <ContractTypeOptions types={types} current={value.contractType} />
          </select>
          {type?.legalBasis && <small className="muted">{type.legalBasis}</small>}
          {fe("contractType")}
        </label>
        <label className="field">
          <span>{fixedTerm ? l("Berakhir *", "End *") : l("Berakhir", "End")}</span>
          <input
            type="date"
            value={value.dateEnd}
            min={value.dateStart || undefined}
            onChange={(e) => set("dateEnd", e.target.value)}
          />
          {fixedTerm && value.dateStart && (
            <span className="row-actions">
              {[6, 12, 24]
                .filter((m) => !type?.maxMonths || m <= type.maxMonths)
                .map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="link small"
                    onClick={() => set("dateEnd", contractEnd(value.dateStart, m))}
                  >
                    {m} {l("bln", "mo")}
                  </button>
                ))}
            </span>
          )}
          {fe("dateEnd")}
        </label>
        <label className="field">
          <span>{l("Template dokumen", "Document template")}</span>
          <select value={value.templateId} onChange={(e) => set("templateId", e.target.value)}>
            <option value="">{l("— bawaan —", "— default —")}</option>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isDefault ? ` (${l("bawaan", "default")})` : ""}
              </option>
            ))}
          </select>
          {fe("templateId")}
        </label>
        <label className="field">
          <span>{l("Jenis upah", "Wage type")}</span>
          <select
            value={value.wageType}
            onChange={(e) => set("wageType", e.target.value as NewContractValues["wageType"])}
          >
            <option value="monthly">{l("Bulanan", "Monthly")}</option>
            <option value="daily">{l("Harian lepas", "Daily")}</option>
            <option value="piece">{l("Borongan", "Piece rate")}</option>
          </select>
        </label>
        <label className="field">
          <span>
            {value.wageType === "daily"
              ? l("Upah per hari *", "Wage per day *")
              : value.wageType === "piece"
                ? l("Upah per satuan *", "Rate per unit *")
                : l("Gaji pokok / bulan *", "Base wage / month *")}
          </span>
          <input
            className="num"
            inputMode="decimal"
            value={value.wage}
            onChange={(e) => set("wage", e.target.value)}
          />
          {fe("wage")}
        </label>
        <label className="field">
          <span>{l("Metode PPh 21", "PPh 21 method")}</span>
          <select
            value={value.taxMethod}
            onChange={(e) => set("taxMethod", e.target.value as NewContractValues["taxMethod"])}
          >
            <option value="gross">{l("Gross — dipotong dari gaji", "Gross — withheld from pay")}</option>
            <option value="gross_up">
              {l("Gross-up — ditanggung perusahaan", "Gross-up — company-borne")}
            </option>
          </select>
        </label>
      </fieldset>
      <h4 className="o-subtitle">{l("Komponen gaji lain", "Other pay components")}</h4>
      <ContractComponentsEditor
        value={value.allowances}
        onChange={(allowances) => onChange({ ...value, allowances })}
        wage={value.wage}
        wageType={value.wageType}
        editable
        errors={errors}
        errorPrefix="contract."
      />
      <p className="muted small">
        {l(
          "Setelah disimpan, dokumen kontrak dari template bisa langsung dicetak atau ditandatangani di halaman kontrak.",
          "After saving, the contract document from the template can be printed or signed on the contract page.",
        )}
      </p>
    </section>
  );
}
