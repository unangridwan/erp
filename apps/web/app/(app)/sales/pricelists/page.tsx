"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

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
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: Row[] }>("/pricelists?active=all")
      .then((d) => setRows(d.items))
      .catch((e: Error) => setError(e.message));
  }, []);

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
      {error && <p className="error">{error}</p>}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Nama", "Name")}</th>
                <th>{l("Mata uang", "Currency")}</th>
                <th className="num">{l("Aturan", "Rules")}</th>
                <th>{l("Status", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/sales/pricelists/${r.id}`}>{r.name}</Link>
                  </td>
                  <td>{r.currencyCode}</td>
                  <td className="num">{r.itemCount}</td>
                  <td>{r.active ? l("Aktif", "Active") : l("Nonaktif", "Inactive")}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    {l("Belum ada daftar harga.", "No pricelists yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
