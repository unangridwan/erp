"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatDate, money, localDay } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { can, LEAD_SOURCES, LEAD_STATE_LABEL } from "../../lib/resources";
import { truncatedNote, useListData } from "../../lib/use-list-data";
import { DataTable, type DataColumn } from "../data-table";
import { useMe } from "../me-context";
import { LEAD_STATUS_LABEL, scoreGrade } from "@erp/shared";
import { Stars, type LeadRow } from "./pipeline";

/**
 * Daftar lead & peluang (tabel): semua lead dimuat sekali; jenis, status, sumber, tahap, dll. difilter di browser
 * tanpa memanggil API lagi.
 */
export function LeadList({ type }: { type?: "lead" | "opportunity" }) {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const [leadType, setLeadType] = useState<string>(type ?? "lead");
  const [search, setSearch] = useState("");
  const list = useListData<LeadRow>("/leads", {}, search);
  const rows = useMemo(
    () => (leadType ? list.rows.filter((x) => x.leadType === leadType) : list.rows),
    [list.rows, leadType],
  );

  const columns = useMemo<DataColumn<LeadRow>[]>(() => {
    const source = (s: string | null) => {
      const found = LEAD_SOURCES.find(([v]) => v === s);
      return found ? tx(found[1]) : "";
    };
    return [
      {
        key: "name",
        label: l("Nama", "Name"),
        value: (x) => x.name,
        render: (x) => (
          <>
            <Link href={`/crm/leads/${x.id}`}>{x.name}</Link> <Stars n={x.priority} />
          </>
        ),
      },
      {
        key: "partner",
        label: l("Pelanggan / kontak", "Customer / contact"),
        value: (x) => [x.partnerDisplay, x.contactName].filter(Boolean).join(" · ") || null,
      },
      { key: "email", label: l("Email", "Email"), value: (x) => x.email },
      {
        key: "score",
        label: l("Skor", "Score"),
        type: "number",
        className: "num",
        value: (x) => x.score,
        text: (x) => `${x.score} · ${scoreGrade(x.score)}`,
        hidden: type === "opportunity",
      },
      { key: "phone", label: l("Telepon", "Phone"), value: (x) => x.phone, hidden: true },
      {
        key: "source",
        label: l("Sumber", "Source"),
        type: "enum",
        value: (x) => x.source,
        text: (x) => source(x.source),
      },
      {
        key: "leadStatus",
        label: l("Status lead", "Lead status"),
        type: "enum",
        value: (x) => x.leadStatus,
        optionLabel: (v) => (LEAD_STATUS_LABEL[v] ? l(...LEAD_STATUS_LABEL[v]!) : v),
        text: (x) =>
          LEAD_STATUS_LABEL[x.leadStatus] ? l(...LEAD_STATUS_LABEL[x.leadStatus]!) : x.leadStatus,
        hidden: type === "opportunity",
      },
      {
        key: "stage",
        label: l("Tahap", "Stage"),
        type: "enum",
        value: (x) => x.stageName,
        hidden: type === "lead",
      },
      {
        key: "nextStep",
        label: l("Langkah berikut", "Next step"),
        value: (x) => x.nextStep,
        hidden: type !== "opportunity",
      },
      { key: "user", label: l("Penanggung jawab", "Salesperson"), type: "enum", value: (x) => x.userName },
      {
        key: "priority",
        label: l("Prioritas", "Priority"),
        type: "enum",
        value: (x) => String(x.priority),
        text: (x) => "★".repeat(x.priority) || "–",
        hidden: true,
      },
      {
        key: "expectedRevenue",
        label: l("Pendapatan harapan", "Expected revenue"),
        type: "number",
        className: "num",
        value: (x) => Number(x.expectedRevenue),
        text: (x) => money(x.expectedRevenue, locale),
      },
      {
        key: "createdAt",
        label: l("Dibuat", "Created"),
        type: "date",
        value: (x) => localDay(x.createdAt),
        text: (x) => formatDate(x.createdAt, locale),
      },
      {
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (x) => x.state,
        optionLabel: (v) => (LEAD_STATE_LABEL[v] ? tx(LEAD_STATE_LABEL[v]!) : v),
        text: (x) => (LEAD_STATE_LABEL[x.state] ? tx(LEAD_STATE_LABEL[x.state]!) : x.state),
        render: (x) => <span className={`badge state-${x.state}`}>{tx(LEAD_STATE_LABEL[x.state]!)}</span>,
      },
    ];
  }, [l, tx, locale, type]);

  return (
    <>
      <header className="toolbar">
        <h1>
          {type === "lead"
            ? l("Lead", "Leads")
            : type === "opportunity"
              ? l("Peluang", "Opportunities")
              : l("Lead & Peluang", "Leads & Opportunities")}
        </h1>
        {can(me.permissions, "crm.write") && (
          <Link className="button primary" href={`/crm/leads/new?type=${leadType || "lead"}`}>
            {l("Baru", "New")}
          </Link>
        )}
      </header>
      {list.error && <p className="error">{list.error}</p>}
      {!list.loading || list.rows.length ? (
        <DataTable
          customModel="crm_lead"
          rows={rows}
          columns={columns}
          storageKey={type === "opportunity" ? "opportunities" : "leads"}
          rowKey={(x) => x.id}
          rowHref={(x) => `/crm/leads/${x.id}`}
          defaultSort={{ key: "createdAt", dir: "desc" }}
          initialFilters={{ state: { kind: "enum", values: ["open"] } }}
          note={truncatedNote(list, l)}
          onSearch={setSearch}
          searchPlaceholder={l("Cari nama, pelanggan, email…", "Search name, customer, email…")}
          empty={l("Belum ada data.", "No records yet.")}
          tools={
            type ? undefined : (
              <select
                aria-label={l("Jenis", "Type")}
                value={leadType}
                onChange={(e) => setLeadType(e.target.value)}
              >
                <option value="lead">{l("Lead", "Leads")}</option>
                <option value="opportunity">{l("Peluang", "Opportunities")}</option>
                <option value="">{l("Lead & peluang", "Leads & opportunities")}</option>
              </select>
            )
          }
        />
      ) : (
        <p className="muted">{l("Memuat…", "Loading…")}</p>
      )}
    </>
  );
}
