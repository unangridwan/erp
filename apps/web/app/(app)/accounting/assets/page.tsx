"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { DataTable, type DataColumn } from "../../../../components/data-table";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { truncatedNote, useListData } from "../../../../lib/use-list-data";

interface Asset {
  id: string;
  code: string | null;
  name: string;
  state: string;
  method: string;
  acquisitionDate: string;
  cost: string;
  usefulLifeMonths: number;
}

function useAssetStateLabel() {
  const { l } = useI18n();
  return useCallback(
    (state: string) =>
      ({
        draft: l("Draft", "Draft"),
        running: l("Berjalan", "Running"),
        closed: l("Selesai disusutkan", "Fully depreciated"),
        disposed: l("Dilepas", "Disposed"),
      })[state] ?? state,
    [l],
  );
}

export default function AssetsPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const stateLabel = useAssetStateLabel();
  const [search, setSearch] = useState("");
  const list = useListData<Asset>("/assets", {}, search);
  const [date, setDate] = useState(today());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const columns = useMemo<DataColumn<Asset>[]>(
    () => [
      {
        key: "name",
        label: l("Aset", "Asset"),
        value: (a) => `${a.code ? `${a.code} — ` : ""}${a.name}`,
        render: (a) => (
          <Link href={`/accounting/assets/${a.id}`}>
            {a.code ? `${a.code} — ` : ""}
            {a.name}
          </Link>
        ),
      },
      {
        key: "acquisitionDate",
        label: l("Tanggal perolehan", "Acquired"),
        type: "date",
        value: (a) => a.acquisitionDate,
        text: (a) => formatDate(a.acquisitionDate, locale),
      },
      {
        key: "method",
        label: l("Metode", "Method"),
        type: "enum",
        value: (a) => a.method,
        text: (a) =>
          a.method === "straight_line"
            ? l("Garis lurus", "Straight line")
            : l("Saldo menurun", "Declining balance"),
      },
      {
        key: "usefulLifeMonths",
        label: l("Masa manfaat (bln)", "Life (months)"),
        type: "number",
        className: "num",
        value: (a) => a.usefulLifeMonths,
      },
      {
        key: "cost",
        label: l("Harga perolehan", "Cost"),
        type: "number",
        className: "num",
        value: (a) => Number(a.cost),
        text: (a) => money(a.cost, locale),
      },
      {
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (a) => a.state,
        text: (a) => stateLabel(a.state),
        render: (a) => (
          <span className={`badge state-${a.state === "draft" ? "draft" : "posted"}`}>
            {stateLabel(a.state)}
          </span>
        ),
      },
    ],
    [l, locale, stateLabel],
  );

  async function depreciate() {
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ posted: number; assets: number }>("/assets/depreciate", {
        method: "POST",
        body: { date },
      });
      setNotice(
        l(
          `${r.posted} entri penyusutan diposting untuk ${r.assets} aset.`,
          `${r.posted} depreciation entries posted for ${r.assets} assets.`,
        ),
      );
      list.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <header className="toolbar">
        <h1>{l("Aset tetap", "Fixed assets")}</h1>
        {can(me.permissions, "accounting.post") && (
          <>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label={l("Sampai tanggal", "Up to date")}
            />
            <button onClick={depreciate}>
              {l("Posting penyusutan s.d. tanggal", "Post depreciation up to date")}
            </button>
          </>
        )}
        {can(me.permissions, "accounting.write") && (
          <Link className="button primary" href="/accounting/assets/new">
            {l("Baru", "New")}
          </Link>
        )}
      </header>
      {notice && <p className="notice">{notice}</p>}
      {(error ?? list.error) && <p className="error">{error ?? list.error}</p>}
      <DataTable
        rows={list.rows}
        columns={columns}
        storageKey="assets"
        rowKey={(a) => a.id}
        note={truncatedNote(list, l)}
        onSearch={setSearch}
        empty={l("Belum ada aset.", "No assets yet.")}
      />
    </>
  );
}
