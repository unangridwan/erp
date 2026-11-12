"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { canDelete, canWrite, type Field, type Resource } from "../lib/resources";
import { Chatter } from "./chatter";
import { FavoriteStar } from "./favorite-star";
import { FormExtras } from "./form-extras";
import { useMe } from "./me-context";
import { RefSelect } from "./ref-select";
import { ask, Skeleton, toast } from "./feedback";
import { focusFirstError, useDirtyGuard, useSaveShortcut } from "../lib/use-form-guard";
import { rememberRecent } from "../lib/recent";

type Values = Record<string, unknown>;

/**
 * Ubah nilai form (string) ke tipe yang diharapkan API.
 * Field kosong dihilangkan saat membuat (agar default server berlaku) dan dikirim null saat mengubah
 * (mengosongkan nilai) — kecuali select, yang tidak bisa dikosongkan.
 */
export function toPayload(fields: Field[], values: Values, isNew: boolean): Values {
  const entries: [string, unknown][] = [];
  for (const f of fields) {
    const v = values[f.name];
    if (f.type === "boolean") {
      // Belum disentuh pada data baru: biarkan default server (mis. aktif = ya).
      if (!(isNew && v === undefined)) entries.push([f.name, Boolean(v)]);
    } else if (v === "" || v === undefined || v === null) {
      if (!isNew && (f.type !== "select" || f.nullable)) entries.push([f.name, null]);
    } else entries.push([f.name, f.type === "number" ? Number(v) : v]);
  }
  return Object.fromEntries(entries);
}

