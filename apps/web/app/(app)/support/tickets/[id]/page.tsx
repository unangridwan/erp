"use client";

import {
  TICKET_CHANNEL_LABEL,
  TICKET_PRIORITY_LABEL,
  TICKET_PRIORITY_VALUES,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_VALUES,
} from "@erp/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useOptions } from "../../../../../components/accounting/use-options";
import { Chatter } from "../../../../../components/chatter";
import { toast } from "../../../../../components/feedback";
import { useMe } from "../../../../../components/me-context";
import { SlaBadge } from "../../../../../components/support/sla-badge";
import { api, ApiError } from "../../../../../lib/api";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";

interface Message {
  id: string;
  kind: "public" | "internal" | "customer";
  body: string;
  authorName: string | null;
  createdAt: string;
}
interface Ticket {
  id: string;
  number: string;
  subject: string;
  description: string | null;
  partnerId: string | null;
  partnerName: string | null;
  contactDisplay: string | null;
  email: string | null;
  phone: string | null;
  channel: string;
  category: string | null;
  priority: string;
  status: string;
  teamId: string | null;
  userId: string | null;
  leadId: string | null;
  leadName: string | null;
  createdAt: string;
  firstResponseDue: string | null;
  resolveDue: string | null;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  firstResponseState: string;
  resolutionState: string;
  satisfaction: number | null;
  satisfactionNote: string | null;
  messages: Message[];
}

