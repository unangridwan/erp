"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { openPdf } from "../../../../components/hr/contract-document";
import { errorText } from "../../../../components/hr/hr-panels";
import { useMe } from "../../../../components/me-context";
import { ContractTypeOptions } from "../../../../components/hr/contract-type-options";
import { RefSelect } from "../../../../components/ref-select";
import { api, ApiError } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { useContractTypes } from "../../../../lib/use-contract-types";

interface Template {
  id: string;
  name: string;
  contractType: string | null;
  title: string;
  body: string;
  signerName: string | null;
  signerTitle: string | null;
  city: string | null;
  isDefault: boolean;
  active: boolean;
  contracts: number;
}
interface Placeholder {
  key: string;
  label: string;
  labelEn: string;
}
type Draft = Omit<Template, "id" | "contracts" | "contractType"> & {
  id: string | null;
  contractType: string;
};

const blank: Draft = {
  id: null,
  name: "",
  contractType: "pkwt",
  title: "PERJANJIAN KERJA WAKTU TERTENTU",
  body: "",
  signerName: "",
  signerTitle: "",
  city: "",
  isDefault: false,
  active: true,
};
const toDraft = (t: Template): Draft => ({
  ...t,
  contractType: t.contractType ?? "",
  signerName: t.signerName ?? "",
  signerTitle: t.signerTitle ?? "",
  city: t.city ?? "",
});

/**
 * Template kontrak kerja: isi dengan placeholder `{nama}`, `{gaji}`, … yang diisi otomatis dari data karyawan &
 * kontrak, untuk PDF yang dicetak (tanda tangan basah), e-sign layanan luar, atau ditandatangani di aplikasi.
 */
