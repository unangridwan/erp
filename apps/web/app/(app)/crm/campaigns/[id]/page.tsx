"use client";

import {
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_VALUES,
  CAMPAIGN_TYPE_LABEL,
  CAMPAIGN_TYPE_VALUES,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_VALUES,
  MEMBER_STATUS_LABEL,
} from "@erp/shared";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useOptions } from "../../../../../components/accounting/use-options";
import { ask, toast } from "../../../../../components/feedback";
import { useMe } from "../../../../../components/me-context";
import { api, ApiError } from "../../../../../lib/api";
import { formatDate, money } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can, LEAD_SOURCES } from "../../../../../lib/resources";

interface Member {
  id: string;
  kind: "lead" | "partner";
  leadId: string | null;
  partnerId: string | null;
  name: string | null;
  company: string | null;
  email: string | null;
  doNotContact: boolean;
  status: string;
  sentAt: string | null;
  error: string | null;
}
interface Detail {
  id: string;
  name: string;
  campaignType: string;
  status: string;
  dateStart: string | null;
  dateEnd: string | null;
  budget: string;
  actualCost: string;
  expectedRevenue: string;
  description: string | null;
  members: number;
  sent: number;
  responded: number;
  unsubscribed: number;
  leads: number;
  opportunities: number;
  won: number;
  wonAmount: string;
  pipeline: string;
  roi: number | null;
  costPerLead: string | null;
  memberList: Member[];
  emails: {
    id: string;
    subject: string;
    sentCount: number;
    failedCount: number;
    skippedCount: number;
    sentAt: string;
    userName: string | null;
  }[];
}
type Values = Record<
  "name" | "campaignType" | "status" | "dateStart" | "dateEnd" | "budget" | "actualCost" | "description",
  string
>;

const toValues = (d: Detail): Values => ({
  name: d.name,
  campaignType: d.campaignType,
  status: d.status,
  dateStart: d.dateStart ?? "",
  dateEnd: d.dateEnd ?? "",
  budget: String(Number(d.budget)),
  actualCost: String(Number(d.actualCost)),
  description: d.description ?? "",
});

