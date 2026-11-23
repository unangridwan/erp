"use client";

import { CustomFieldsSection, customPayload, useCustomFields, type CustomValues } from "../custom-fields";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  FORECAST_CATEGORY_LABEL,
  FORECAST_CATEGORY_VALUES,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_VALUES,
  scoreGrade,
} from "@erp/shared";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { formatDate, money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { can, LEAD_SOURCES, LEAD_STATE_LABEL, ORDER_STATE_LABEL } from "../../lib/resources";
import { useOptions } from "../accounting/use-options";
import { Chatter } from "../chatter";
import { RelatedDocuments } from "../related-documents";
import { useMe } from "../me-context";
import { RefSelect } from "../ref-select";
import { ActivitiesPanel } from "./activities-panel";
import { ask, toast } from "../feedback";
import {
  ContactRolesPanel,
  DuplicatesPanel,
  ProductsPanel,
  StageHistoryPanel,
  type LeadContactRole,
  type LeadProduct,
  type StageHistoryRow,
} from "./opportunity-panels";
import { useFormSnapshot } from "../../lib/use-form-guard";

interface Lead {
  id: string;
  custom?: CustomValues;
  leadType: "lead" | "opportunity";
  name: string;
  partnerId: string | null;
  contactName: string | null;
  partnerName: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  stageId: string | null;
  userId: string | null;
  teamId: string | null;
  expectedRevenue: string;
  probability: string;
  expectedClose: string | null;
  priority: number;
  state: "open" | "won" | "lost";
  lostReasonId: string | null;
  lostNote: string | null;
  description: string | null;
  leadStatus: string;
  title: string | null;
  industry: string | null;
  website: string | null;
  employeeCount: number | null;
  annualRevenue: string | null;
  street: string | null;
  city: string | null;
  province: string | null;
  nextStep: string | null;
  forecastCategory: string | null;
  territoryId: string | null;
  campaignId: string | null;
  score: number;
  doNotContact: boolean;
  contactId: string | null;
  partnerDisplay?: string | null;
  contactDisplay?: string | null;
  products?: LeadProduct[];
  contactRoles?: LeadContactRole[];
  stageHistory?: StageHistoryRow[];
  stageDays?: { stageId: string; stageName: string; days: number }[];
}
interface OrderRow {
  id: string;
  name: string;
  state: string;
  dateOrder: string;
  amountTotal: string;
  currencyCode: string;
}

const FIELDS = [
  "name",
  "partnerId",
  "contactName",
  "partnerName",
  "email",
  "phone",
  "source",
  "stageId",
  "userId",
  "teamId",
  "expectedRevenue",
  "probability",
  "expectedClose",
  "priority",
  "description",
  "leadStatus",
  "title",
  "industry",
  "website",
  "employeeCount",
  "annualRevenue",
  "street",
  "city",
  "province",
  "nextStep",
  "forecastCategory",
  "territoryId",
  "campaignId",
] as const;
type Values = Record<(typeof FIELDS)[number], string>;

const toValues = (lead: Partial<Lead>): Values =>
  Object.fromEntries(
    FIELDS.map((f) => {
      const v = lead[f as keyof Lead];
      // Buang nol desimal dari kolom numeric (10.00 → 10).
      if (f === "leadStatus") return [f, v == null ? "new" : String(v)];
      if (f === "expectedRevenue" || f === "probability" || f === "annualRevenue")
        return [f, v == null ? "" : String(Number(v))];
      return [f, v == null ? "" : String(v)];
    }),
  ) as Values;

export function LeadForm({ id, newType }: { id: string; newType: string }) {
  const me = useMe();
  const router = useRouter();
  const { l, tx, locale } = useI18n();
  const isNew = id === "new";
  const [lead, setLead] = useState<Lead | null>(null);
  const presetPartner = useSearchParams().get("partnerId");
  const [values, setValues] = useState<Values>(toValues({ priority: 0, partnerId: presetPartner }));
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [lostForm, setLostForm] = useState<{ reasonId: string; note: string } | null>(null);
  const [convertForm, setConvertForm] = useState<{
    partner: string;
    partnerId: string;
    contact: string;
    opportunityName: string;
  } | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [custom, setCustom] = useState<CustomValues>({});
  const customDefs = useCustomFields("crm_lead");
  const stages = useOptions<{ id: string; name: string; isWon: boolean }>("/crm-stages");
  const reasons = useOptions<{ id: string; name: string }>("/lost-reasons");
  const users = useOptions<{ id: string; name: string }>("/users/options");
  const teams = useOptions<{ id: string; name: string }>("/sales-teams");
  const territories = useOptions<{ id: string; name: string }>("/crm/territories");
  const campaigns = useOptions<{ id: string; name: string }>("/crm/campaigns");

  useEffect(() => {
    if (isNew) return;
    api<Lead>(`/leads/${id}`)
      .then((x) => {
        setLead(x);
        setValues(toValues(x));
        setCustom(x.custom ?? {});
      })
      .catch((e: Error) => setError(e.message));
    if (can(me.permissions, "sales.read"))
      api<{ items: OrderRow[] }>(`/sale-orders?leadId=${id}&limit=50`)
        .then((d) => setOrders(d.items))
        .catch(() => setOrders([]));
  }, [id, isNew, version, me.permissions]);

  const editable = can(me.permissions, "crm.write");
  // Peringatan saat meninggalkan form yang belum disimpan (tautan, tombol Kembali, tutup tab).
  useFormSnapshot({ values, custom }, lead, editable);
  const leadType = lead?.leadType ?? (newType === "lead" ? "lead" : "opportunity");
  const set = (patch: Partial<Values>) => setValues((v) => ({ ...v, ...patch }));
  const err = (path: string) =>
    fieldErrors[path] && (
      <small className="error" role="alert">
        {fieldErrors[path]}
      </small>
    );

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  function payload() {
    const body: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const v = values[f];
      if (f === "priority") body[f] = Number(v || 0);
      else if (f === "leadStatus") body[f] = v || "new";
      else if (f === "employeeCount") {
        if (v !== "") body[f] = Number(v);
        else if (!isNew) body[f] = null;
      } else if (f === "expectedRevenue") body[f] = v || "0";
      else if (f === "probability") {
        // Probabilitas kosong = ikut tahap.
        if (v !== "" && (isNew || v !== String(Number(lead?.probability)))) body[f] = Number(v);
      } else if (v === "") {
        if (!isNew) body[f] = null;
        else if (f === "userId") body[f] = undefined;
      } else body[f] = v;
    }
    // Probabilitas tidak dikirim saat tahap berubah agar mengikuti probabilitas tahap baru.
    if (!isNew && lead && values.stageId !== (lead.stageId ?? "")) delete body.probability;
    if (isNew) body.leadType = leadType;
    if (customDefs.length) body.custom = customPayload(customDefs, custom);
    return body;
  }

  const save = (e?: FormEvent) => {
    e?.preventDefault();
    return run(async () => {
      if (isNew) {
        const created = await api<Lead>("/leads", { method: "POST", body: payload() });
        router.replace(`/crm/leads/${created.id}`);
      } else {
        await api(`/leads/${id}`, { method: "PATCH", body: payload() });
        setVersion((v) => v + 1);
      }
      toast.success(l("Tersimpan", "Saved"));
    });
  };

  const action = (path: string, body?: object) =>
    run(async () => {
      await api(`/leads/${id}/${path}`, { method: "POST", body: body ?? {} });
      setLostForm(null);
      setConvertForm(null);
      setVersion((v) => v + 1);
    });

  if (!isNew && !lead) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;

  const title =
    lead?.name ?? (leadType === "lead" ? l("Lead baru", "New lead") : l("Peluang baru", "New opportunity"));
  const open = !lead || lead.state === "open";
  const quotationHref =
    lead && lead.partnerId ? `/sales/orders/new?leadId=${lead.id}&partnerId=${lead.partnerId}` : null;
  const hasProducts = (lead?.products?.length ?? 0) > 0;
  const quote = () =>
    run(async () => {
      const order = await api<{ id: string }>(`/sale-orders/from-lead/${id}`, { method: "POST", body: {} });
      router.push(`/sales/orders/${order.id}`);
    });

  return (
    <div className="form-layout">
      <div className="stack-wide">
        <form className="panel" onSubmit={save}>
          <header className="toolbar">
            <Crumb
              to={
                (leadType === "lead"
                  ? ["/crm/leads", l("Lead", "Leads")]
                  : ["/crm/opportunities", l("Peluang", "Opportunities")]) as [string, string]
              }
            />
            <h1>{title}</h1>
            {lead && <span className={`badge state-${lead.state}`}>{tx(LEAD_STATE_LABEL[lead.state]!)}</span>}
            <span className="badge">
              {leadType === "lead" ? l("Lead", "Lead") : l("Peluang", "Opportunity")}
            </span>
            {lead && (
              <span className="badge" title={l("Skor lead", "Lead score")}>
                {l("Skor", "Score")} {lead.score} · {scoreGrade(lead.score)}
              </span>
            )}
            {lead?.doNotContact && (
              <span className="badge state-cancel">{l("Jangan dihubungi", "Do not contact")}</span>
            )}
            {lead?.partnerId && (
              <Link className="button" href={`/crm/accounts/${lead.partnerId}`}>
                {l("Akun 360°", "Account 360°")}
              </Link>
            )}
            {editable && (
              <button className="primary" disabled={busy}>
                {l("Simpan", "Save")}
              </button>
            )}
            {lead && editable && open && leadType === "lead" && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setConvertForm({
                    partner: lead.partnerId ? "existing" : "create",
                    partnerId: lead.partnerId ?? "",
                    contact: "create",
                    opportunityName: lead.name,
                  })
                }
              >
                {l("Jadikan peluang", "Convert to opportunity")}
              </button>
            )}
            {lead && editable && open && leadType === "opportunity" && (
              <>
                {quotationHref &&
                  can(me.permissions, "sales.write") &&
                  (hasProducts ? (
                    <button type="button" disabled={busy} onClick={quote}>
                      {l("Buat penawaran", "Create quotation")}
                    </button>
                  ) : (
                    <Link className="button" href={quotationHref}>
                      {l("Penawaran baru", "New quotation")}
                    </Link>
                  ))}
                <button type="button" className="primary" disabled={busy} onClick={() => action("won")}>
                  {l("Tandai menang", "Mark won")}
                </button>
              </>
            )}
            {lead && editable && open && (
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => setLostForm({ reasonId: "", note: "" })}
              >
                {l("Tandai kalah", "Mark lost")}
              </button>
            )}
            {lead && editable && !open && (
              <button type="button" disabled={busy} onClick={() => action("reopen")}>
                {l("Buka kembali", "Reopen")}
              </button>
            )}
            {lead && editable && (
              <button
                type="button"
                className="link"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (!(await ask(l("Hapus lead ini?", "Delete this lead?")))) return;
                    await api(`/leads/${id}`, { method: "DELETE" });
                    router.replace(leadType === "lead" ? "/crm/leads" : "/crm/opportunities");
                  })
                }
              >
                {l("Hapus", "Delete")}
              </button>
            )}
          </header>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          {lead && open && (
            <DuplicatesPanel
              leadId={lead.id}
              version={version}
              editable={editable}
              onChanged={() => setVersion((v) => v + 1)}
              onLinkPartner={
                lead.partnerId
                  ? undefined
                  : (partnerId) =>
                      run(async () => {
                        await api(`/leads/${id}`, { method: "PATCH", body: { partnerId } });
                        setVersion((v) => v + 1);
                      })
              }
            />
          )}
          {convertForm && (
            <div className="inline-panel">
              <label className="field">
                <span>{l("Nama peluang", "Opportunity name")}</span>
                <input
                  value={convertForm.opportunityName}
                  onChange={(e) => setConvertForm({ ...convertForm, opportunityName: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{l("Pelanggan", "Customer")}</span>
                <select
                  value={convertForm.partner}
                  onChange={(e) => setConvertForm({ ...convertForm, partner: e.target.value })}
                >
                  <option value="create">
                    {l("Buat akun baru dari lead", "Create a new account from lead")}
                  </option>
                  <option value="existing">
                    {l("Tautkan ke akun yang ada", "Link to an existing account")}
                  </option>
                  <option value="none">{l("Tanpa akun", "No account")}</option>
                </select>
              </label>
              {convertForm.partner === "existing" && (
                <label className="field">
                  <span>{l("Pilih pelanggan", "Select customer")}</span>
                  <RefSelect
                    name="convertPartner"
                    resource="partners"
                    display="name"
                    value={convertForm.partnerId}
                    onChange={(v) => setConvertForm({ ...convertForm, partnerId: v })}
                  />
                </label>
              )}
              {convertForm.partner !== "none" && (
                <label className="field">
                  <span>{l("Kontak", "Contact")}</span>
                  <select
                    value={convertForm.contact}
                    onChange={(e) => setConvertForm({ ...convertForm, contact: e.target.value })}
                  >
                    <option value="create">
                      {l(
                        "Buat kontak dari nama kontak lead",
                        "Create a contact from the lead's contact name",
                      )}
                    </option>
                    <option value="none">{l("Tanpa kontak", "No contact")}</option>
                  </select>
                </label>
              )}
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() =>
                  action("convert", {
                    partner: convertForm.partner,
                    partnerId: convertForm.partnerId || undefined,
                    contact: convertForm.partner === "none" ? "none" : convertForm.contact,
                    opportunityName: convertForm.opportunityName || undefined,
                  })
                }
              >
                {l("Konversi", "Convert")}
              </button>
              <button type="button" className="link" onClick={() => setConvertForm(null)}>
                {l("Batal", "Cancel")}
              </button>
            </div>
          )}

          {lostForm && (
            <div className="inline-panel">
              <label className="field">
                <span>{l("Alasan kalah", "Lost reason")}</span>
                <select
                  value={lostForm.reasonId}
                  onChange={(e) => setLostForm({ ...lostForm, reasonId: e.target.value })}
                >
                  <option value="">—</option>
                  {reasons.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{l("Catatan", "Note")}</span>
                <input
                  value={lostForm.note}
                  onChange={(e) => setLostForm({ ...lostForm, note: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() =>
                  action("lost", { lostReasonId: lostForm.reasonId || null, lostNote: lostForm.note || null })
                }
              >
                {l("Tandai kalah", "Mark lost")}
              </button>
              <button type="button" className="link" onClick={() => setLostForm(null)}>
                {l("Batal", "Cancel")}
              </button>
            </div>
          )}
          {lead?.state === "lost" && (
            <p className="notice">
              {l("Kalah", "Lost")}: {reasons.find((r) => r.id === lead.lostReasonId)?.name ?? "—"}
              {lead.lostNote ? ` — ${lead.lostNote}` : ""}
            </p>
          )}

          <fieldset className="fields" disabled={!editable}>
            <label className="field">
              <span>
                {leadType === "lead" ? l("Judul lead *", "Lead title *") : l("Peluang *", "Opportunity *")}
              </span>
              <input required value={values.name} onChange={(e) => set({ name: e.target.value })} />
              {err("name")}
            </label>
            <label className="field">
              <span>{l("Akun / pelanggan", "Account / customer")}</span>
              <RefSelect
                name="partnerId"
                resource="partners"
                display="name"
                value={values.partnerId}
                onChange={(v) => set({ partnerId: v })}
              />
              {err("partnerId")}
            </label>
            {!values.partnerId && (
              <label className="field">
                <span>{l("Nama perusahaan", "Company name")}</span>
                <input value={values.partnerName} onChange={(e) => set({ partnerName: e.target.value })} />
              </label>
            )}
            <label className="field">
              <span>{l("Nama kontak", "Contact name")}</span>
              <input value={values.contactName} onChange={(e) => set({ contactName: e.target.value })} />
            </label>
            <label className="field">
              <span>{l("Email", "Email")}</span>
              <input type="email" value={values.email} onChange={(e) => set({ email: e.target.value })} />
              {err("email")}
            </label>
            <label className="field">
              <span>{l("Telepon", "Phone")}</span>
              <input value={values.phone} onChange={(e) => set({ phone: e.target.value })} />
            </label>
            <label className="field">
              <span>{l("Jabatan kontak", "Contact job title")}</span>
              <input value={values.title} onChange={(e) => set({ title: e.target.value })} />
            </label>
            {leadType === "lead" && (
              <label className="field">
                <span>{l("Status lead", "Lead status")}</span>
                <select value={values.leadStatus} onChange={(e) => set({ leadStatus: e.target.value })}>
                  {LEAD_STATUS_VALUES.map((v) => (
                    <option key={v} value={v}>
                      {l(...LEAD_STATUS_LABEL[v]!)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>{l("Sumber", "Source")}</span>
              <select value={values.source} onChange={(e) => set({ source: e.target.value })}>
                <option value="">—</option>
                {LEAD_SOURCES.map(([v, label]) => (
                  <option key={v} value={v}>
                    {tx(label)}
                  </option>
                ))}
              </select>
            </label>
            {leadType === "opportunity" && (
              <label className="field">
                <span>{l("Tahap", "Stage")}</span>
                <select
                  value={values.stageId}
                  disabled={!open}
                  onChange={(e) => set({ stageId: e.target.value })}
                >
                  <option value="">—</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {err("stageId")}
              </label>
            )}
            <label className="field">
              <span>{l("Penanggung jawab", "Salesperson")}</span>
              <select value={values.userId} onChange={(e) => set({ userId: e.target.value })}>
                <option value="">{isNew ? l("Saya", "Me") : l("Belum ditugaskan", "Unassigned")}</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              {err("userId")}
            </label>
            <label className="field">
              <span>{l("Tim penjualan", "Sales team")}</span>
              <select value={values.teamId} onChange={(e) => set({ teamId: e.target.value })}>
                <option value="">—</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Pendapatan harapan", "Expected revenue")}</span>
              <input
                className="num"
                inputMode="decimal"
                value={values.expectedRevenue}
                disabled={hasProducts}
                title={hasProducts ? l("Dihitung dari produk", "Computed from products") : undefined}
                onChange={(e) => set({ expectedRevenue: e.target.value })}
              />
              {err("expectedRevenue")}
            </label>
            <label className="field">
              <span>{l("Probabilitas %", "Probability %")}</span>
              <input
                className="num"
                inputMode="decimal"
                placeholder={l("ikut tahap", "from stage")}
                value={values.probability}
                onChange={(e) => set({ probability: e.target.value })}
              />
              {err("probability")}
            </label>
            <label className="field">
              <span>{l("Perkiraan closing", "Expected closing")}</span>
              <input
                type="date"
                value={values.expectedClose}
                onChange={(e) => set({ expectedClose: e.target.value })}
              />
            </label>
            {leadType === "opportunity" && (
              <label className="field">
                <span>{l("Kategori forecast", "Forecast category")}</span>
                <select
                  value={values.forecastCategory}
                  onChange={(e) => set({ forecastCategory: e.target.value })}
                >
                  <option value="">{l("Ikut tahap", "From stage")}</option>
                  {FORECAST_CATEGORY_VALUES.map((v) => (
                    <option key={v} value={v}>
                      {l(...FORECAST_CATEGORY_LABEL[v]!)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {campaigns.length > 0 && (
              <label className="field">
                <span>{l("Kampanye", "Campaign")}</span>
                <select value={values.campaignId} onChange={(e) => set({ campaignId: e.target.value })}>
                  <option value="">—</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {err("campaignId")}
              </label>
            )}
            {territories.length > 0 && (
              <label className="field">
                <span>{l("Wilayah", "Territory")}</span>
                <select value={values.territoryId} onChange={(e) => set({ territoryId: e.target.value })}>
                  <option value="">{isNew ? l("Otomatis dari aturan", "Automatic from rules") : "—"}</option>
                  {territories.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {err("territoryId")}
              </label>
            )}
            <label className="field">
              <span>{l("Prioritas", "Priority")}</span>
              <select value={values.priority} onChange={(e) => set({ priority: e.target.value })}>
                <option value="0">—</option>
                <option value="1">★</option>
                <option value="2">★★</option>
                <option value="3">★★★</option>
              </select>
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>{l("Langkah berikut", "Next step")}</span>
              <input
                value={values.nextStep}
                placeholder={l("mis. Kirim proposal, jadwalkan demo", "e.g. Send proposal, schedule demo")}
                onChange={(e) => set({ nextStep: e.target.value })}
              />
            </label>
            {!values.partnerId && (
              <>
                <label className="field">
                  <span>{l("Industri", "Industry")}</span>
                  <input value={values.industry} onChange={(e) => set({ industry: e.target.value })} />
                </label>
                <label className="field">
                  <span>{l("Situs web", "Website")}</span>
                  <input value={values.website} onChange={(e) => set({ website: e.target.value })} />
                </label>
                <label className="field">
                  <span>{l("Jumlah karyawan", "Employees")}</span>
                  <input
                    className="num"
                    inputMode="numeric"
                    value={values.employeeCount}
                    onChange={(e) => set({ employeeCount: e.target.value })}
                  />
                  {err("employeeCount")}
                </label>
                <label className="field">
                  <span>{l("Omzet tahunan", "Annual revenue")}</span>
                  <input
                    className="num"
                    inputMode="decimal"
                    value={values.annualRevenue}
                    onChange={(e) => set({ annualRevenue: e.target.value })}
                  />
                  {err("annualRevenue")}
                </label>
                <label className="field">
                  <span>{l("Alamat", "Street")}</span>
                  <input value={values.street} onChange={(e) => set({ street: e.target.value })} />
                </label>
                <label className="field">
                  <span>{l("Kota", "City")}</span>
                  <input value={values.city} onChange={(e) => set({ city: e.target.value })} />
                </label>
                <label className="field">
                  <span>{l("Provinsi", "Province")}</span>
                  <input value={values.province} onChange={(e) => set({ province: e.target.value })} />
                </label>
              </>
            )}
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>{l("Catatan", "Notes")}</span>
              <textarea
                rows={3}
                value={values.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            </label>
          </fieldset>
          <CustomFieldsSection
            bare
            model="crm_lead"
            value={custom}
            onChange={setCustom}
            editable={editable}
            errors={fieldErrors}
          />

          {lead && leadType === "opportunity" && Number(lead.expectedRevenue) > 0 && (
            <p className="muted">
              {l("Nilai tertimbang", "Weighted value")}:{" "}
              {money((Number(lead.expectedRevenue) * Number(lead.probability)) / 100, locale)}
            </p>
          )}

          {orders.length > 0 && (
            <>
              <h2>{l("Penawaran & pesanan", "Quotations & orders")}</h2>
              <div className="table-scroll">
                <table>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <Link href={`/sales/orders/${o.id}`}>{o.name}</Link>
                        </td>
                        <td>{formatDate(o.dateOrder, locale)}</td>
                        <td>
                          <span className={`badge state-${o.state}`}>{tx(ORDER_STATE_LABEL[o.state]!)}</span>
                        </td>
                        <td className="num">
                          {o.currencyCode} {money(o.amountTotal, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </form>
        {lead && leadType === "opportunity" && (
          <>
            <ProductsPanel
              leadId={lead.id}
              products={lead.products ?? []}
              editable={editable && open}
              onSaved={() => setVersion((v) => v + 1)}
            />
            <ContactRolesPanel
              leadId={lead.id}
              accountId={lead.partnerId}
              roles={lead.contactRoles ?? []}
              editable={editable}
              onSaved={() => setVersion((v) => v + 1)}
            />
            <StageHistoryPanel history={lead.stageHistory ?? []} stageDays={lead.stageDays ?? []} />
          </>
        )}
        {lead && (
          <ActivitiesPanel
            resModel="crm_lead"
            resId={lead.id}
            editable={editable}
            onChange={() => setVersion((v) => v + 1)}
          />
        )}
        {lead && <RelatedDocuments model="crm_lead" id={lead.id} version={version} />}
      </div>
      {lead && <Chatter model="crm_lead" id={lead.id} version={version} labels={{}} />}
    </div>
  );
}

/** Tautan kembali ke daftar asal dokumen. */
function Crumb({ to: [href, label] }: { to: [string, string] }) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <Link href={href}>{label}</Link>
      <span aria-hidden>/</span>
    </nav>
  );
}
