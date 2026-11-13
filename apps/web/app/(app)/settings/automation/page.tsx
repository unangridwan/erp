"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AUTOMATION_TRIGGER_LABEL,
  CUSTOM_FIELD_MODELS,
  type AutomationTrigger,
  type CustomFieldModel,
} from "@erp/shared";
import { RUN_STATUS } from "../../../../components/automation/run-status";
import { DataTable } from "../../../../components/data-table";
import { toast } from "../../../../components/feedback";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

interface RuleRow {
  id: string;
  name: string;
  description: string | null;
  model: CustomFieldModel;
  trigger: AutomationTrigger;
  active: boolean;
  lastRunAt: string | null;
  lastRun: { status: "success" | "failed" | "skipped"; at: string } | null;
}

/** Pengaturan › Aturan Otomatis: daftar aturan pemicu → syarat → aksi. */
export default function AutomationRulesPage() {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<RuleRow[] | null>(null);
  const i = locale === "id" ? 0 : 1;
  const fmt = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
    dateStyle: "short",
    timeStyle: "short",
  });

  useEffect(() => {
    api<RuleRow[]>("/automation-rules")
      .then(setRows)
      .catch((e: Error) => toast.error(e.message));
  }, []);

  const modelLabel = (m: string) => CUSTOM_FIELD_MODELS[m as CustomFieldModel]?.label[i] ?? m;
  const triggerLabel = (t: string) => AUTOMATION_TRIGGER_LABEL[t as AutomationTrigger]?.[i] ?? t;

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <h1>{l("Aturan Otomatis", "Automation Rules")}</h1>
          <Link className="button primary" href="/settings/automation/new">
            {l("Baru", "New")}
          </Link>
        </div>
      </header>
      <p className="muted">
        {l(
          "Jalankan aksi otomatis saat data dibuat atau berubah, menjelang tanggal tertentu, atau terjadwal: kirim notifikasi & email, ubah field, buat aktivitas, minta persetujuan, atau panggil webhook.",
          "Run actions automatically when records are created or change, ahead of a date, or on a schedule: send notifications & email, set fields, create activities, request approval, or call a webhook.",
        )}
      </p>
      {rows && (
        <DataTable
          rows={rows}
          storageKey="automation-rules"
          rowKey={(r) => r.id}
          rowHref={(r) => `/settings/automation/${r.id}`}
          empty={l("Belum ada aturan otomatis.", "No automation rules yet.")}
          columns={[
            {
              key: "name",
              label: l("Nama", "Name"),
              value: (r) => r.name,
              render: (r) => <Link href={`/settings/automation/${r.id}`}>{r.name}</Link>,
            },
            {
              key: "model",
              label: l("Data", "Record"),
              type: "enum",
              value: (r) => r.model,
              optionLabel: modelLabel,
              text: (r) => modelLabel(r.model),
            },
            {
              key: "trigger",
              label: l("Pemicu", "Trigger"),
              type: "enum",
              value: (r) => r.trigger,
              optionLabel: triggerLabel,
              text: (r) => triggerLabel(r.trigger),
            },
            {
              key: "lastRun",
              label: l("Eksekusi terakhir", "Last run"),
              type: "date",
              value: (r) => r.lastRun?.at ?? null,
              render: (r) =>
                r.lastRun ? (
                  <>
                    <span className={`badge ${RUN_STATUS[r.lastRun.status]?.[2] ?? ""}`}>
                      {RUN_STATUS[r.lastRun.status]?.[i] ?? r.lastRun.status}
                    </span>{" "}
                    <small className="muted">{fmt.format(new Date(r.lastRun.at))}</small>
                  </>
                ) : (
                  <span className="muted">—</span>
                ),
            },
            {
              key: "active",
              label: l("Status", "Status"),
              type: "enum",
              value: (r) => (r.active ? "active" : "inactive"),
              optionLabel: (v) => (v === "active" ? l("Aktif", "Active") : l("Nonaktif", "Inactive")),
              render: (r) =>
                r.active ? (
                  <span className="badge success">{l("Aktif", "Active")}</span>
                ) : (
                  <span className="badge">{l("Nonaktif", "Inactive")}</span>
                ),
            },
          ]}
        />
      )}
    </>
  );
}
