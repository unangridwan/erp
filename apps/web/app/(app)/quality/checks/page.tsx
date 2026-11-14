"use client";

import Link from "next/link";
import { CHECK_STATE_LABEL, QUALITY_TRIGGER_LABEL } from "@erp/shared";
import { useEffect, useState } from "react";
import { DataTable } from "../../../../components/data-table";
import { toast } from "../../../../components/feedback";
import { QualityBadge } from "../../../../components/quality/quality-ui";
import { api } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Row {
  id: string;
  name: string;
  trigger: string;
  state: string;
  quantity: string;
  sampleQty: string;
  product: string;
  sku: string;
  partner: string | null;
  picking: string | null;
  createdAt: string;
}

/** Mutu › Pemeriksaan: barang yang ditahan di karantina menunggu hasil inspeksi. */
export default function QualityChecksPage() {
  const { l, locale } = useI18n();
  const i = locale === "id" ? 0 : 1;
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    api<Row[]>("/quality-checks?limit=5000").then(setRows, (e: Error) => toast.error(e.message));
  }, []);
  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <h1>{l("Pemeriksaan Mutu", "Quality Checks")}</h1>
        </div>
      </header>
      <p className="muted">
        {l(
          "Pemeriksaan dibuat otomatis saat barang dengan titik kontrol diterima dari pemasok atau selesai diproduksi. Barang ditahan di lokasi Karantina sampai diputuskan.",
          "Checks are created automatically when goods with a control point are received or produced. Goods are held in the Quarantine location until a decision is made.",
        )}
      </p>
      {rows && (
        <DataTable
          rows={rows}
          storageKey="quality-checks"
          rowKey={(r) => r.id}
          rowHref={(r) => `/quality/checks/${r.id}`}
          initialFilters={{ state: { kind: "enum", values: ["pending"] } }}
          empty={l("Belum ada pemeriksaan mutu.", "No quality checks yet.")}
          columns={[
            {
              key: "name",
              label: l("Nomor", "Number"),
              value: (r) => r.name,
              render: (r) => <Link href={`/quality/checks/${r.id}`}>{r.name}</Link>,
            },
            { key: "product", label: l("Produk", "Product"), value: (r) => `${r.sku} ${r.product}` },
            {
              key: "trigger",
              label: l("Sumber", "Source"),
              type: "enum",
              value: (r) => r.trigger,
              optionLabel: (v) => QUALITY_TRIGGER_LABEL[v]?.[i] ?? v,
              text: (r) => QUALITY_TRIGGER_LABEL[r.trigger]?.[i] ?? r.trigger,
            },
            { key: "partner", label: l("Pemasok", "Supplier"), value: (r) => r.partner },
            { key: "picking", label: l("Dokumen", "Document"), value: (r) => r.picking },
            {
              key: "quantity",
              label: l("Jumlah / sampel", "Qty / sample"),
              type: "number",
              value: (r) => Number(r.quantity),
              text: (r) => `${Number(r.quantity)} / ${Number(r.sampleQty)}`,
            },
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
              optionLabel: (v) => CHECK_STATE_LABEL[v]?.[i] ?? v,
              render: (r) => <QualityBadge state={r.state} />,
            },
          ]}
        />
      )}
    </>
  );
}
