"use client";

import Link from "next/link";
import { QUALITY_TRIGGER_LABEL } from "@erp/shared";
import { useEffect, useState } from "react";
import { DataTable } from "../../../../components/data-table";
import { toast } from "../../../../components/feedback";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Row {
  id: string;
  name: string;
  trigger: string;
  productId: string | null;
  categoryId: string | null;
  partnerId: string | null;
  sampling: string;
  sampleValue: string | null;
  items: unknown[];
  active: boolean;
}

/** Mutu › Titik Kontrol: kapan & apa yang diperiksa. */
export default function QualityPointsPage() {
  const { l, locale } = useI18n();
  const me = useMe();
  const i = locale === "id" ? 0 : 1;
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    api<{ items: Row[] }>("/quality-points?limit=5000").then(
      (r) => setRows(r.items),
      (e: Error) => toast.error(e.message),
    );
  }, []);
  const sampling = (r: Row) =>
    r.sampling === "all"
      ? l("Semua", "All")
      : r.sampling === "percent"
        ? `${Number(r.sampleValue)}%`
        : l(`${Number(r.sampleValue)} unit`, `${Number(r.sampleValue)} units`);
  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <h1>{l("Titik Kontrol Mutu", "Quality Control Points")}</h1>
          {can(me.permissions, "quality.manage") && (
            <Link className="button primary" href="/quality/points/new">
              {l("Baru", "New")}
            </Link>
          )}
        </div>
      </header>
      {rows && (
        <DataTable
          rows={rows}
          storageKey="quality-points"
          rowKey={(r) => r.id}
          rowHref={(r) => `/quality/points/${r.id}`}
          empty={l("Belum ada titik kontrol.", "No control points yet.")}
          columns={[
            {
              key: "name",
              label: l("Nama", "Name"),
              value: (r) => r.name,
              render: (r) => <Link href={`/quality/points/${r.id}`}>{r.name}</Link>,
            },
            {
              key: "trigger",
              label: l("Saat", "When"),
              type: "enum",
              value: (r) => r.trigger,
              optionLabel: (v) => QUALITY_TRIGGER_LABEL[v]?.[i] ?? v,
              text: (r) => QUALITY_TRIGGER_LABEL[r.trigger]?.[i] ?? r.trigger,
            },
            { key: "sampling", label: l("Sampel", "Sample"), value: (r) => sampling(r) },
            { key: "items", label: l("Butir", "Items"), type: "number", value: (r) => r.items.length },
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
