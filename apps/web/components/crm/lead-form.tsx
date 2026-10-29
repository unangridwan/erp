"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { formatDate, money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { can, LEAD_SOURCES, LEAD_STATE_LABEL, ORDER_STATE_LABEL } from "../../lib/resources";
import { useOptions } from "../accounting/use-options";
import { Chatter } from "../chatter";
import { useMe } from "../me-context";
import { RefSelect } from "../ref-select";
import { ActivitiesPanel } from "./activities-panel";

interface Lead {
  id: string;
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
] as const;
type Values = Record<(typeof FIELDS)[number], string>;

const toValues = (lead: Partial<Lead>): Values =>
  Object.fromEntries(
    FIELDS.map((f) => {
      const v = lead[f as keyof Lead];
      // Buang nol desimal dari kolom numeric (10.00 → 10).
      if (f === "expectedRevenue" || f === "probability") return [f, v == null ? "" : String(Number(v))];
      return [f, v == null ? "" : String(v)];
    }),
  ) as Values;

export function LeadForm({ id, newType }: { id: string; newType: string }) {
  const me = useMe();
  const router = useRouter();
  const { l, tx, locale } = useI18n();
  const isNew = id === "new";
  const [lead, setLead] = useState<Lead | null>(null);
  const [values, setValues] = useState<Values>(toValues({ priority: 0 }));
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [lostForm, setLostForm] = useState<{ reasonId: string; note: string } | null>(null);
  const [convertForm, setConvertForm] = useState<{ partner: string; partnerId: string } | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const stages = useOptions<{ id: string; name: string; isWon: boolean }>("/crm-stages");
  const reasons = useOptions<{ id: string; name: string }>("/lost-reasons");
  const users = useOptions<{ id: string; name: string }>("/users/options");
  const teams = useOptions<{ id: string; name: string }>("/sales-teams");

  useEffect(() => {
    if (isNew) return;
    api<Lead>(`/leads/${id}`)
      .then((x) => {
        setLead(x);
        setValues(toValues(x));
      })
      .catch((e: Error) => setError(e.message));
    if (can(me.permissions, "sales.read"))
      api<{ items: OrderRow[] }>(`/sale-orders?leadId=${id}&limit=50`)
        .then((d) => setOrders(d.items))
        .catch(() => setOrders([]));
  }, [id, isNew, version, me.permissions]);

  const editable = can(me.permissions, "crm.write");
  const leadType = lead?.leadType ?? (newType === "lead" ? "lead" : "opportunity");
  const set = (patch: Partial<Values>) => setValues((v) => ({ ...v, ...patch }));
  const err = (path: string) => fieldErrors[path] && <small className="error">{fieldErrors[path]}</small>;

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
      else if (f === "expectedRevenue") body[f] = v || "0";
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

  return (
    <div className="form-layout">
      <div className="stack-wide">
        <form className="panel" onSubmit={save}>
          <header className="toolbar">
            <h1>{title}</h1>
            {lead && <span className={`badge state-${lead.state}`}>{tx(LEAD_STATE_LABEL[lead.state]!)}</span>}
            <span className="badge">
              {leadType === "lead" ? l("Lead", "Lead") : l("Peluang", "Opportunity")}
            </span>
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
                  })
                }
              >
                {l("Jadikan peluang", "Convert to opportunity")}
              </button>
            )}
            {lead && editable && open && leadType === "opportunity" && (
              <>
                {quotationHref && can(me.permissions, "sales.write") && (
                  <Link className="button" href={quotationHref}>
                    {l("Penawaran baru", "New quotation")}
                  </Link>
                )}
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
                    if (!confirm(l("Hapus lead ini?", "Delete this lead?"))) return;
                    await api(`/leads/${id}`, { method: "DELETE" });
                    router.replace(leadType === "lead" ? "/crm/leads" : "/crm/pipeline");
                  })
                }
              >
                {l("Hapus", "Delete")}
              </button>
            )}
          </header>
          {error && <p className="error">{error}</p>}

          {convertForm && (
            <div className="inline-panel">
              <label className="field">
                <span>{l("Pelanggan", "Customer")}</span>
                <select
                  value={convertForm.partner}
                  onChange={(e) => setConvertForm({ ...convertForm, partner: e.target.value })}
                >
                  <option value="create">
                    {l("Buat pelanggan baru dari lead", "Create a new customer from lead")}
                  </option>
                  <option value="existing">
                    {l("Tautkan ke pelanggan yang ada", "Link to an existing customer")}
                  </option>
                  <option value="none">{l("Tanpa pelanggan", "No customer")}</option>
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
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() =>
                  action("convert", {
                    partner: convertForm.partner,
                    partnerId: convertForm.partnerId || undefined,
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
              <span>{l("Pelanggan", "Customer")}</span>
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
              <span>{l("Catatan", "Notes")}</span>
              <textarea
                rows={3}
                value={values.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            </label>
          </fieldset>

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
        {lead && (
          <ActivitiesPanel
            resModel="crm_lead"
            resId={lead.id}
            editable={editable}
            onChange={() => setVersion((v) => v + 1)}
          />
        )}
      </div>
      {lead && <Chatter model="crm_lead" id={lead.id} version={version} labels={{}} />}
    </div>
  );
}
