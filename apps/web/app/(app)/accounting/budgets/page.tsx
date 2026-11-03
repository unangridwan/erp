"use client";

import Link from "next/link";
import { useMemo } from "react";
import { DataTable, type DataColumn } from "../../../../components/data-table";
import { useMe } from "../../../../components/me-context";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { useListData } from "../../../../lib/use-list-data";

interface Budget {
  id: string;
  name: string;
  dateFrom: string;
  dateTo: string;
  source: "manual" | "manpower";
}

export default function BudgetsPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const list = useListData<Budget>("/budgets");
  const columns = useMemo<DataColumn<Budget>[]>(
    () => [
      {
        key: "name",
        label: l("Nama", "Name"),
        value: (b) => b.name,
        render: (b) => (
          <>
            <Link href={`/accounting/budgets/${b.id}`}>{b.name}</Link>
            {b.source === "manpower" && (
              <>
                {" "}
                <span className="pill ok">{l("Dari MPP", "From MPP")}</span>
              </>
            )}
          </>
        ),
      },
      {
        key: "dateFrom",
        label: l("Periode", "Period"),
        type: "date",
        value: (b) => b.dateFrom,
        text: (b) => `${formatDate(b.dateFrom, locale)} – ${formatDate(b.dateTo, locale)}`,
      },
      {
        key: "source",
        label: l("Sumber", "Source"),
        type: "enum",
        value: (b) => b.source,
        text: (b) =>
          b.source === "manpower" ? l("Man Power Planning", "Manpower planning") : l("Manual", "Manual"),
        hidden: true,
      },
    ],
    [l, locale],
  );
  return (
    <>
      <header className="toolbar">
        <h1>{l("Anggaran", "Budgets")}</h1>
        {can(me.permissions, "accounting.write") && (
          <Link className="button primary" href="/accounting/budgets/new">
            {l("Baru", "New")}
          </Link>
        )}
      </header>
      {list.error && <p className="error">{list.error}</p>}
      <DataTable
        rows={list.rows}
        columns={columns}
        storageKey="budgets"
        rowKey={(b) => b.id}
        defaultSort={{ key: "dateFrom", dir: "desc" }}
        empty={l("Belum ada anggaran.", "No budgets yet.")}
      />
    </>
  );
}
