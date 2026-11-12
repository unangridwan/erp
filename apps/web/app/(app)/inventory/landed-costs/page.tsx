"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "../../../../components/feedback";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { LC_STATE } from "../../../../components/inventory/landed-cost-state";

interface Row {
  id: string;
  name: string;
  date: string;
  state: string;
  total: string;
  pickings: string | null;
}

/** Daftar landed cost (biaya tambahan penerimaan). */
export default function LandedCostsPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    api<Row[]>("/landed-costs")
      .then(setRows)
      .catch((e: Error) => toast.error(e.message));
  }, []);
  return (
    <>
      <header className="toolbar">
        <h1>{l("Landed cost", "Landed costs")}</h1>
        {can(me.permissions, "inventory.manage") && (
          <Link className="button primary" href="/inventory/landed-costs/new">
            {l("Baru", "New")}
          </Link>
        )}
      </header>
      <p className="muted">
        {l(
          "Biaya angkut, bea masuk, asuransi, dan biaya lain yang menambah nilai barang yang diterima. Porsi barang yang sudah keluar dibebankan ke HPP.",
          "Freight, import duty, insurance, and other costs that add to the value of received goods. The share of goods already shipped goes to COGS.",
        )}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Nomor", "Number")}</th>
              <th>{l("Tanggal", "Date")}</th>
              <th>{l("Penerimaan", "Receipts")}</th>
              <th className="num">{l("Total biaya", "Total cost")}</th>
              <th>{l("Status", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {l("Belum ada landed cost.", "No landed costs yet.")}
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/inventory/landed-costs/${r.id}`}>{r.name}</Link>
                </td>
                <td>{formatDate(r.date, locale)}</td>
                <td>{r.pickings ?? "—"}</td>
                <td className="num">{money(r.total, locale)}</td>
                <td>{l(...(LC_STATE[r.state] ?? [r.state, r.state]))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
