"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useMe } from "../../../../components/me-context";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";
import { useListData } from "../../../../lib/use-list-data";

interface Row {
  id: string;
  name: string;
  currencyCode: string;
  active: boolean;
  itemCount: number;
}

export default function PricelistsPage() {
  const me = useMe();
  const { l } = useI18n();
  const list = useListData<Row>("/pricelists", { active: "all" });
  const rows = list.loading && !list.rows.length ? null : list.rows;
  const error = list.error;
  const columns = useMemo<ViewColumn<Row>[]>(
    () => [
      { key: "name", label: l("Nama", "Name"), value: (r) => r.name },
      { key: "currencyCode", label: l("Mata uang", "Currency"), type: "enum", value: (r) => r.currencyCode },
      { key: "itemCount", label: l("Aturan", "Rules"), type: "number", value: (r) => r.itemCount },
      {
        key: "active",
        label: l("Status", "Status"),
        type: "enum",
        value: (r) => (r.active ? "1" : "0"),
        text: (r) => (r.active ? l("Aktif", "Active") : l("Nonaktif", "Inactive")),
      },
    ],
    [l],
  );
  const table = useTableView(rows ?? [], columns, { storageKey: "pricelists" });

  return (
    <>
      <header className="toolbar">
        <h1>{l("Daftar Harga", "Pricelists")}</h1>
        {can(me.permissions, "sales.manage") && (
          <Link className="button primary" href="/sales/pricelists/new">
            {l("Baru", "New")}
          </Link>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {rows && <TableTools view={table} />}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh view={table} col="name">
                  {l("Nama", "Name")}
                </SortTh>
                <SortTh view={table} col="currencyCode">
                  {l("Mata uang", "Currency")}
                </SortTh>
                <SortTh view={table} col="itemCount" className="num">
                  {l("Aturan", "Rules")}
                </SortTh>
                <SortTh view={table} col="active">
                  {l("Status", "Status")}
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/sales/pricelists/${r.id}`}>{r.name}</Link>
                  </td>
                  <td>{r.currencyCode}</td>
                  <td className="num">{r.itemCount}</td>
                  <td>{r.active ? l("Aktif", "Active") : l("Nonaktif", "Inactive")}</td>
                </tr>
              ))}
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    {rows.length
                      ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                      : l("Belum ada daftar harga.", "No pricelists yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {rows && <TablePager view={table} />}
    </>
  );
}