export default function ContractTemplatesPage() {
  const { l, locale } = useI18n();
  const me = useMe();
  const manage = can(me.permissions, "hr.manage");
  const types = useContractTypes();
  const [items, setItems] = useState<Template[] | null>(null);
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [previewEmployee, setPreviewEmployee] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(
    (select?: string) =>
      api<{ items: Template[] }>("/contract-templates").then(
        (r) => {
          setItems(r.items);
          setDraft((d) => {
            const id = select ?? d?.id;
            const t = r.items.find((x) => x.id === id) ?? (d?.id === null ? null : r.items[0]);
            return t ? toDraft(t) : d;
          });
        },
        (e) => setError(errorText(e)),
      ),
    [],
  );
  useEffect(() => {
    void load();
    api<Placeholder[]>("/contract-templates/placeholders").then(setPlaceholders, () => setPlaceholders([]));
  }, [load]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const insert = (key: string) => {
    const el = editor.current;
    if (!el || !draft) return;
    const token = `{${key}}`;
    const start = el.selectionStart ?? draft.body.length;
    const end = el.selectionEnd ?? start;
    set("body", draft.body.slice(0, start) + token + draft.body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const payload = (d: Draft) => ({
    name: d.name,
    contractType: d.contractType || null,
    title: d.title,
    body: d.body,
    signerName: d.signerName || null,
    signerTitle: d.signerTitle || null,
    city: d.city || null,
    isDefault: d.isDefault,
    active: d.active,
  });
  const run = async (fn: () => Promise<void>, message?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setErrors({});
    try {
      await fn();
      if (message) setNotice(message);
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(
      async () => {
        const d = draft!;
        const row = await api<Template>(d.id ? `/contract-templates/${d.id}` : "/contract-templates", {
          method: d.id ? "PUT" : "POST",
          body: payload(d),
        });
        await load(row.id);
      },
      l("Template disimpan.", "Template saved."),
    );
  const fe = (k: string) => errors[k] && <small className="error">{errors[k]}</small>;

  return (
    <div className="stack-wide">
      <section className="panel">
        <header className="toolbar">
          <h1>{l("Template Kontrak", "Contract Templates")}</h1>
          {manage && (
            <button type="button" onClick={() => setDraft({ ...blank })}>
              {l("Template baru", "New template")}
            </button>
          )}
        </header>
        <p className="muted">
          {l(
            'Isi kontrak memakai placeholder seperti {nama} atau {gaji} yang diisi otomatis dari data karyawan & kontrak. Paragraf dipisah baris kosong; baris "Pasal N" menjadi judul pasal. PDF bisa dicetak untuk tanda tangan basah, dikirim ke layanan e-sign, atau ditandatangani langsung di aplikasi dari halaman kontrak.',
            'Contract text uses placeholders such as {nama} or {gaji}, filled from employee & contract data. Separate paragraphs with a blank line; "Pasal N" lines become article headings. The PDF can be printed for wet signatures, sent to an e-sign service, or signed in the app from the contract page.',
          )}
        </p>
        {error && <p className="error">{error}</p>}
        {notice && <p className="success">{notice}</p>}
      </section>

      {items && (
        <section className="panel template-layout">
          <ul className="template-list" aria-label={l("Daftar template", "Templates")}>
            {items.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={draft?.id === t.id ? "active" : ""}
                  onClick={() => setDraft(toDraft(t))}
                >
                  <strong>{t.name}</strong>
                  <small className="muted">
                    {t.contractType ? types.label(t.contractType) : l("Semua jenis", "All types")}
                    {t.isDefault ? ` · ${l("bawaan", "default")}` : ""}
                    {!t.active ? ` · ${l("nonaktif", "inactive")}` : ""} · {t.contracts}{" "}
                    {l("kontrak", "contracts")}
                  </small>
                </button>
              </li>
            ))}
          </ul>

          {draft && (
            <div>
              <fieldset className="fields" disabled={!manage || busy}>
                <label className="field">
                  <span>{l("Nama template *", "Template name *")}</span>
                  <input value={draft.name} maxLength={200} onChange={(e) => set("name", e.target.value)} />
                  {fe("name")}
                </label>
                <label className="field">
                  <span>{l("Untuk jenis kontrak", "Contract type")}</span>
                  <select value={draft.contractType} onChange={(e) => set("contractType", e.target.value)}>
                    <ContractTypeOptions
                      types={types}
                      current={draft.contractType || null}
                      general={l("Semua jenis (template umum)", "All types (general template)")}
                    />
                  </select>
                  {fe("contractType")}
                </label>
                <label className="field wide">
                  <span>{l("Judul dokumen *", "Document title *")}</span>
                  <input value={draft.title} maxLength={200} onChange={(e) => set("title", e.target.value)} />
                  {fe("title")}
                </label>
                <label className="field">
                  <span>{l("Penandatangan perusahaan", "Company signatory")}</span>
                  <input
                    value={draft.signerName ?? ""}
                    maxLength={200}
                    onChange={(e) => set("signerName", e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>{l("Jabatan penandatangan", "Signatory title")}</span>
                  <input
                    value={draft.signerTitle ?? ""}
                    maxLength={200}
                    onChange={(e) => set("signerTitle", e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>{l("Kota penandatanganan", "Place of signing")}</span>
                  <input
                    value={draft.city ?? ""}
                    maxLength={100}
                    onChange={(e) => set("city", e.target.value)}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.isDefault}
                    onChange={(e) => set("isDefault", e.target.checked)}
                  />
                  <span>{l("Bawaan untuk jenis kontrak ini", "Default for this contract type")}</span>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.active}
                    onChange={(e) => set("active", e.target.checked)}
                  />
                  <span>{l("Aktif", "Active")}</span>
                </label>
              </fieldset>

              {manage && (
                <>
                  <p className="muted small">
                    {l("Klik untuk menyisipkan di posisi kursor:", "Click to insert at the cursor:")}
                  </p>
                  <div className="placeholder-chips">
                    {placeholders.map((p) => (
                      <button key={p.key} type="button" title={`{${p.key}}`} onClick={() => insert(p.key)}>
                        {locale === "en" ? p.labelEn : p.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <label className="field">
                <span>{l("Isi kontrak *", "Contract text *")}</span>
                <textarea
                  ref={editor}
                  className="contract-editor"
                  value={draft.body}
                  readOnly={!manage}
                  maxLength={60000}
                  onChange={(e) => set("body", e.target.value)}
                />
                {fe("body")}
              </label>

              <div className="row-actions">
                {manage && (
                  <button type="button" className="primary" disabled={busy} onClick={save}>
                    {l("Simpan", "Save")}
                  </button>
                )}
                {manage && (
                  <>
                    <span className="muted">{l("Pratinjau dengan data", "Preview with data of")}</span>
                    <span style={{ minWidth: 220 }}>
                      <RefSelect
                        name="previewEmployee"
                        resource="employees"
                        display="name"
                        value={previewEmployee}
                        onChange={setPreviewEmployee}
                      />
                    </span>
                    <button
                      type="button"
                      disabled={busy || !draft.body.trim() || !draft.title.trim()}
                      onClick={() =>
                        run(() =>
                          openPdf("/contract-templates/preview", "pratinjau-kontrak.pdf", {
                            ...payload(draft),
                            employeeId: previewEmployee || null,
                          }),
                        )
                      }
                    >
                      {previewEmployee
                        ? l("Pratinjau PDF", "Preview PDF")
                        : l("Pratinjau PDF (data contoh)", "Preview PDF (sample data)")}
                    </button>
                  </>
                )}
                {manage && draft.id && (
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      confirm(l("Hapus template ini?", "Delete this template?")) &&
                      run(
                        async () => {
                          await api(`/contract-templates/${draft.id}`, { method: "DELETE" });
                          setDraft(null);
                          await load();
                        },
                        l("Template dihapus.", "Template deleted."),
                      )
                    }
                  >
                    {l("Hapus", "Delete")}
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
