"use client";

import Link from "next/link";
import { REQUEST_STATE_LABEL } from "@erp/shared";
import { useCallback, useEffect, useState } from "react";
import { DataTable } from "../../../../components/data-table";
import { toast } from "../../../../components/feedback";
import { priorityLabel, StateBadge } from "../../../../components/maintenance/maintenance-panels";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Row {
  id: string;
  name: string;
  title: string;
  kind: "preventive" | "corrective";
  state: string;
  priority: string;
  scheduledDate: string | null;
  createdAt: string;
  technician: string | null;
  equipment: string;
  equipmentCode: string;
  downtimeHours: string | null;
  totalCost: string;
}

/** Maintenance › Permintaan: semua work order perawatan (preventif & korektif). */
export default function MaintenanceRequestsPage() {
  const { l, locale } = useI18n();
  const me = useMe();
  const i = locale === "id" ? 0 : 1;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<Row[]>("/maintenance-requests?limit=5000")
      .then(setRows)
      .catch((e: Error) => toast.error(e.message));
  }, []);
  useEffect(load, [load]);

  async function generate() {
    setBusy(true);
    try {
      const r = await api<{ created: number }>("/maintenance/generate", { method: "POST" });
      toast.success(
        l(`${r.created} permintaan preventif dibuat.`, `${r.created} preventive request(s) created.`),
      );
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <h1>{l("Permintaan Perawatan", "Maintenance Requests")}</h1>
          {can(me.permissions, "maintenance.write") && (
            <Link className="button primary" href="/maintenance/requests/new">
              {l("Baru", "New")}
            </Link>
          )}
          {can(me.permissions, "maintenance.manage") && (
            <button type="button" onClick={generate} disabled={busy} aria-busy={busy}>
              {l("Buat dari rencana jatuh tempo", "Generate from due plans")}
            </button>
          )}
        </div>
      </header>
      {rows && (
        <DataTable
          rows={rows}
          storageKey="maintenance-requests"
          rowKey={(r) => r.id}
          rowHref={(r) => `/maintenance/requests/${r.id}`}
          initialFilters={{ state: { kind: "enum", values: ["new", "scheduled", "in_progress"] } }}
          empty={l("Belum ada permintaan perawatan.", "No maintenance requests yet.")}
          columns={[
            {
              key: "name",
              label: l("Nomor", "Number"),
              value: (r) => r.name,
              render: (r) => <Link href={`/maintenance/requests/${r.id}`}>{r.name}</Link>,
            },
            { key: "title", label: l("Judul", "Title"), value: (r) => r.title },
            {
              key: "equipment",
              label: l("Peralatan", "Equipment"),
              value: (r) => `${r.equipmentCode} ${r.equipment}`,
            },
            {
              key: "kind",
              label: l("Jenis", "Type"),
              type: "enum",
              value: (r) => r.kind,
              optionLabel: (v) =>
                v === "preventive" ? l("Preventif", "Preventive") : l("Korektif", "Corrective"),
              text: (r) =>
                r.kind === "preventive" ? l("Preventif", "Preventive") : l("Korektif", "Corrective"),
            },
            {
              key: "priority",
              label: l("Prioritas", "Priority"),
              type: "enum",
              value: (r) => r.priority,
              optionLabel: (v) => priorityLabel(v, locale),
              text: (r) => priorityLabel(r.priority, locale),
            },
            {
              key: "scheduledDate",
              label: l("Jadwal", "Scheduled"),
              type: "date",
              value: (r) => r.scheduledDate,
              text: (r) => (r.scheduledDate ? formatDate(r.scheduledDate, locale) : "—"),
            },
            { key: "technician", label: l("Teknisi", "Technician"), value: (r) => r.technician },
            {
              key: "totalCost",
              label: l("Biaya", "Cost"),
              type: "number",
              value: (r) => Number(r.totalCost),
              text: (r) => money(r.totalCost, locale),
            },
            {
              key: "state",
              label: l("Status", "Status"),
              type: "enum",
              value: (r) => r.state,
              optionLabel: (v) => REQUEST_STATE_LABEL[v]?.[i] ?? v,
              render: (r) => <StateBadge state={r.state} />,
            },
          ]}
        />
      )}
    </>
  );
}
