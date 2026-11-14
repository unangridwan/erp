"use client";

import Link from "next/link";
import { ALERT_STATE_LABEL } from "@erp/shared";
import { useEffect, useState } from "react";
import { DataTable } from "../../../../components/data-table";
import { toast } from "../../../../components/feedback";
import { useMe } from "../../../../components/me-context";
import { QualityBadge } from "../../../../components/quality/quality-ui";
import { api } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Row {
  id: string;
  name: string;
  title: string;
  state: string;
  product: string | null;
  partner: string | null;
  responsible: string | null;
  createdAt: string;
}

/** Mutu › Ketidaksesuaian (NCR): dibuat otomatis saat pemeriksaan gagal, atau manual. */
export default function QualityAlertsPage() {
  const { l, locale } = useI18n();
  const me = useMe();
  const i = locale === "id" ? 0 : 1;
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    api<Row[]>("/quality-alerts").then(setRows, (e: Error) => toast.error(e.message));
  }, []);
  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <h1>{l("Ketidaksesuaian (NCR)", "Non-conformances (NCR)")}</h1>
          {can(me.permissions, "quality.write") && (
            <Link className="button primary" href="/quality/alerts/new">
              {l("Baru", "New")}
            </Link>
          )}
        </div>
      </header>
      {rows && (
        <DataTable
          rows={rows}
          storageKey="quality-alerts"
          rowKey={(r) => r.id}
          rowHref={(r) => `/quality/alerts/${r.id}`}
          initialFilters={{ state: { kind: "enum", values: ["open", "in_progress"] } }}
          empty={l("Belum ada NCR.", "No NCRs yet.")}
          columns={[
            {
              key: "name",
              label: l("Nomor", "Number"),
              value: (r) => r.name,
              render: (r) => <Link href={`/quality/alerts/${r.id}`}>{r.name}</Link>,
            },
            { key: "title", label: l("Judul", "Title"), value: (r) => r.title },
            { key: "product", label: l("Produk", "Product"), value: (r) => r.product },
            { key: "partner", label: l("Pemasok", "Supplier"), value: (r) => r.partner },
            { key: "responsible", label: l("Penanggung jawab", "Responsible"), value: (r) => r.responsible },
            {
              key: "createdAt",
              label: l("Tanggal", "Date"),
              type: "date",
              value: (r) => r.createdAt.slice(0, 10),
              text: (r) => formatDate(r.createdAt.slice(0, 10), locale),
            },
            {
              key: "state",
              label: l("Status", "Status"),
              type: "enum",
              value: (r) => r.state,
              optionLabel: (v) => ALERT_STATE_LABEL[v]?.[i] ?? v,
              render: (r) => <QualityBadge state={r.state} />,
            },
          ]}
        />
      )}
    </>
  );
}
