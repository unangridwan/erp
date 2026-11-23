"use client";

import {
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_VALUES,
  CAMPAIGN_TYPE_LABEL,
  CAMPAIGN_TYPE_VALUES,
} from "@erp/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { DataTable, type DataColumn } from "../../../../components/data-table";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Row {
  id: string;
  name: string;
  campaignType: string;
  status: string;
  dateStart: string | null;
  dateEnd: string | null;
  actualCost: string;
  members: number;
  leads: number;
  opportunities: number;
  won: number;
  wonAmount: string;
  roi: number | null;
}

/** Daftar kampanye dengan hasil (lead, peluang, menang, ROI). */
export default function CampaignsPage() {
  const me = useMe();
  const router = useRouter();
  const { l, locale } = useI18n();
  const editable = can(me.permissions, "crm.write");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; campaignType: string } | null>(null);

  useEffect(() => {
    api<{ items: Row[] }>("/crm/campaign-stats")
      .then((d) => setRows(d.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        key: "name",
        label: l("Kampanye", "Campaign"),
        value: (x) => x.name,
        render: (x) => <Link href={`/crm/campaigns/${x.id}`}>{x.name}</Link>,
      },
      {
        key: "type",
        label: l("Jenis", "Type"),
        type: "enum",
        value: (x) => x.campaignType,
        optionLabel: (v) => (CAMPAIGN_TYPE_LABEL[v] ? l(...CAMPAIGN_TYPE_LABEL[v]!) : v),
        text: (x) => l(...CAMPAIGN_TYPE_LABEL[x.campaignType]!),
      },
      {
        key: "status",
        label: l("Status", "Status"),
        type: "enum",
        value: (x) => x.status,
        optionLabel: (v) => (CAMPAIGN_STATUS_LABEL[v] ? l(...CAMPAIGN_STATUS_LABEL[v]!) : v),
        text: (x) => l(...CAMPAIGN_STATUS_LABEL[x.status]!),
      },
      {
        key: "dateStart",
        label: l("Mulai", "Start"),
        type: "date",
        value: (x) => x.dateStart,
        text: (x) => (x.dateStart ? formatDate(x.dateStart, locale) : ""),
      },
      {
        key: "members",
        label: l("Anggota", "Members"),
        type: "number",
        className: "num",
        value: (x) => x.members,
      },
      { key: "leads", label: l("Lead", "Leads"), type: "number", className: "num", value: (x) => x.leads },
      { key: "won", label: l("Menang", "Won"), type: "number", className: "num", value: (x) => x.won },
      {
        key: "wonAmount",
        label: l("Nilai menang", "Won value"),
        type: "number",
        className: "num",
        value: (x) => Number(x.wonAmount),
        text: (x) => money(x.wonAmount, locale, 0),
      },
      {
        key: "cost",
        label: l("Biaya", "Cost"),
        type: "number",
        className: "num",
        value: (x) => Number(x.actualCost),
        text: (x) => money(x.actualCost, locale, 0),
      },
      {
        key: "roi",
        label: "ROI",
        type: "number",
        className: "num",
        value: (x) => x.roi,
        text: (x) => (x.roi === null ? "—" : `${x.roi}%`),
      },
    ],
    [l, locale],
  );

  async function create() {
    if (!form) return;
    try {
      const created = await api<{ id: string }>("/crm/campaigns", { method: "POST", body: form });
      router.push(`/crm/campaigns/${created.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : String(e));
    }
  }

  return (
    <>
      <header className="toolbar">
        <h1>{l("Kampanye", "Campaigns")}</h1>
        {editable && (
          <button className="primary" onClick={() => setForm({ name: "", campaignType: "email" })}>
            {l("Baru", "New")}
          </button>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {form && (
        <div className="inline-panel">
          <label className="field">
            <span>{l("Nama kampanye", "Campaign name")}</span>
            <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">
            <span>{l("Jenis", "Type")}</span>
            <select
              value={form.campaignType}
              onChange={(e) => setForm({ ...form, campaignType: e.target.value })}
            >
              {CAMPAIGN_TYPE_VALUES.map((v) => (
                <option key={v} value={v}>
                  {l(...CAMPAIGN_TYPE_LABEL[v]!)}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={!form.name.trim()} onClick={create}>
            {l("Buat", "Create")}
          </button>
          <button className="link" onClick={() => setForm(null)}>
            {l("Batal", "Cancel")}
          </button>
        </div>
      )}
      {rows ? (
        <DataTable
          rows={rows}
          columns={columns}
          storageKey="crm-campaigns"
          rowKey={(x) => x.id}
          rowHref={(x) => `/crm/campaigns/${x.id}`}
          defaultSort={{ key: "dateStart", dir: "desc" }}
          initialFilters={{
            status: { kind: "enum", values: CAMPAIGN_STATUS_VALUES.filter((s) => s !== "cancelled") },
          }}
          searchPlaceholder={l("Cari kampanye…", "Search campaigns…")}
          empty={l("Belum ada kampanye.", "No campaigns yet.")}
        />
      ) : (
        !error && <p className="muted">{l("Memuat…", "Loading…")}</p>
      )}
    </>
  );
}
