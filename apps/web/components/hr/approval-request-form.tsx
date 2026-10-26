"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { L, useI18n, type Text } from "../../lib/i18n";

export type FieldMode = "required" | "optional" | "none";
export type FieldKey =
  | "date"
  | "period"
  | "quantity"
  | "amount"
  | "reference"
  | "location"
  | "contact"
  | "description"
  | "attachment";

export interface ApprovalCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  fields: Partial<Record<FieldKey, FieldMode>>;
}

export const FIELD_LABEL: Record<FieldKey, Text> = {
  date: L("Tanggal", "Date"),
  period: L("Periode", "Period"),
  quantity: L("Jumlah", "Quantity"),
  amount: L("Nominal (Rp)", "Amount (IDR)"),
  reference: L("Referensi", "Reference"),
  location: L("Lokasi", "Location"),
  contact: L("Kontak / pihak terkait", "Contact / party"),
  description: L("Keterangan", "Description"),
  attachment: L("Lampiran", "Attachment"),
};

export const REQUEST_STATE_LABEL: Record<string, Text> = {
  draft: L("Draft", "Draft"),
  submitted: L("Menunggu persetujuan", "To approve"),
  approved: L("Disetujui", "Approved"),
  refused: L("Ditolak", "Refused"),
  cancel: L("Dibatalkan", "Cancelled"),
};

export interface RequestForm {
  categoryId: string;
  subject: string;
  date: string;
  dateFrom: string;
  dateTo: string;
  quantity: string;
  amount: string;
  reference: string;
  location: string;
  contact: string;
  description: string;
  attachmentName?: string | null;
  attachment?: { name: string; type: string; data: string } | null;
}

export const emptyRequest = (categoryId = ""): RequestForm => ({
  categoryId,
  subject: "",
  date: "",
  dateFrom: "",
  dateTo: "",
  quantity: "",
  amount: "",
  reference: "",
  location: "",
  contact: "",
  description: "",
});

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** Form permintaan persetujuan: field tampil & wajib sesuai konfigurasi kategori. */
export function ApprovalRequestForm(props: {
  categories: ApprovalCategory[];
  initial?: RequestForm;
  requestId?: string;
  onSaved: (request: { id: string }) => void;
  onCancel?: () => void;
}) {
  const { l, tx } = useI18n();
  const [form, setForm] = useState<RequestForm>(props.initial ?? emptyRequest(props.categories[0]?.id));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Draft yang sudah tersimpan (mis. "Simpan & ajukan" gagal validasi) diperbarui, bukan dibuat ulang.
  const [savedId, setSavedId] = useState(props.requestId);
  const category = props.categories.find((c) => c.id === form.categoryId);
  const mode = (k: FieldKey): FieldMode => category?.fields[k] ?? "none";
  const set = (patch: Partial<RequestForm>) => setForm((f) => ({ ...f, ...patch }));

  async function save(e: FormEvent, submit: boolean) {
    e.preventDefault();
    setError(null);
    setErrors({});
    setBusy(true);
    const show = (k: FieldKey) => mode(k) !== "none";
    const body = {
      categoryId: form.categoryId,
      subject: form.subject,
      date: show("date") && form.date ? form.date : null,
      dateFrom: show("period") && form.dateFrom ? form.dateFrom : null,
      dateTo: show("period") && form.dateTo ? form.dateTo : null,
      quantity: show("quantity") && form.quantity ? form.quantity : null,
      amount: show("amount") && form.amount ? form.amount : null,
      reference: show("reference") ? form.reference || null : null,
      location: show("location") ? form.location || null : null,
      contact: show("contact") ? form.contact || null : null,
      description: show("description") ? form.description || null : null,
      ...(form.attachment !== undefined ? { attachment: form.attachment } : {}),
    };
    try {
      const saved = await api<{ id: string }>(
        savedId ? `/approval-requests/${savedId}` : "/approval-requests",
        { method: savedId ? "PUT" : "POST", body },
      );
      setSavedId(saved.id);
      if (submit) await api(`/approval-requests/${saved.id}/submit`, { method: "POST" });
      props.onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setError(err.message);
      } else setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const label = (k: FieldKey) => (
    <span>
      {tx(FIELD_LABEL[k])}
      {mode(k) === "required" && " *"}
    </span>
  );
  const fieldError = (k: string) => errors[k] && <small className="error">{errors[k]}</small>;
  const text = (k: "reference" | "location" | "contact") =>
    mode(k) !== "none" && (
      <label className="field">
        {label(k)}
        <input value={form[k]} onChange={(e) => set({ [k]: e.target.value })} />
        {fieldError(k)}
      </label>
    );

  return (
    <form className="stack request-form" onSubmit={(e) => save(e, false)}>
      <div className="grid-2">
        <label className="field">
          <span>{l("Kategori", "Category")} *</span>
          <select value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })} required>
            {props.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{l("Subjek", "Subject")} *</span>
          <input value={form.subject} onChange={(e) => set({ subject: e.target.value })} required />
          {fieldError("subject")}
        </label>
        {mode("date") !== "none" && (
          <label className="field">
            {label("date")}
            <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
            {fieldError("date")}
          </label>
        )}
        {mode("period") !== "none" && (
          <>
            <label className="field">
              <span>
                {l("Mulai", "From")}
                {mode("period") === "required" && " *"}
              </span>
              <input type="date" value={form.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} />
              {fieldError("dateFrom")}
            </label>
            <label className="field">
              <span>
                {l("Selesai", "To")}
                {mode("period") === "required" && " *"}
              </span>
              <input type="date" value={form.dateTo} onChange={(e) => set({ dateTo: e.target.value })} />
              {fieldError("dateTo")}
            </label>
          </>
        )}
        {mode("quantity") !== "none" && (
          <label className="field">
            {label("quantity")}
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.quantity}
              onChange={(e) => set({ quantity: e.target.value })}
            />
            {fieldError("quantity")}
          </label>
        )}
        {mode("amount") !== "none" && (
          <label className="field">
            {label("amount")}
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => set({ amount: e.target.value })}
            />
            {fieldError("amount")}
          </label>
        )}
        {text("reference")}
        {text("location")}
        {text("contact")}
        {mode("attachment") !== "none" && (
          <label className="field">
            {label("attachment")}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                set({
                  attachment: { name: f.name, type: f.type, data: await readFile(f) },
                  attachmentName: f.name,
                });
              }}
            />
            {form.attachmentName && <small className="muted">{form.attachmentName}</small>}
            {fieldError("attachment")}
          </label>
        )}
      </div>
      {mode("description") !== "none" && (
        <label className="field">
          {label("description")}
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
          />
          {fieldError("description")}
        </label>
      )}
      {category?.description && <p className="muted">{category.description}</p>}
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button type="submit" disabled={busy}>
          {l("Simpan draft", "Save draft")}
        </button>
        <button type="button" className="primary" disabled={busy} onClick={(e) => save(e, true)}>
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

/** Kelas badge per status permintaan. */
export const REQUEST_BADGE: Record<string, string> = {
  draft: "state-draft",
  submitted: "state-sent",
  approved: "state-sale",
  refused: "state-lost",
  cancel: "state-cancel",
};
