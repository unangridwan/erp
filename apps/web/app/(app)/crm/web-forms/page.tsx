"use client";

import { LEAD_SOURCE_VALUES, WEB_FORM_FIELD_LABEL, WEB_FORM_FIELDS, type WebFormField } from "@erp/shared";
import { useEffect, useState } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { ask, toast } from "../../../../components/feedback";
import { useMe } from "../../../../components/me-context";
import { api, ApiError, API_URL } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can, LEAD_SOURCES } from "../../../../lib/resources";

interface Form {
  id: string;
  name: string;
  campaignId: string | null;
  campaignName: string | null;
  source: string;
  fields: WebFormField[];
  requiredFields: WebFormField[];
  successMessage: string | null;
  redirectUrl: string | null;
  active: boolean;
  submissionCount: number;
  lastSubmittedAt: string | null;
}
interface Draft {
  id: string | null;
  name: string;
  campaignId: string;
  source: string;
  fields: WebFormField[];
  requiredFields: WebFormField[];
  successMessage: string;
  redirectUrl: string;
  active: boolean;
}
const emptyDraft: Draft = {
  id: null,
  name: "",
  campaignId: "",
  source: "website",
  fields: ["contactName", "partnerName", "email", "phone", "description"],
  requiredFields: ["contactName", "email"],
  successMessage: "",
  redirectUrl: "",
  active: true,
};

/** Cuplikan HTML siap tempel di situs mana pun (form biasa, tanpa JavaScript). */
function snippet(key: string, fields: WebFormField[], required: WebFormField[]) {
  const input = (f: WebFormField) => {
    const req = required.includes(f) ? " required" : "";
    const label = WEB_FORM_FIELD_LABEL[f][0];
    const control =
      f === "description"
        ? `<textarea name="${f}"${req}></textarea>`
        : `<input name="${f}" type="${f === "email" ? "email" : "text"}"${req}>`;
    return `  <label>${label}<br>${control}</label><br>`;
  };
  return [
    `<form method="post" action="${API_URL}/public/web-forms/${key}">`,
    ...fields.map(input),
    `  <input name="website_url" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">`,
    `  <button type="submit">Kirim</button>`,
    `</form>`,
  ].join("\n");
}

