"use client";

import {
  CUSTOM_FIELD_MODELS,
  CUSTOM_FIELD_TYPES,
  CUSTOM_REF_MODELS,
  type CustomFieldModel,
  type CustomFieldType,
  type CustomRefModel,
} from "@erp/shared";
import { useCallback, useEffect, useState } from "react";
import {
  CustomFieldInput,
  resetCustomFieldCache,
  type CustomDef,
} from "../../../../components/custom-fields";
import { DataTable } from "../../../../components/data-table";
import { ask, Modal, toast } from "../../../../components/feedback";
import { api, ApiError } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

type Row = CustomDef & {
  companyId: string | null;
  labelEn: string | null;
  active: boolean;
  showInList: boolean;
  showOnPdf: boolean;
  required: boolean;
  sequence: number;
};

interface Draft {
  id?: string;
  model: CustomFieldModel;
  key: string;
  label: string;
  labelEn: string;
  fieldType: CustomFieldType;
  options: { value: string; label: string }[];
  refModel: CustomRefModel | "";
  required: boolean;
  defaultValue: unknown;
  help: string;
  section: string;
  sequence: string;
  showInList: boolean;
  showOnPdf: boolean;
  active: boolean;
  used?: boolean;
}

const MODELS = Object.keys(CUSTOM_FIELD_MODELS) as CustomFieldModel[];
const TYPES = Object.keys(CUSTOM_FIELD_TYPES) as CustomFieldType[];
const PDF_MODELS: CustomFieldModel[] = ["sale_order", "purchase_order"];

/** Kunci dari label: huruf kecil, garis bawah. */
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f_$1")
    .slice(0, 40);

const empty = (model: CustomFieldModel): Draft => ({
  model,
  key: "",
  label: "",
  labelEn: "",
  fieldType: "text",
  options: [],
  refModel: "",
  required: false,
  defaultValue: "",
  help: "",
  section: "",
  sequence: "0",
  showInList: false,
  showOnPdf: false,
  active: true,
});