/** Detail kampanye: data, hasil & ROI, anggota (tambah dari lead/segmen), dan email massal. */
export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const me = useMe();
  const { l, locale } = useI18n();
  const editable = can(me.permissions, "crm.write");
  const [data, setData] = useState<Detail | null>(null);
  const [values, setValues] = useState<Values | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [segment, setSegment] = useState({ source: "", leadStatus: "", minScore: "" });
  const [email, setEmail] = useState<{ subject: string; body: string; onlyStatus: string } | null>(null);
  const territories = useOptions<{ id: string; name: string }>("/crm/territories");
  const [territoryId, setTerritoryId] = useState("");

  useEffect(() => {
    api<Detail>(`/crm/campaign-stats/${id}`)
      .then((d) => {
        setData(d);
        setValues(toValues(d));
      })
      .catch((e: Error) => setError(e.message));
  }, [id, version]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  }

  if (!data || !values)
    return <p className={error ? "error" : "muted"}>{error ?? l("Memuat…", "Loading…")}</p>;
  const set = (patch: Partial<Values>) => setValues({ ...values, ...patch });
  const save = () =>
    run(async () => {
      await api(`/crm/campaigns/${id}`, {
        method: "PATCH",
        body: {
          ...values,
          dateStart: values.dateStart || null,
          dateEnd: values.dateEnd || null,
          budget: values.budget || "0",
          actualCost: values.actualCost || "0",
          description: values.description || null,
        },
      });
      toast.success(l("Kampanye tersimpan", "Campaign saved"));
    });
  const addSegment = () =>
    run(async () => {
      const r = await api<{ added: number; skipped: number }>(`/crm/campaigns/${id}/members`, {
        method: "POST",
        body: {
          segment: {
            source: segment.source || null,
            leadStatus: segment.leadStatus || null,
            territoryId: territoryId || null,
            minScore: segment.minScore ? Number(segment.minScore) : null,
          },
        },
      });
      toast.success(
        l(
          `${r.added} anggota ditambahkan (${r.skipped} sudah ada)`,
          `${r.added} members added (${r.skipped} already in)`,
        ),
      );
    });
  const sendEmail = () =>
    run(async () => {
      if (!email) return;
      if (
        !(await ask(
          l("Kirim email ke anggota kampanye sekarang?", "Send the email to campaign members now?"),
        ))
      )
        return;
      const r = await api<{ sentCount: number; failedCount: number; skippedCount: number }>(
        `/crm/campaigns/${id}/emails`,
        { method: "POST", body: { ...email, onlyStatus: email.onlyStatus || null } },
      );
      toast.success(
        l(
          `Terkirim ${r.sentCount}, gagal ${r.failedCount}, dilewati ${r.skippedCount}`,
          `Sent ${r.sentCount}, failed ${r.failedCount}, skipped ${r.skippedCount}`,
        ),
      );
      setEmail(null);
    });

  const m = (v: string | null) => (v === null ? "—" : money(v, locale, 0));
  return (
    <>
      <header className="toolbar">
        <h1>{data.name}</h1>
        <span className="badge">{l(...CAMPAIGN_STATUS_LABEL[data.status]!)}</span>
        {editable && (
          <>
            <button className="primary" disabled={busy} onClick={save}>
              {l("Simpan", "Save")}
            </button>
            <button
              className="link"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!(await ask(l("Hapus kampanye ini?", "Delete this campaign?")))) return;
                  await api(`/crm/campaigns/${id}`, { method: "DELETE" });
                  router.replace("/crm/campaigns");
                })
              }
            >
              {l("Hapus", "Delete")}
            </button>
          </>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <ul className="grid">
        <li className="card">
          <span>{l("Anggota", "Members")}</span>
          <strong>{data.members}</strong>
          <small className="muted">
            {l("terkirim", "sent")} {data.sent} · {l("merespons", "responded")} {data.responded} ·{" "}
            {l("berhenti", "unsubscribed")} {data.unsubscribed}
          </small>
        </li>
        <li className="card">
          <span>{l("Lead dari kampanye", "Leads from campaign")}</span>
          <strong>{data.leads}</strong>
          <small className="muted">
            {data.opportunities} {l("peluang", "opportunities")} · {data.won} {l("menang", "won")}
          </small>
        </li>
        <li className="card">
          <span>{l("Nilai menang", "Won value")}</span>
          <strong>{m(data.wonAmount)}</strong>
          <small className="muted">
            {l("pipeline", "pipeline")} {m(data.pipeline)}
          </small>
        </li>
        <li className="card">
          <span>ROI</span>
          <strong>{data.roi === null ? "—" : `${data.roi}%`}</strong>
          <small className="muted">
            {l("biaya per lead", "cost per lead")} {m(data.costPerLead)}
          </small>
        </li>
      </ul>

      <section className="panel">
        <fieldset className="fields" disabled={!editable}>
          <label className="field">
            <span>{l("Nama *", "Name *")}</span>
            <input value={values.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="field">
            <span>{l("Jenis", "Type")}</span>
            <select value={values.campaignType} onChange={(e) => set({ campaignType: e.target.value })}>
              {CAMPAIGN_TYPE_VALUES.map((v) => (
                <option key={v} value={v}>
                  {l(...CAMPAIGN_TYPE_LABEL[v]!)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Status", "Status")}</span>
            <select value={values.status} onChange={(e) => set({ status: e.target.value })}>
              {CAMPAIGN_STATUS_VALUES.map((v) => (
                <option key={v} value={v}>
                  {l(...CAMPAIGN_STATUS_LABEL[v]!)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Mulai", "Start")}</span>
            <input
              type="date"
              value={values.dateStart}
              onChange={(e) => set({ dateStart: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Selesai", "End")}</span>
            <input type="date" value={values.dateEnd} onChange={(e) => set({ dateEnd: e.target.value })} />
          </label>
          <label className="field">
            <span>{l("Anggaran", "Budget")}</span>
            <input
              className="num"
              inputMode="decimal"
              value={values.budget}
              onChange={(e) => set({ budget: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Biaya aktual (untuk ROI)", "Actual cost (for ROI)")}</span>
            <input
              className="num"
              inputMode="decimal"
              value={values.actualCost}
              onChange={(e) => set({ actualCost: e.target.value })}
            />
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>{l("Keterangan", "Description")}</span>
            <textarea
              rows={2}
              value={values.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </label>
        </fieldset>
      </section>

      <section className="panel">
        <header className="toolbar">
          <h2>
            {l("Anggota", "Members")} ({data.memberList.length})
          </h2>
          {editable && data.memberList.length > 0 && (
            <button
              onClick={() =>
                setEmail({
                  subject: "",
                  body: l("Halo {{name}},\n\n", "Hello {{name}},\n\n"),
                  onlyStatus: "",
                })
              }
            >
              {l("Kirim email", "Send email")}
            </button>
          )}
        </header>
        {editable && (
          <div className="inline-panel">
            <strong>{l("Tambah lead terbuka", "Add open leads")}</strong>
            <label className="field">
              <span>{l("Sumber", "Source")}</span>
              <select
                value={segment.source}
                onChange={(e) => setSegment({ ...segment, source: e.target.value })}
              >
                <option value="">{l("Semua", "All")}</option>
                {LEAD_SOURCES.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label[locale]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Status lead", "Lead status")}</span>
              <select
                value={segment.leadStatus}
                onChange={(e) => setSegment({ ...segment, leadStatus: e.target.value })}
              >
                <option value="">{l("Semua", "All")}</option>
                {LEAD_STATUS_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {l(...LEAD_STATUS_LABEL[v]!)}
                  </option>
                ))}
              </select>
            </label>
            {territories.length > 0 && (
              <label className="field">
                <span>{l("Wilayah", "Territory")}</span>
                <select value={territoryId} onChange={(e) => setTerritoryId(e.target.value)}>
                  <option value="">{l("Semua", "All")}</option>
                  {territories.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>{l("Skor minimal", "Minimum score")}</span>
              <input
                className="num"
                inputMode="numeric"
                style={{ width: 80 }}
                value={segment.minScore}
                onChange={(e) => setSegment({ ...segment, minScore: e.target.value })}
              />
            </label>
            <button disabled={busy} onClick={addSegment}>
              {l("Tambahkan", "Add")}
            </button>
          </div>
        )}
        {email && (
          <div className="stack">
            <label className="field">
              <span>{l("Subjek", "Subject")}</span>
              <input
                value={email.subject}
                onChange={(e) => setEmail({ ...email, subject: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("Isi email", "Body")}</span>
              <textarea
                rows={8}
                value={email.body}
                onChange={(e) => setEmail({ ...email, body: e.target.value })}
              />
            </label>
            <p className="muted">
              {l(
                "Isian: {{name}}, {{company}}, {{campaign}}, {{unsubscribe}}. Tautan berhenti langganan ditambahkan otomatis bila tidak dipakai. Penerima tanpa email, bertanda jangan dihubungi, atau sudah berhenti langganan dilewati.",
                "Placeholders: {{name}}, {{company}}, {{campaign}}, {{unsubscribe}}. An unsubscribe link is appended when not used. Recipients without email, marked do-not-contact, or unsubscribed are skipped.",
              )}
            </p>
            <div className="filters">
              <label className="field">
                <span>{l("Hanya anggota berstatus", "Only members with status")}</span>
                <select
                  value={email.onlyStatus}
                  onChange={(e) => setEmail({ ...email, onlyStatus: e.target.value })}
                >
                  <option value="">{l("Semua (kecuali berhenti)", "All (except unsubscribed)")}</option>
                  {(["targeted", "sent", "responded", "failed"] as const).map((v) => (
                    <option key={v} value={v}>
                      {l(...MEMBER_STATUS_LABEL[v]!)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary"
                disabled={busy || !email.subject.trim() || !email.body.trim()}
                onClick={sendEmail}
              >
                {l("Kirim", "Send")}
              </button>
              <button className="link" onClick={() => setEmail(null)}>
                {l("Batal", "Cancel")}
              </button>
            </div>
          </div>
        )}
        {data.memberList.length === 0 ? (
          <p className="muted">
            {l(
              "Belum ada anggota. Tambahkan lead di atas, atau tautkan lead ke kampanye ini dari form lead.",
              "No members yet. Add leads above, or link leads to this campaign from the lead form.",
            )}
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{l("Nama", "Name")}</th>
                  <th>{l("Perusahaan", "Company")}</th>
                  <th>{l("Email", "Email")}</th>
                  <th>{l("Status", "Status")}</th>
                  <th>{l("Terkirim", "Sent")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.memberList.map((x) => (
                  <tr key={x.id}>
                    <td>
                      {x.leadId ? (
                        <Link href={`/crm/leads/${x.leadId}`}>{x.name ?? "—"}</Link>
                      ) : (
                        <Link href={`/crm/accounts/${x.partnerId}`}>{x.name ?? "—"}</Link>
                      )}
                    </td>
                    <td>{x.company}</td>
                    <td>
                      {x.email ?? "—"}
                      {x.doNotContact && (
                        <span className="badge state-cancel">{l("Jangan dihubungi", "Do not contact")}</span>
                      )}
                    </td>
                    <td>
                      <span className="badge" title={x.error ?? undefined}>
                        {l(...MEMBER_STATUS_LABEL[x.status]!)}
                      </span>
                    </td>
                    <td>{x.sentAt ? formatDate(x.sentAt, locale) : ""}</td>
                    <td>
                      {editable && (
                        <>
                          {x.status !== "responded" && x.status !== "unsubscribed" && (
                            <button
                              className="link"
                              onClick={() =>
                                run(async () => {
                                  await api(`/crm/campaigns/${id}/members/${x.id}`, {
                                    method: "PATCH",
                                    body: { status: "responded" },
                                  });
                                })
                              }
                            >
                              {l("Tandai merespons", "Mark responded")}
                            </button>
                          )}{" "}
                          <button
                            className="link"
                            onClick={() =>
                              run(async () => {
                                await api(`/crm/campaigns/${id}/members/${x.id}`, { method: "DELETE" });
                              })
                            }
                          >
                            {l("Hapus", "Remove")}
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

      {data.emails.length > 0 && (
        <section className="panel">
          <h2>{l("Riwayat email", "Email history")}</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{l("Tanggal", "Date")}</th>
                  <th>{l("Subjek", "Subject")}</th>
                  <th className="num">{l("Terkirim", "Sent")}</th>
                  <th className="num">{l("Gagal", "Failed")}</th>
                  <th className="num">{l("Dilewati", "Skipped")}</th>
                  <th>{l("Oleh", "By")}</th>
                </tr>
              </thead>
              <tbody>
                {data.emails.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.sentAt, locale)}</td>
                    <td>{e.subject}</td>
                    <td className="num">{e.sentCount}</td>
                    <td className="num">{e.failedCount}</td>
                    <td className="num">{e.skippedCount}</td>
                    <td>{e.userName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