/** Formulir web-to-lead: konfigurasi field, kampanye, kunci publik, dan cuplikan HTML. */
export default function WebFormsPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const editable = can(me.permissions, "crm.manage");
  const campaigns = useOptions<{ id: string; name: string }>("/crm/campaigns");
  const [items, setItems] = useState<Form[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [shown, setShown] = useState<{ id: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api<{ items: Form[] }>("/crm/web-forms")
      .then((d) => setItems(d.items))
      .catch((e: Error) => setError(e.message));
  }, [version]);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(
        e instanceof ApiError && Object.keys(e.fieldErrors).length
          ? Object.values(e.fieldErrors).join("; ")
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  }

  const save = () =>
    run(async () => {
      if (!draft) return;
      const body = {
        name: draft.name,
        campaignId: draft.campaignId || null,
        source: draft.source,
        fields: draft.fields,
        requiredFields: draft.requiredFields.filter((f) => draft.fields.includes(f)),
        successMessage: draft.successMessage || null,
        redirectUrl: draft.redirectUrl || null,
        active: draft.active,
      };
      if (draft.id) await api(`/crm/web-forms/${draft.id}`, { method: "PATCH", body });
      else {
        const created = await api<{ id: string; key: string }>("/crm/web-forms", { method: "POST", body });
        setShown({ id: created.id, key: created.key });
      }
      toast.success(l("Formulir tersimpan", "Form saved"));
      setDraft(null);
    });

  const toggle = (list: WebFormField[], f: WebFormField, on: boolean) =>
    on ? WEB_FORM_FIELDS.filter((x) => list.includes(x) || x === f) : list.filter((x) => x !== f);
  const publicUrl = (key: string) =>
    `${typeof window === "undefined" ? "" : window.location.origin}/f/${key}`;

  return (
    <>
      <header className="toolbar">
        <h1>{l("Formulir Web", "Web Forms")}</h1>
        {editable && (
          <button className="primary" onClick={() => setDraft(emptyDraft)}>
            {l("Baru", "New")}
          </button>
        )}
      </header>
      <p className="muted">
        {l(
          "Kiriman formulir menjadi lead baru (sumber, kampanye, wilayah, skor, dan penanggung jawab terisi otomatis). Email yang sama dengan lead terbuka tidak membuat lead ganda.",
          "Submissions become new leads (source, campaign, territory, score and owner filled automatically). An email matching an open lead does not create a duplicate.",
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {shown && (
        <section className="panel">
          <h2>
            {l(
              "Kunci formulir (simpan sekarang, hanya ditampilkan sekali)",
              "Form key (save it now, shown only once)",
            )}
          </h2>
          <p>
            {l("Halaman formulir siap pakai", "Hosted form page")}:{" "}
            <a href={publicUrl(shown.key)} target="_blank" rel="noreferrer">
              {publicUrl(shown.key)}
            </a>
          </p>
          <label className="field">
            <span>{l("Cuplikan HTML untuk situs Anda", "HTML snippet for your website")}</span>
            <textarea
              readOnly
              rows={10}
              value={snippet(
                shown.key,
                items.find((f) => f.id === shown.id)?.fields ?? emptyDraft.fields,
                items.find((f) => f.id === shown.id)?.requiredFields ?? emptyDraft.requiredFields,
              )}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button className="link" onClick={() => setShown(null)}>
            {l("Tutup", "Close")}
          </button>
        </section>
      )}

      {draft && (
        <section className="panel">
          <h2>{draft.id ? l("Ubah formulir", "Edit form") : l("Formulir baru", "New form")}</h2>
          <div className="fields">
            <label className="field">
              <span>{l("Nama *", "Name *")}</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="field">
              <span>{l("Kampanye", "Campaign")}</span>
              <select
                value={draft.campaignId}
                onChange={(e) => setDraft({ ...draft, campaignId: e.target.value })}
              >
                <option value="">—</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Sumber lead", "Lead source")}</span>
              <select value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })}>
                {LEAD_SOURCE_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {LEAD_SOURCES.find(([s]) => s === v)?.[1][locale] ?? v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Pesan sukses", "Success message")}</span>
              <input
                value={draft.successMessage}
                onChange={(e) => setDraft({ ...draft, successMessage: e.target.value })}
              />
            </label>
            <label className="field">
              <span>
                {l("Alihkan ke URL setelah kirim (opsional)", "Redirect URL after submit (optional)")}
              </span>
              <input
                value={draft.redirectUrl}
                placeholder="https://"
                onChange={(e) => setDraft({ ...draft, redirectUrl: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("Aktif", "Active")}</span>
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              />
            </label>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{l("Field", "Field")}</th>
                  <th>{l("Tampilkan", "Show")}</th>
                  <th>{l("Wajib", "Required")}</th>
                </tr>
              </thead>
              <tbody>
                {WEB_FORM_FIELDS.map((f) => (
                  <tr key={f}>
                    <td>{l(...WEB_FORM_FIELD_LABEL[f])}</td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${l(...WEB_FORM_FIELD_LABEL[f])} ${l("tampil", "shown")}`}
                        checked={draft.fields.includes(f)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            fields: toggle(draft.fields, f, e.target.checked),
                            requiredFields: e.target.checked
                              ? draft.requiredFields
                              : draft.requiredFields.filter((x) => x !== f),
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${l(...WEB_FORM_FIELD_LABEL[f])} ${l("wajib", "required")}`}
                        disabled={!draft.fields.includes(f)}
                        checked={draft.requiredFields.includes(f)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            requiredFields: toggle(draft.requiredFields, f, e.target.checked),
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="filters">
            <button className="primary" disabled={!draft.name.trim()} onClick={save}>
              {l("Simpan", "Save")}
            </button>
            <button className="link" onClick={() => setDraft(null)}>
              {l("Batal", "Cancel")}
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        {items.length === 0 ? (
          <p className="muted">{l("Belum ada formulir.", "No forms yet.")}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{l("Formulir", "Form")}</th>
                  <th>{l("Kampanye", "Campaign")}</th>
                  <th>{l("Field", "Fields")}</th>
                  <th className="num">{l("Kiriman", "Submissions")}</th>
                  <th>{l("Terakhir", "Last")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((f) => (
                  <tr key={f.id}>
                    <td>
                      {f.name}
                      {!f.active && <span className="badge state-cancel">{l("Nonaktif", "Inactive")}</span>}
                    </td>
                    <td>{f.campaignName ?? "—"}</td>
                    <td>{f.fields.map((x) => l(...WEB_FORM_FIELD_LABEL[x])).join(", ")}</td>
                    <td className="num">{f.submissionCount}</td>
                    <td>{f.lastSubmittedAt ? formatDate(f.lastSubmittedAt, locale) : "—"}</td>
                    <td>
                      {editable && (
                        <>
                          <button
                            className="link"
                            onClick={() =>
                              setDraft({
                                id: f.id,
                                name: f.name,
                                campaignId: f.campaignId ?? "",
                                source: f.source,
                                fields: f.fields,
                                requiredFields: f.requiredFields,
                                successMessage: f.successMessage ?? "",
                                redirectUrl: f.redirectUrl ?? "",
                                active: f.active,
                              })
                            }
                          >
                            {l("Ubah", "Edit")}
                          </button>{" "}
                          <button
                            className="link"
                            onClick={() =>
                              run(async () => {
                                if (
                                  !(await ask(
                                    l(
                                      "Buat kunci baru? Kunci lama (halaman & cuplikan yang sudah dipasang) langsung tidak berlaku.",
                                      "Create a new key? The old key (installed page & snippet) stops working immediately.",
                                    ),
                                  ))
                                )
                                  return;
                                const r = await api<{ id: string; key: string }>(
                                  `/crm/web-forms/${f.id}/rotate-key`,
                                  {
                                    method: "POST",
                                    body: {},
                                  },
                                );
                                setShown(r);
                              })
                            }
                          >
                            {l("Kunci baru", "New key")}
                          </button>{" "}
                          <button
                            className="link"
                            onClick={() =>
                              run(async () => {
                                if (
                                  !(await ask(l(`Hapus formulir "${f.name}"?`, `Delete form "${f.name}"?`)))
                                )
                                  return;
                                await api(`/crm/web-forms/${f.id}`, { method: "DELETE" });
                              })
                            }
                          >
                            {l("Hapus", "Delete")}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
