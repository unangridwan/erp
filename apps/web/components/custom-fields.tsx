"use client";

import {
  CUSTOM_FIELD_MODELS,
  customFieldLabel,
  formatCustomValue,
  type CustomFieldDef,
  type CustomFieldModel,
  type CustomRefModel,
} from "@erp/shared";
import { useEffect, useState } from "react";
import { api, ApiError, onSessionReset } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { can } from "../lib/resources";
import { toast } from "./feedback";
import { useMe } from "./me-context";
import { RefSelect } from "./ref-select";

export type CustomDef = CustomFieldDef & { id: string; model: CustomFieldModel };
export type CustomValues = Record<string, unknown>;

const cache = new Map<string, Promise<CustomDef[]>>();

/** Hapus cache definisi (setelah admin mengubah field kustom). */
export const resetCustomFieldCache = () => cache.clear();
// Sesi berganti (logout/login user lain di tab yang sama): definisi tenant sebelumnya tidak boleh terbawa.
onSessionReset(resetCustomFieldCache);

/** Definisi field kustom aktif untuk satu model (di-cache per halaman). */
export function useCustomFields(model: CustomFieldModel | undefined) {
  const [defs, setDefs] = useState<CustomDef[]>([]);
  useEffect(() => {
    if (!model) return;
    let p = cache.get(model);
    if (!p) {
      p = api<CustomDef[]>(`/custom-fields?model=${model}`).catch(() => []);
      cache.set(model, p);
    }
    let alive = true;
    void p.then((d) => alive && setDefs(d));
    return () => {
      alive = false;
    };
  }, [model]);
  return defs;
}

const REF_SOURCES: Record<CustomRefModel, { resource: string; display: string }> = {
  partner: { resource: "partners", display: "name" },
  product: { resource: "products", display: "name" },
  employee: { resource: "employees", display: "name" },
  user: { resource: "users/options", display: "name" },
};

/** Kolom daftar untuk field kustom bertanda "tampil di daftar". */
export function useCustomColumns(model: CustomFieldModel) {
  const { locale: lang } = useI18n();
  const defs = useCustomFields(model).filter((d) => d.showInList);
  return defs.map((d) => ({
    key: `custom.${d.key}`,
    label: customFieldLabel(d, lang),
    def: d,
    text: (row: { custom?: unknown }) =>
      formatCustomValue(d, (row.custom as CustomValues | undefined)?.[d.key], { lang }),
  }));
}