const dt = (v: string | null, locale: string) =>
  v
    ? new Date(v).toLocaleString(locale === "id" ? "id-ID" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

/** Detail tiket: percakapan (balasan / catatan internal), properti, dan SLA. */
export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const { l, locale } = useI18n();
  const editable = can(me.permissions, "support.write");
  const users = useOptions<{ id: string; name: string }>("/users/options");
  const teams = useOptions<{ id: string; name: string }>("/support/teams");
  const [t, setT] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [reply, setReply] = useState({ kind: "public" as "public" | "internal", body: "", status: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Ticket>(`/support/tickets/${id}`)
      .then(setT)
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
  const patch = (body: Record<string, unknown>) =>
    run(async () => {
      await api(`/support/tickets/${id}`, { method: "PATCH", body });
    });

  if (!t) return <p className={error ? "error" : "muted"}>{error ?? l("Memuat…", "Loading…")}</p>;
  const send = () =>
    run(async () => {
      const r = await api<{ emailed: boolean }>(`/support/tickets/${id}/messages`, {
        method: "POST",
        body: { kind: reply.kind, body: reply.body, status: reply.status || null },
      });
      toast.success(
        reply.kind === "internal"
          ? l("Catatan internal tersimpan", "Internal note saved")
          : r.emailed
            ? l("Balasan terkirim ke email pelanggan", "Reply emailed to the customer")
            : l("Balasan tersimpan (tiket tanpa email)", "Reply saved (ticket has no email)"),
      );
      setReply({ kind: reply.kind, body: "", status: "" });
    });
  const kindLabel: Record<Message["kind"], string> = {
    public: l("Balasan ke pelanggan", "Reply to customer"),
    internal: l("Catatan internal", "Internal note"),
    customer: l("Pelanggan", "Customer"),
  };

  return (
    <div className="form-layout">
      <div className="stack-wide">
        <section className="panel">
          <header className="toolbar">
            <h1>
              {t.number} · {t.subject}
            </h1>
            <span className="badge">{l(...TICKET_STATUS_LABEL[t.status]!)}</span>
            {editable && t.status !== "resolved" && t.status !== "closed" && (
              <button className="primary" disabled={busy} onClick={() => patch({ status: "resolved" })}>
                {l("Tandai selesai", "Resolve")}
              </button>
            )}
            {editable && (t.status === "resolved" || t.status === "closed") && (
              <button disabled={busy} onClick={() => patch({ status: "open" })}>
                {l("Buka kembali", "Reopen")}
              </button>
            )}
            {editable && t.status === "resolved" && (
              <button disabled={busy} onClick={() => patch({ status: "closed" })}>
                {l("Tutup", "Close")}
              </button>
            )}
          </header>
          {error && <p className="error">{error}</p>}
          <p className="filters">
            <SlaBadge state={t.firstResponseState} label={l("Respons pertama", "First response")} />
            <SlaBadge state={t.resolutionState} label={l("Penyelesaian", "Resolution")} />
          </p>
          {t.description && <p style={{ whiteSpace: "pre-wrap" }}>{t.description}</p>}
          <ul className="plain-list ticket-thread">
            {t.messages.map((m) => (
              <li key={m.id} className={`ticket-message ticket-${m.kind}`}>
                <strong>{m.authorName ?? "—"}</strong>{" "}
                <small className="muted">
                  {kindLabel[m.kind]} · {dt(m.createdAt, locale)}
                </small>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
              </li>
            ))}
          </ul>
          {editable && t.status !== "closed" && (
            <div className="stack">
              <div className="tabs">
                <button
                  className={reply.kind === "public" ? "active" : ""}
                  onClick={() => setReply({ ...reply, kind: "public" })}
                >
                  {l("Balas pelanggan", "Reply")}
                </button>
                <button
                  className={reply.kind === "internal" ? "active" : ""}
                  onClick={() => setReply({ ...reply, kind: "internal" })}
                >
                  {l("Catatan internal", "Internal note")}
                </button>
              </div>
              <textarea
                rows={4}
                aria-label={kindLabel[reply.kind]}
                placeholder={
                  reply.kind === "public"
                    ? t.email
                      ? l(`Dikirim ke ${t.email}`, `Sent to ${t.email}`)
                      : l(
                          "Tiket tanpa email: balasan hanya tersimpan",
                          "No email on ticket: reply is only stored",
                        )
                    : l("Hanya terlihat oleh tim", "Visible to the team only")
                }
                value={reply.body}
                onChange={(e) => setReply({ ...reply, body: e.target.value })}
              />
              <div className="filters">
                <label className="field">
                  <span>{l("Status sesudahnya", "Status after")}</span>
                  <select
                    value={reply.status}
                    onChange={(e) => setReply({ ...reply, status: e.target.value })}
                  >
                    <option value="">
                      {reply.kind === "public"
                        ? l("Otomatis (menunggu pelanggan)", "Automatic (waiting on customer)")
                        : l("Tidak berubah", "Unchanged")}
                    </option>
                    {TICKET_STATUS_VALUES.filter((s) => s !== "new").map((s) => (
                      <option key={s} value={s}>
                        {l(...TICKET_STATUS_LABEL[s]!)}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary" disabled={busy || !reply.body.trim()} onClick={send}>
                  {reply.kind === "public"
                    ? l("Kirim balasan", "Send reply")
                    : l("Simpan catatan", "Save note")}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
      <aside className="stack">
        <section className="panel">
          <h2>{l("Properti", "Properties")}</h2>
          <fieldset className="stack" disabled={!editable || busy}>
            <label className="field">
              <span>{l("Prioritas", "Priority")}</span>
              <select value={t.priority} onChange={(e) => patch({ priority: e.target.value })}>
                {TICKET_PRIORITY_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {l(...TICKET_PRIORITY_LABEL[v]!)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Antrean", "Queue")}</span>
              <select value={t.teamId ?? ""} onChange={(e) => patch({ teamId: e.target.value || null })}>
                <option value="">—</option>
                {teams.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Agen", "Agent")}</span>
              <select value={t.userId ?? ""} onChange={(e) => patch({ userId: e.target.value || null })}>
                <option value="">{l("Belum ditugaskan", "Unassigned")}</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          <table>
            <tbody>
              <tr>
                <th>{l("Pelanggan", "Customer")}</th>
                <td>
                  {t.partnerId ? <Link href={`/crm/accounts/${t.partnerId}`}>{t.partnerName}</Link> : "—"}
                </td>
              </tr>
              <tr>
                <th>{l("Kontak", "Contact")}</th>
                <td>{t.contactDisplay ?? "—"}</td>
              </tr>
              <tr>
                <th>{l("Email / telepon", "Email / phone")}</th>
                <td>{[t.email, t.phone].filter(Boolean).join(" · ") || "—"}</td>
              </tr>
              <tr>
                <th>{l("Kanal", "Channel")}</th>
                <td>{l(...TICKET_CHANNEL_LABEL[t.channel]!)}</td>
              </tr>
              {t.leadId && (
                <tr>
                  <th>{l("Peluang", "Opportunity")}</th>
                  <td>
                    <Link href={`/crm/leads/${t.leadId}`}>{t.leadName}</Link>
                  </td>
                </tr>
              )}
              <tr>
                <th>{l("Dibuat", "Created")}</th>
                <td>{dt(t.createdAt, locale)}</td>
              </tr>
              <tr>
                <th>{l("Batas respons", "Response due")}</th>
                <td>{dt(t.firstResponseDue, locale)}</td>
              </tr>
              <tr>
                <th>{l("Batas selesai", "Resolution due")}</th>
                <td>{dt(t.resolveDue, locale)}</td>
              </tr>
              {t.satisfaction !== null && (
                <tr>
                  <th>{l("Kepuasan", "Satisfaction")}</th>
                  <td>
                    {"★".repeat(t.satisfaction)}
                    {t.satisfactionNote ? ` — ${t.satisfactionNote}` : ""}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <Chatter model="support_ticket" id={t.id} version={version} labels={{}} />
      </aside>
    </div>
  );
}
