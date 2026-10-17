"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { canWrite, type Field, type Resource } from "../lib/resources";
import { Chatter } from "./chatter";
import { useMe } from "./me-context";
import { RefSelect } from "./ref-select";

type Values = Record<string, unknown>;

/**
 * Ubah nilai form (string) ke tipe yang diharapkan API.
 * Field kosong dihilangkan saat membuat (agar default server berlaku) dan dikirim null saat mengubah
 * (mengosongkan nilai) — kecuali select, yang tidak bisa dikosongkan.
 */
function toPayload(fields: Field[], values: Values, isNew: boolean): Values {
  const entries: [string, unknown][] = [];
  for (const f of fields) {
    const v = values[f.name];
    if (f.type === "boolean") entries.push([f.name, Boolean(v)]);
    else if (v === "" || v === undefined || v === null) {
      if (!isNew && f.type !== "select") entries.push([f.name, null]);
    } else entries.push([f.name, f.type === "number" ? Number(v) : v]);
  }
  return Object.fromEntries(entries);
}

export function FormView({ resource, id }: { resource: Resource; id: string }) {
  const me = useMe();
  const router = useRouter();
  const isNew = id === "new";
  const editable = canWrite(me.permissions, resource);
  const [values, setValues] = useState<Values>({});
  const [loaded, setLoaded] = useState(isNew);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (isNew) return;
    api<Values>(`/${resource.path}/${id}`)
      .then((row) => {
        setValues(row);
        setLoaded(true);
      })
      .catch((e: Error) => setError(e.message));
  }, [resource.path, id, isNew]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const body = toPayload(resource.fields, values, isNew);
      if (isNew) {
        const created = await api<{ id: string }>(`/${resource.path}`, { method: "POST", body });
        router.replace(`/${resource.path}/${created.id}`);
      } else {
        setValues(await api<Values>(`/${resource.path}/${id}`, { method: "PATCH", body }));
        setVersion((v) => v + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!confirm(`Hapus ${resource.singular.toLowerCase()} ini?`)) return;
    try {
      await api(`/${resource.path}/${id}`, { method: "DELETE" });
      router.replace(`/${resource.path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus");
    }
  }

  if (!loaded) return <p className="muted">{error ?? "Memuat…"}</p>;

  const set = (name: string, value: unknown) => setValues((v) => ({ ...v, [name]: value }));

  return (
    <div className="form-layout">
      <form className="panel" onSubmit={onSubmit}>
        <header className="toolbar">
          <h1>
            {isNew ? `${resource.singular} baru` : String(values.name ?? values.code ?? resource.singular)}
          </h1>
          {editable && (
            <button className="primary" disabled={saving}>
              {saving ? "Menyimpan…" : "Simpan"}
            </button>
          )}
          {editable && !isNew && (
            <button type="button" className="danger" onClick={onDelete}>
              Hapus
            </button>
          )}
        </header>
        {error && <p className="error">{error}</p>}
        <fieldset disabled={!editable} className="fields">
          {resource.fields.map((f) => (
            <label key={f.name} className={f.type === "boolean" ? "field check" : "field"}>
              <span>
                {f.label}
                {"required" in f && f.required ? " *" : ""}
              </span>
              <FieldInput field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />
              {fieldErrors[f.name] && <small className="error">{fieldErrors[f.name]}</small>}
            </label>
          ))}
        </fieldset>
      </form>
      {!isNew && (
        <Chatter
          model={resource.model}
          id={id}
          version={version}
          labels={Object.fromEntries(resource.fields.map((f) => [f.name, f.label]))}
        />
      )}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const str = value === null || value === undefined ? "" : String(value);
  switch (field.type) {
    case "boolean":
      return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    case "select":
      return (
        <select value={str} required={field.required} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {field.options.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
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
          type={field.type}
          step={field.type === "number" ? "any" : undefined}
          value={str}
          required={field.required}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