/** Pengaturan › Field Kustom: kolom tambahan buatan admin untuk master & dokumen utama. */
export default function CustomFieldsPage() {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [model, setModel] = useState<CustomFieldModel | "">("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [keyTouched, setKeyTouched] = useState(false);
  const modelLabel = (m: string) =>
    CUSTOM_FIELD_MODELS[m as CustomFieldModel]?.label[locale === "id" ? 0 : 1] ?? m;
  const typeLabel = (t: string) => CUSTOM_FIELD_TYPES[t as CustomFieldType]?.[locale === "id" ? 0 : 1] ?? t;

  const load = useCallback(() => {
    api<Row[]>("/custom-fields?all=true")
      .then(setRows)
      .catch((e: Error) => toast.error(e.message));
  }, []);
  useEffect(load, [load]);

  async function open(row?: Row) {
    setErrors({});
    setKeyTouched(!!row);
    if (!row) return setDraft(empty(model || "partner"));
    const full = await api<Row & { used: boolean }>(`/custom-fields/${row.id}`);
    setDraft({
      id: full.id,
      model: full.model,
      key: full.key,
      label: full.label,
      labelEn: full.labelEn ?? "",
      fieldType: full.fieldType,
      options: full.options ?? [],
      refModel: full.refModel ?? "",
      required: full.required,
      defaultValue: full.defaultValue ?? "",
      help: full.help ?? "",
      section: full.section ?? "",
      sequence: String(full.sequence ?? 0),
      showInList: full.showInList,
      showOnPdf: full.showOnPdf,
      active: full.active,
      used: full.used,
    });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setErrors({});
    const choice = draft.fieldType === "select" || draft.fieldType === "multiselect";
    const body = {
      model: draft.model,
      key: draft.key,
      label: draft.label,
      labelEn: draft.labelEn || null,
      fieldType: draft.fieldType,
      options: choice ? draft.options.filter((o) => o.value || o.label) : [],
      refModel: draft.fieldType === "ref" ? draft.refModel || null : null,
      required: draft.required,
      defaultValue:
        draft.defaultValue === "" || draft.fieldType === "ref"
          ? null
          : (draft.fieldType === "number" || draft.fieldType === "money") &&
              typeof draft.defaultValue === "string"
            ? Number(draft.defaultValue)
            : draft.defaultValue,
      help: draft.help || null,
      section: draft.section || null,
      sequence: Number(draft.sequence) || 0,
      showInList: draft.showInList,
      showOnPdf: draft.showOnPdf,
      active: draft.active,
    };
    try {
      if (draft.id) await api(`/custom-fields/${draft.id}`, { method: "PUT", body });
      else await api("/custom-fields", { method: "POST", body });
      toast.success(l("Field kustom disimpan.", "Custom field saved."));
      resetCustomFieldCache();
      setDraft(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setErrors(e.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft?.id) return;
    const ok = await ask({
      title: l("Hapus field kustom?", "Delete custom field?"),
      message: l(
        `Field "${draft.label}" beserta nilainya di semua data akan dihapus. Untuk menyembunyikan saja, nonaktifkan.`,
        `"${draft.label}" and its values on every record will be deleted. To just hide it, deactivate it.`,
      ),
      confirmLabel: l("Hapus", "Delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/custom-fields/${draft.id}`, { method: "DELETE" });
      resetCustomFieldCache();
      setDraft(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const err = (k: string) => (errors[k] ? <small className="error">{errors[k]}</small> : null);
  const shown = (rows ?? []).filter((r) => !model || r.model === model);

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <h1>{l("Field Kustom", "Custom Fields")}</h1>
          <button className="primary" onClick={() => void open()}>
            {l("Baru", "New")}
          </button>
        </div>
      </header>
      <p className="muted">
        {l(
          "Tambahkan kolom sendiri ke kontak, produk, karyawan, kendaraan, lead, dan dokumen utama. Field tampil di form, bisa jadi kolom daftar, filter, ekspor/impor Excel, dan PDF pesanan.",
          "Add your own fields to contacts, products, employees, vehicles, leads and main documents. Fields appear on forms and can be list columns, filters, Excel export/import and order PDFs.",
        )}
      </p>
      {rows && (
        <DataTable
          rows={shown}
          storageKey="custom-fields"
          rowKey={(r) => r.id}
          tools={
            <select value={model} onChange={(e) => setModel(e.target.value as CustomFieldModel | "")}>
              <option value="">{l("Semua data", "All records")}</option>
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {modelLabel(m)}
                </option>
              ))}
            </select>
          }
          empty={l("Belum ada field kustom.", "No custom fields yet.")}
          columns={[
            {
              key: "label",
              label: l("Label", "Label"),
              value: (r) => r.label,
              render: (r) => (
                <button type="button" className="link" onClick={() => void open(r)}>
                  {r.label}
                </button>
              ),
            },
            {
              key: "key",
              label: l("Kunci", "Key"),
              value: (r) => r.key,
              render: (r) => <code>{r.key}</code>,
            },
            {
              key: "model",
              label: l("Data", "Record"),
              type: "enum",
              value: (r) => r.model,
              optionLabel: modelLabel,
              text: (r) => modelLabel(r.model),
            },
            {
              key: "type",
              label: l("Tipe", "Type"),
              type: "enum",
              value: (r) => r.fieldType,
              optionLabel: typeLabel,
              text: (r) => typeLabel(r.fieldType),
            },
            { key: "section", label: l("Bagian", "Section"), value: (r) => r.section ?? null },
            {
              key: "flags",
              label: l("Opsi", "Options"),
              value: (r) =>
                [
                  r.required && l("Wajib", "Required"),
                  r.showInList && l("Daftar", "List"),
                  r.showOnPdf && "PDF",
                ]
                  .filter(Boolean)
                  .join(", ") || null,
            },
            {
              key: "active",
              label: l("Status", "Status"),
              type: "enum",
              value: (r) => (r.active ? "active" : "inactive"),
              optionLabel: (v) => (v === "active" ? l("Aktif", "Active") : l("Nonaktif", "Inactive")),
              render: (r) =>
                r.active ? (
                  <span className="badge success">{l("Aktif", "Active")}</span>
                ) : (
                  <span className="badge">{l("Nonaktif", "Inactive")}</span>
                ),
            },
          ]}
        />
      )}

      {draft && (
        <Modal
          open
          wide
          title={draft.id ? draft.label : l("Field kustom baru", "New custom field")}
          onClose={() => setDraft(null)}
          footer={
            <>
              {draft.id && (
                <button type="button" className="danger" onClick={remove} disabled={busy}>
                  {l("Hapus", "Delete")}
                </button>
              )}
              <button type="button" onClick={() => setDraft(null)} disabled={busy}>
                {l("Batal", "Cancel")}
              </button>
              <button type="button" className="primary" onClick={save} disabled={busy} aria-busy={busy}>
                {l("Simpan", "Save")}
              </button>
            </>
          }
        >
          <div className="fields">
            <label className="field" data-field="model">
              <span>{l("Data", "Record")} *</span>
              <select
                value={draft.model}
                disabled={!!draft.id}
                onChange={(e) => set("model", e.target.value as CustomFieldModel)}
              >
                {MODELS.map((m) => (
                  <option key={m} value={m}>
                    {modelLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" data-field="label">
              <span>{l("Label", "Label")} *</span>
              <input
                value={draft.label}
                maxLength={80}
                onChange={(e) => {
                  const label = e.target.value;
                  setDraft((d) => (d ? { ...d, label, key: d.id || keyTouched ? d.key : slug(label) } : d));
                }}
              />
              {err("label")}
            </label>
            <label className="field" data-field="labelEn">
              <span>{l("Label (Inggris)", "Label (English)")}</span>
              <input value={draft.labelEn} maxLength={80} onChange={(e) => set("labelEn", e.target.value)} />
            </label>
            <label className="field" data-field="key">
              <span>{l("Kunci", "Key")} *</span>
              <input
                value={draft.key}
                disabled={!!draft.id}
                maxLength={40}
                onChange={(e) => {
                  setKeyTouched(true);
                  set("key", e.target.value);
                }}
              />
              {err("key") ?? (
                <small className="muted">
                  {l(
                    "Dipakai di ekspor/impor (kolom custom.<kunci>) dan API; tidak bisa diubah.",
                    "Used in export/import (column custom.<key>) and the API; cannot be changed.",
                  )}
                </small>
              )}
            </label>
            <label className="field" data-field="fieldType">
              <span>{l("Tipe", "Type")} *</span>
              <select
                value={draft.fieldType}
                onChange={(e) => {
                  set("fieldType", e.target.value as CustomFieldType);
                  set("defaultValue", "");
                }}
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {typeLabel(t)}
                  </option>
                ))}
              </select>
              {err("fieldType") ??
                (draft.used ? (
                  <small className="muted">
                    {l(
                      "Sudah ada data yang mengisi field ini; tipe tidak bisa diganti.",
                      "Records already have values; the type cannot be changed.",
                    )}
                  </small>
                ) : null)}
            </label>
            {draft.fieldType === "ref" && (
              <label className="field" data-field="refModel">
                <span>{l("Merujuk ke", "Refers to")} *</span>
                <select
                  value={draft.refModel}
                  onChange={(e) => set("refModel", e.target.value as CustomRefModel)}
                >
                  <option value="">—</option>
                  {(Object.keys(CUSTOM_REF_MODELS) as CustomRefModel[]).map((m) => (
                    <option key={m} value={m}>
                      {CUSTOM_REF_MODELS[m][locale === "id" ? 0 : 1]}
                    </option>
                  ))}
                </select>
                {err("refModel")}
              </label>
            )}
            <label className="field" data-field="section">
              <span>{l("Bagian di form", "Form section")}</span>
              <input
                value={draft.section}
                maxLength={60}
                placeholder={l("Informasi tambahan", "Additional information")}
                onChange={(e) => set("section", e.target.value)}
              />
            </label>
            <label className="field" data-field="sequence">
              <span>{l("Urutan", "Sequence")}</span>
              <input
                type="number"
                min={0}
                value={draft.sequence}
                onChange={(e) => set("sequence", e.target.value)}
              />
            </label>
            <label className="field" data-field="help">
              <span>{l("Teks bantuan", "Help text")}</span>
              <input value={draft.help} maxLength={300} onChange={(e) => set("help", e.target.value)} />
            </label>
          </div>

          {(draft.fieldType === "select" || draft.fieldType === "multiselect") && (
            <>
              <h3 className="field-section">{l("Pilihan", "Options")}</h3>
              {err("options")}
              <table className="table compact">
                <thead>
                  <tr>
                    <th>{l("Nilai", "Value")}</th>
                    <th>{l("Label", "Label")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {draft.options.map((o, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          aria-label={l("Nilai", "Value")}
                          value={o.value}
                          maxLength={60}
                          onChange={(e) =>
                            set(
                              "options",
                              draft.options.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={l("Label", "Label")}
                          value={o.label}
                          maxLength={80}
                          onChange={(e) =>
                            set(
                              "options",
                              draft.options.map((x, j) =>
                                j === i
                                  ? { value: x.value || slug(e.target.value), label: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          aria-label={l("Hapus pilihan", "Remove option")}
                          onClick={() =>
                            set(
                              "options",
                              draft.options.filter((_, j) => j !== i),
                            )
                          }
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                onClick={() => set("options", [...draft.options, { value: "", label: "" }])}
              >
                {l("Tambah pilihan", "Add option")}
              </button>
            </>
          )}

          <h3 className="field-section">{l("Perilaku", "Behaviour")}</h3>
          <div className="fields">
            {draft.fieldType !== "ref" && (
              <label
                className={draft.fieldType === "boolean" ? "field check" : "field"}
                data-field="defaultValue"
              >
                <span>{l("Nilai bawaan", "Default value")}</span>
                <CustomFieldInput
                  def={{
                    key: "default",
                    label: draft.label,
                    fieldType: draft.fieldType,
                    options: draft.options,
                  }}
                  value={draft.defaultValue}
                  onChange={(v) => set("defaultValue", v)}
                  invalid={!!errors.defaultValue}
                />
                {err("defaultValue")}
              </label>
            )}
            <label className="field check">
              <span>{l("Wajib diisi di form", "Required on the form")}</span>
              <input
                type="checkbox"
                checked={draft.required}
                onChange={(e) => set("required", e.target.checked)}
              />
            </label>
            <label className="field check">
              <span>{l("Tampil sebagai kolom daftar", "Show as a list column")}</span>
              <input
                type="checkbox"
                checked={draft.showInList}
                onChange={(e) => set("showInList", e.target.checked)}
              />
            </label>
            {PDF_MODELS.includes(draft.model) && (
              <label className="field check">
                <span>{l("Cetak di PDF pesanan", "Print on the order PDF")}</span>
                <input
                  type="checkbox"
                  checked={draft.showOnPdf}
                  onChange={(e) => set("showOnPdf", e.target.checked)}
                />
              </label>
            )}
            <label className="field check">
              <span>{l("Aktif", "Active")}</span>
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => set("active", e.target.checked)}
              />
            </label>
          </div>
          <p className="muted">
            {l(
              "Wajib hanya dipaksa saat data diisi lewat form/impor; dokumen yang dibuat otomatis (mis. faktur dari pesanan) memakai nilai bawaan.",
              "Required is enforced on forms and imports; documents created automatically (e.g. invoices from orders) use the default value.",
            )}
          </p>
        </Modal>
      )}
    </>
  );
}