export function FormView({ resource, id }: { resource: Resource; id: string }) {
  const me = useMe();
  const { t, tx, l } = useI18n();
  const router = useRouter();
  const isNew = id === "new";
  const editable = canWrite(me.permissions, resource);
  // Data baru: "Aktif" dicentang sesuai default server.
  const [values, setValues] = useState<Values>(() =>
    isNew && resource.fields.some((f) => f.name === "active") ? { active: true } : {},
  );
  const [loaded, setLoaded] = useState(isNew);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  /** Nilai terakhir yang tersimpan (untuk deteksi perubahan & tombol Buang). */
  const [saved, setSaved] = useState<Values>(values);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = useMemo(
    () => editable && resource.fields.some((f) => !same(values[f.name], saved[f.name])),
    [editable, resource.fields, values, saved],
  );
  useDirtyGuard(dirty && !saving);
  useSaveShortcut(() => formRef.current?.requestSubmit(), editable);

  useEffect(() => {
    if (isNew) return;
    api<Values>(`/${resource.path}/${id}`)
      .then((row) => {
        setValues(row);
        setSaved(row);
        setLoaded(true);
      })
      .catch((e: Error) => setError(e.message));
  }, [resource.path, id, isNew]);

  // Catat sebagai "terakhir dibuka" (beranda & Ctrl+K).
  const recordName = isNew
    ? `${tx(resource.singular)} ${t("form.new")}`
    : String(values.name ?? values.code ?? values.licensePlate ?? values.reference ?? tx(resource.singular));
  useEffect(() => {
    if (!isNew && loaded)
      rememberRecent({ href: `/${resource.path}/${id}`, title: recordName, kind: tx(resource.singular) });
  }, [isNew, loaded, resource.path, id, recordName, resource.singular, tx]);

  const missing = (f: Field) =>
    "required" in f &&
    f.required &&
    (values[f.name] === undefined || values[f.name] === null || values[f.name] === "");
  const clientErrors = Object.fromEntries(
    resource.fields.filter(missing).map((f) => [f.name, l("Wajib diisi", "Required")]),
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (Object.keys(clientErrors).length) {
      setTouched(Object.fromEntries(Object.keys(clientErrors).map((k) => [k, true])));
      toast.error(l("Lengkapi field yang wajib diisi.", "Please fill in the required fields."));
      requestAnimationFrame(() => focusFirstError(formRef.current, Object.keys(clientErrors)));
      return;
    }
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const body = toPayload(resource.fields, values, isNew);
      if (isNew) {
        const created = await api<{ id: string }>(`/${resource.path}`, { method: "POST", body });
        setSaved(values);
        toast.success(l(`${tx(resource.singular)} dibuat.`, `${tx(resource.singular)} created.`));
        router.replace(`/${resource.path}/${created.id}`);
      } else {
        const row = await api<Values>(`/${resource.path}/${id}`, { method: "PATCH", body });
        setValues(row);
        setSaved(row);
        setVersion((v) => v + 1);
        toast.success(l("Perubahan disimpan.", "Changes saved."));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors);
        requestAnimationFrame(() => focusFirstError(formRef.current, Object.keys(err.fieldErrors)));
      }
    } finally {
      setSaving(false);
    }
  }

  async function onDiscard() {
    if (!(await ask({ message: l("Buang semua perubahan?", "Discard all changes?"), danger: true }))) return;
    setValues(saved);
    setFieldErrors({});
    setTouched({});
    setError(null);
  }

  async function onDelete() {
    if (!(await ask(t("form.confirmDelete")))) return;
    try {
      await api(`/${resource.path}/${id}`, { method: "DELETE" });
      setSaved(values);
      toast.success(l(`${recordName} dihapus.`, `${recordName} deleted.`));
      router.replace(`/${resource.path}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    }
  }

  if (!loaded) return error ? <p className="error">{error}</p> : <Skeleton form rows={6} />;

  const set = (name: string, value: unknown) => setValues((v) => ({ ...v, [name]: value }));

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <nav className="breadcrumb">
            <Link href={`/${resource.path}`}>{tx(resource.title)}</Link>
            <span>/</span>
            <h1>{recordName}</h1>
            {!isNew && (
              <FavoriteStar
                href={`/${resource.path}/${id}`}
                title={recordName}
                kind={tx(resource.singular)}
              />
            )}
          </nav>
          {editable && (
            <button
              className="primary"
              form="record-form"
              disabled={saving || (!isNew && !dirty)}
              aria-busy={saving}
              title={l("Simpan (Ctrl+S)", "Save (Ctrl+S)")}
            >
              {saving ? t("form.saving") : t("form.save")}
            </button>
          )}
          {editable && dirty && !saving && (
            <>
              <button type="button" onClick={onDiscard}>
                {l("Buang", "Discard")}
              </button>
              <span className="dirty-dot" role="status">
                {l("Belum disimpan", "Unsaved changes")}
              </span>
            </>
          )}
          {editable && !isNew && !resource.noDelete && canDelete(me.permissions, resource) && (
            <button type="button" className="danger" onClick={onDelete}>
              {t("form.delete")}
            </button>
          )}
        </div>
      </header>
      <div className="form-layout">
        <div className="stack-wide">
          <form id="record-form" ref={formRef} className="panel" onSubmit={onSubmit} noValidate>
            {error && <p className="error">{error}</p>}
            <fieldset disabled={!editable} className="fields">
              {resource.fields.map((f) => [
                f.section && (
                  <h3 key={`section-${f.name}`} className="field-section">
                    {tx(f.section)}
                  </h3>
                ),
                <label
                  key={f.name}
                  data-field={f.name}
                  className={f.type === "boolean" ? "field check" : "field"}
                  onBlur={() => setTouched((t) => (t[f.name] ? t : { ...t, [f.name]: true }))}
                >
                  <span>
                    {tx(f.label)}
                    {"required" in f && f.required ? " *" : ""}
                  </span>
                  <FieldInput
                    field={f}
                    value={values[f.name]}
                    onChange={(v) => {
                      set(f.name, v);
                      if (fieldErrors[f.name]) setFieldErrors(({ [f.name]: _, ...rest }) => rest);
                    }}
                    invalid={Boolean(fieldErrors[f.name] || (touched[f.name] && clientErrors[f.name]))}
                  />
                  {fieldErrors[f.name] ? (
                    <small className="error">{fieldErrors[f.name]}</small>
                  ) : touched[f.name] && clientErrors[f.name] ? (
                    <small className="error">{clientErrors[f.name]}</small>
                  ) : f.help ? (
                    <small className="muted">{tx(f.help)}</small>
                  ) : null}
                </label>,
              ])}
            </fieldset>
          </form>
          {!isNew && <FormExtras path={resource.path} id={id} />}
        </div>
        {!isNew && (
          <Chatter
            model={resource.model}
            id={id}
            version={version}
            labels={Object.fromEntries(resource.fields.map((f) => [f.name, tx(f.label)]))}
          />
        )}
      </div>
    </>
  );
}

/** Nilai sama (abaikan beda "" / null / undefined dan angka vs teks). */
function same(a: unknown, b: unknown) {
  const norm = (v: unknown) => (v === undefined || v === null || v === "" ? "" : String(v));
  return norm(a) === norm(b);
}

export function FieldInput({
  field,
  value,
  onChange,
  invalid,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  invalid?: boolean;
}) {
  const { tx } = useI18n();
  const aria = invalid ? { "aria-invalid": true as const } : {};
  const placeholder = field.placeholder ? tx(field.placeholder) : undefined;
  const str = value === null || value === undefined ? "" : String(value);
  switch (field.type) {
    case "boolean":
      return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    case "select":
      return (
        <select
          name={field.name}
          value={str}
          required={field.required}
          {...aria}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {field.options.map(([v, label]) => (
            <option key={v} value={v}>
              {tx(label)}
            </option>
          ))}
        </select>
      );
    case "ref":
      return (
        <RefSelect
          name={field.name}
          resource={field.resource}
          display={field.display}
          valueKey={field.valueKey}
          value={str}
          required={field.required}
          onChange={onChange}
        />
      );
    default:
      return (
        <input
          name={field.name}
          type={field.type}
          step={field.type === "number" ? "any" : undefined}
          value={str}
          required={field.required}
          placeholder={placeholder}
          {...aria}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
