"use client";

import {
  TICKET_CHANNEL_LABEL,
  TICKET_CHANNEL_VALUES,
  TICKET_PRIORITY_LABEL,
  TICKET_PRIORITY_VALUES,
  TICKET_STATUS_LABEL,
} from "@erp/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { RefSelect } from "../../../../components/ref-select";
import { DataTable, type DataColumn } from "../../../../components/data-table";
import { useMe } from "../../../../components/me-context";
import { SlaBadge } from "../../../../components/support/sla-badge";
import { api, ApiError } from "../../../../lib/api";
import { formatDate, localDay } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { truncatedNote, useListData } from "../../../../lib/use-list-data";

interface Row {
  id: string;
  number: string;
  subject: string;
  status: string;
  priority: string;
  channel: string;
  partnerName: string | null;
  contactName: string | null;
  userId: string | null;
  userName: string | null;
  teamName: string | null;
  createdAt: string;
  firstResponseState: string;
  resolutionState: string;
}
const OPEN = ["new", "open", "pending"];

/** Daftar tiket (dimuat sekali, difilter di browser) + form tiket baru. */
export default function TicketsPage() {
  const me = useMe();
  const router = useRouter();
  const { l, locale } = useI18n();
  const editable = can(me.permissions, "support.write");
  const list = useListData<Row>("/support/tickets");
  const [draft, setDraft] = useState<{
    subject: string;
    partnerId: string;
    priority: string;
    channel: string;
    description: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const columns = useMemo<DataColumn<Row>[]>(() => {
    const lbl = (map: Record<string, [string, string]>) => (v: string | null) =>
      v && map[v] ? l(...map[v]!) : (v ?? "");
    return [
      {
        key: "number",
        label: l("Nomor", "Number"),
        value: (x) => x.number,
        render: (x) => <Link href={`/support/tickets/${x.id}`}>{x.number}</Link>,
      },
      { key: "subject", label: l("Subjek", "Subject"), value: (x) => x.subject },
      {
        key: "customer",
        label: l("Pelanggan", "Customer"),
        value: (x) => x.partnerName ?? x.contactName,
      },
      {
        key: "priority",
        label: l("Prioritas", "Priority"),
        type: "enum",
        value: (x) => x.priority,
        optionLabel: lbl(TICKET_PRIORITY_LABEL),
        text: (x) => lbl(TICKET_PRIORITY_LABEL)(x.priority),
        render: (x) => (
          <span
            className={`badge ${x.priority === "urgent" ? "state-cancel" : x.priority === "high" ? "state-lost" : ""}`}
          >
            {lbl(TICKET_PRIORITY_LABEL)(x.priority)}
          </span>
        ),
      },
      {
        key: "status",
        label: l("Status", "Status"),
        type: "enum",
        value: (x) => x.status,
        optionLabel: lbl(TICKET_STATUS_LABEL),
        text: (x) => lbl(TICKET_STATUS_LABEL)(x.status),
      },
      {
        key: "sla",
        label: "SLA",
        type: "enum",
        value: (x) =>
          [x.firstResponseState, x.resolutionState].includes("breached")
            ? "breached"
            : [x.firstResponseState, x.resolutionState].includes("at_risk")
              ? "at_risk"
              : "ok",
        optionLabel: (v) =>
          v === "breached"
            ? l("Terlewati", "Breached")
            : v === "at_risk"
              ? l("Hampir lewat", "At risk")
              : l("Aman", "OK"),
        render: (x) => (
          <SlaBadge
            state={
              x.firstResponseState === "breached" || x.resolutionState === "breached"
                ? "breached"
                : x.firstResponseState === "at_risk" || x.resolutionState === "at_risk"
                  ? "at_risk"
                  : OPEN.includes(x.status)
                    ? "on_track"
                    : x.resolutionState
            }
          />
        ),
      },
      { key: "user", label: l("Agen", "Agent"), type: "enum", value: (x) => x.userName },
      { key: "team", label: l("Antrean", "Queue"), type: "enum", value: (x) => x.teamName, hidden: true },
      {
        key: "channel",
        label: l("Kanal", "Channel"),
        type: "enum",
        value: (x) => x.channel,
        optionLabel: lbl(TICKET_CHANNEL_LABEL),
        text: (x) => lbl(TICKET_CHANNEL_LABEL)(x.channel),
        hidden: true,
      },
      {
        key: "createdAt",
        label: l("Dibuat", "Created"),
        type: "date",
        value: (x) => localDay(x.createdAt),
        text: (x) => formatDate(x.createdAt, locale),
      },
    ];
  }, [l, locale]);

  async function create() {
    if (!draft) return;
    setError(null);
    try {
      const t = await api<{ id: string }>("/support/tickets", {
        method: "POST",
        body: {
          subject: draft.subject,
          partnerId: draft.partnerId || null,
          priority: draft.priority,
          channel: draft.channel,
          description: draft.description || null,
        },
      });
      router.push(`/support/tickets/${t.id}`);
    } catch (e) {
      setError(
        e instanceof ApiError && Object.keys(e.fieldErrors).length
          ? Object.values(e.fieldErrors).join("; ")
          : String(e instanceof Error ? e.message : e),
      );
    }
  }

  return (
    <>
      <header className="toolbar">
        <h1>{l("Tiket", "Tickets")}</h1>
        {editable && (
          <button
            className="primary"
            onClick={() =>
              setDraft({ subject: "", partnerId: "", priority: "normal", channel: "phone", description: "" })
            }
          >
            {l("Baru", "New")}
          </button>
        )}
      </header>
      {(error || list.error) && <p className="error">{error ?? list.error}</p>}
      {draft && (
        <section className="panel">
          <div className="fields">
            <label className="field">
              <span>{l("Subjek *", "Subject *")}</span>
              <input
                autoFocus
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("Pelanggan", "Customer")}</span>
              <RefSelect
                name="partnerId"
                resource="partners"
                display="name"
                value={draft.partnerId}
                onChange={(v) => setDraft({ ...draft, partnerId: v })}
              />
            </label>
            <label className="field">
              <span>{l("Prioritas", "Priority")}</span>
              <select
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
              >
                {TICKET_PRIORITY_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {l(...TICKET_PRIORITY_LABEL[v]!)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Kanal", "Channel")}</span>
              <select value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value })}>
                {TICKET_CHANNEL_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {l(...TICKET_CHANNEL_LABEL[v]!)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>{l("Uraian masalah", "Description")}</span>
              <textarea
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
          </div>
          <div className="filters">
            <button className="primary" disabled={!draft.subject.trim()} onClick={create}>
              {l("Buat tiket", "Create ticket")}
            </button>
            <button className="link" onClick={() => setDraft(null)}>
              {l("Batal", "Cancel")}
            </button>
          </div>
        </section>
      )}
      {!list.loading || list.rows.length ? (
        <DataTable
          rows={list.rows}
          columns={columns}
          storageKey="support-tickets"
          rowKey={(x) => x.id}
          rowHref={(x) => `/support/tickets/${x.id}`}
          defaultSort={{ key: "createdAt", dir: "desc" }}
          initialFilters={{ status: { kind: "enum", values: OPEN } }}
          note={truncatedNote(list, l)}
          searchPlaceholder={l("Cari nomor, subjek, pelanggan…", "Search number, subject, customer…")}
          empty={l("Belum ada tiket.", "No tickets yet.")}
        />
      ) : (
        <p className="muted">{l("Memuat…", "Loading…")}</p>
      )}
    </>
  );
}
