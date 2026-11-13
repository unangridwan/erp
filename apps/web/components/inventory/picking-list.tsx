"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatDate } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { can, PICKING_KINDS, PICKING_STATE_LABEL, type PickingKind } from "../../lib/resources";
import { truncatedNote, useListData } from "../../lib/use-list-data";
import { DataTable, type DataColumn } from "../data-table";
import { useMe } from "../me-context";

interface Row {
  id: string;
  name: string;
  state: string;
  scheduledDate: string;
  dateDone: string | null;
  origin: string | null;
  partnerName: string | null;
  warehouseCode: string;
  backorderOfId: string | null;
  returnOfId: string | null;
}

/**
 * Transfer stok per jenis: semua status dimuat sekali, filter awal "belum selesai" (draft & siap) bisa diubah di panel
 * filter tanpa memanggil API lagi.
 */
export function PickingList({ kind }: { kind: PickingKind }) {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const def = PICKING_KINDS[kind];
  const [search, setSearch] = useState("");
  const list = useListData<Row>("/pickings", { pickingType: def.type }, search);

  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        key: "name",
        label: l("Nomor", "Reference"),
        value: (p) => p.name,
        render: (p) => (
          <>
            <Link href={`/inventory/pickings/${p.id}`}>{p.name}</Link>
            {p.backorderOfId && <small className="muted"> · backorder</small>}
            {p.returnOfId && <small className="muted"> · {l("retur", "return")}</small>}
          </>
        ),
      },
      { key: "partner", label: l("Partner", "Partner"), value: (p) => p.partnerName },
      { key: "origin", label: l("Dokumen asal", "Source document"), value: (p) => p.origin },
      { key: "warehouse", label: l("Gudang", "Warehouse"), type: "enum", value: (p) => p.warehouseCode },
      {
        key: "scheduledDate",
        label: l("Jadwal", "Scheduled"),
        type: "date",
        value: (p) => p.scheduledDate,
        text: (p) => formatDate(p.scheduledDate, locale),
      },
      {
        key: "dateDone",
        label: l("Selesai", "Done"),
        type: "date",
        value: (p) => p.dateDone?.slice(0, 10) ?? null,
        text: (p) => (p.dateDone ? formatDate(p.dateDone.slice(0, 10), locale) : ""),
      },
      {
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (p) => p.state,
        optionLabel: (v) => (PICKING_STATE_LABEL[v] ? tx(PICKING_STATE_LABEL[v]!) : v),
        text: (p) => (PICKING_STATE_LABEL[p.state] ? tx(PICKING_STATE_LABEL[p.state]!) : p.state),
        render: (p) => (
          <span className={`badge state-${p.state === "done" ? "posted" : p.state}`}>
            {tx(PICKING_STATE_LABEL[p.state]!)}
          </span>
        ),
      },
    ],
    [l, tx, locale],
  );

  return (
    <>
      <header className="toolbar">
        <h1>{tx(def.title)}</h1>
        {/* Dropship hanya dibuat dari pesanan penjualan. */}
        {can(me.permissions, "inventory.write") && def.type !== "dropship" && (
          <Link className="button primary" href={`/inventory/pickings/new?type=${def.type}`}>
            {l("Baru", "New")}
          </Link>
        )}
      </header>
      {list.error && <p className="error">{list.error}</p>}
      {!list.loading || list.rows.length ? (
        <DataTable
          customModel="stock_picking"
          rows={list.rows}
          columns={columns}
          storageKey={`pickings.${kind}`}
          rowKey={(p) => p.id}
          rowHref={(p) => `/inventory/pickings/${p.id}`}
          defaultSort={{ key: "scheduledDate", dir: "desc" }}
          initialFilters={{ state: { kind: "enum", values: ["draft", "ready"] } }}
          note={truncatedNote(list, l)}
          onSearch={setSearch}
          searchPlaceholder={l("Cari nomor, dokumen asal, partner…", "Search number, source, partner…")}
          empty={l("Tidak ada transfer.", "No transfers.")}
        />
      ) : (
        <p className="muted">{l("Memuat…", "Loading…")}</p>
      )}
    </>
  );
}