/** Input satu field kustom. */
export function CustomFieldInput({
  def,
  value,
  onChange,
  disabled,
  invalid,
}: {
  def: CustomFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const aria = invalid ? { "aria-invalid": true as const } : {};
  const str = value === null || value === undefined ? "" : String(value);
  const name = `custom.${def.key}`;
  switch (def.fieldType) {
    case "boolean":
      return (
        <input
          name={name}
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "textarea":
      return (
        <textarea
          name={name}
          rows={3}
          value={str}
          disabled={disabled}
          {...aria}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "select":
      return (
        <select
          name={name}
          value={str}
          disabled={disabled}
          {...aria}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {(def.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "multiselect": {
      const picked = Array.isArray(value) ? (value as string[]) : [];
      return (
        <span className="check-list" data-field={name}>
          {(def.options ?? []).map((o) => (
            <label key={o.value} className="check">
              <input
                type="checkbox"
                disabled={disabled}
                checked={picked.includes(o.value)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...picked, o.value] : picked.filter((p) => p !== o.value))
                }
              />
              {o.label}
            </label>
          ))}
        </span>
      );
    }
    case "ref": {
      const src = REF_SOURCES[def.refModel ?? "partner"];
      return (
        <RefSelect
          name={name}
          resource={src.resource}
          display={src.display}
          value={str}
          disabled={disabled}
          onChange={onChange}
        />
      );
    }
    default:
      return (
        <input
          name={name}
          type={
            def.fieldType === "number" || def.fieldType === "money"
              ? "number"
              : def.fieldType === "text"
                ? "text"
                : def.fieldType
          }
          step={def.fieldType === "money" ? "0.01" : def.fieldType === "number" ? "any" : undefined}
          value={str}
          disabled={disabled}
          {...aria}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** Kirim nilai ke API: angka sebagai number, kosong sebagai null. */
export function customPayload(defs: CustomFieldDef[], values: CustomValues): CustomValues {
  return Object.fromEntries(
    defs.map((d) => {
      const v = values[d.key];
      if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) return [d.key, null];
      if ((d.fieldType === "number" || d.fieldType === "money") && typeof v === "string")
        return [d.key, Number(v)];
      return [d.key, v];
    }),
  );
}

/**
 * Bagian "Informasi tambahan" di form. Terkendali (`value`/`onChange`) saat form bisa diubah; bila dokumen sudah
 * terkunci tetapi pengguna punya hak tulis model, tampil tombol simpan sendiri (PATCH /custom-values).
 */
export function CustomFieldsSection({
  model,
  value,
  onChange,
  editable,
  recordId,
  errors,
  onSaved,
  bare,
}: {
  model: CustomFieldModel;
  value: CustomValues;
  onChange?: (v: CustomValues) => void;
  editable: boolean;
  recordId?: string;
  errors?: Record<string, string>;
  onSaved?: (v: CustomValues) => void;
  /** Tanpa panel pembungkus (disisipkan di dalam form yang sudah punya panel). */
  bare?: boolean;
}) {
  const { l, locale: lang } = useI18n();
  const me = useMe();
  const defs = useCustomFields(model);
  const [local, setLocal] = useState<CustomValues>(value);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setLocal(value), [value]);
  if (!defs.length) return null;

  const standalone = !editable && !!recordId && can(me.permissions, CUSTOM_FIELD_MODELS[model].write);
  const current = editable ? value : local;
  const dirty =
    standalone && JSON.stringify(customPayload(defs, local)) !== JSON.stringify(customPayload(defs, value));
  const errs = { ...(errors ?? {}), ...localErrors };
  const set = (key: string, v: unknown) => {
    const next = { ...current, [key]: v };
    if (editable) onChange?.(next);
    else setLocal(next);
    if (errs[`custom.${key}`]) setLocalErrors(({ [`custom.${key}`]: _, ...rest }) => rest);
  };

  async function saveLocked() {
    setBusy(true);
    setLocalErrors({});
    try {
      const res = await api<{ custom: CustomValues }>(`/custom-values/${model}/${recordId}`, {
        method: "PATCH",
        body: { custom: customPayload(defs, local) },
      });
      toast.success(l("Informasi tambahan disimpan.", "Additional information saved."));
      onSaved?.(res.custom);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setLocalErrors(e.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  const sections = [...new Set(defs.map((d) => d.section || ""))];
  const body = (
    <>
      <div className="fields custom-fields-grid">
        {sections.flatMap((section) => [
          <h3 key={`section-${section || "_"}`} className="field-section">
            {section || l("Informasi tambahan", "Additional information")}
          </h3>,
          ...defs
            .filter((d) => (d.section || "") === section)
            .map((d) => {
              const err = errs[`custom.${d.key}`];
              return (
                <label
                  key={d.key}
                  data-field={`custom.${d.key}`}
                  className={d.fieldType === "boolean" ? "field check" : "field"}
                >
                  <span>
                    {customFieldLabel(d, lang)}
                    {d.required ? " *" : ""}
                  </span>
                  {editable || standalone ? (
                    <CustomFieldInput
                      def={d}
                      value={current[d.key]}
                      onChange={(v) => set(d.key, v)}
                      invalid={!!err}
                    />
                  ) : (
                    <span className="value">{formatCustomValue(d, current[d.key], { lang }) || "—"}</span>
                  )}
                  {err ? (
                    <small className="error">{err}</small>
                  ) : d.help ? (
                    <small className="muted">{d.help}</small>
                  ) : null}
                </label>
              );
            }),
        ])}
      </div>
      {standalone && dirty && (
        <div className="actions">
          <button type="button" className="primary" disabled={busy} aria-busy={busy} onClick={saveLocked}>
            {l("Simpan informasi tambahan", "Save additional information")}
          </button>
          <button type="button" disabled={busy} onClick={() => setLocal(value)}>
            {l("Buang", "Discard")}
          </button>
        </div>
      )}
    </>
  );
  return bare ? body : <section className="panel custom-fields">{body}</section>;
}
