"use client";

import { WEB_FORM_FIELD_LABEL, type WebFormField } from "@erp/shared";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { API_URL } from "../../../lib/api";
import { useI18n } from "../../../lib/i18n";

interface Config {
  name: string;
  company: string;
  fields: WebFormField[];
  requiredFields: WebFormField[];
  successMessage: string | null;
}

/** Halaman formulir web-to-lead publik (tanpa login). */
export default function PublicWebFormPage() {
  const { key } = useParams<{ key: string }>();
  const { l } = useI18n();
  const [config, setConfig] = useState<Config | null>(null);
  const [missing, setMissing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/public/web-forms/${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Config>) : Promise.reject(new Error(String(r.status)))))
      .then(setConfig)
      .catch(() => setMissing(true));
  }, [key]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFailure(null);
    try {
      const r = await fetch(`${API_URL}/public/web-forms/${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = (await r.json().catch(() => ({}))) as {
        message?: string;
        errors?: { path: string; message: string }[];
      };
      if (r.ok)
        setDone(
          body.message ??
            l("Terima kasih, data Anda sudah kami terima.", "Thank you, we have received your details."),
        );
      else if (body.errors?.length)
        setErrors(Object.fromEntries(body.errors.map((x) => [x.path, x.message])));
      else
        setFailure(
          r.status === 429
            ? l("Terlalu banyak kiriman. Coba lagi nanti.", "Too many submissions. Please try again later.")
            : l("Gagal mengirim. Coba lagi.", "Could not submit. Please try again."),
        );
    } catch {
      setFailure(l("Gagal mengirim. Coba lagi.", "Could not submit. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="panel">
        {missing ? (
          <>
            <h1>{l("Formulir tidak ditemukan", "Form not found")}</h1>
            <p className="muted">{l("Tautan ini tidak berlaku lagi.", "This link is no longer valid.")}</p>
          </>
        ) : !config ? (
          <p className="muted">{l("Memuat…", "Loading…")}</p>
        ) : done ? (
          <>
            <h1>{l("Terima kasih", "Thank you")}</h1>
            <p>{done}</p>
          </>
        ) : (
          <form onSubmit={submit}>
            <h1>{config.name}</h1>
            {config.company && <p className="muted">{config.company}</p>}
            {config.fields.map((f) => {
              const required = config.requiredFields.includes(f);
              const label = `${l(...WEB_FORM_FIELD_LABEL[f])}${required ? " *" : ""}`;
              return (
                <label key={f} className="field">
                  <span>{label}</span>
                  {f === "description" ? (
                    <textarea
                      rows={4}
                      required={required}
                      value={values[f] ?? ""}
                      onChange={(e) => setValues({ ...values, [f]: e.target.value })}
                    />
                  ) : (
                    <input
                      type={f === "email" ? "email" : f === "phone" ? "tel" : "text"}
                      required={required}
                      value={values[f] ?? ""}
                      onChange={(e) => setValues({ ...values, [f]: e.target.value })}
                    />
                  )}
                  {errors[f] && <small className="error">{errors[f]}</small>}
                </label>
              );
            })}
            {/* Honeypot: tidak terlihat oleh manusia; bot yang mengisinya diabaikan. */}
            <input
              name="website_url"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              style={{ position: "absolute", left: -9999 }}
              value={values.website_url ?? ""}
              onChange={(e) => setValues({ ...values, website_url: e.target.value })}
            />
            {failure && <p className="error">{failure}</p>}
            <button className="primary" disabled={busy}>
              {l("Kirim", "Submit")}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
