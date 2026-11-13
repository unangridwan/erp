"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "../../../../components/feedback";
import { BOM_TYPE } from "../../../../components/manufacturing/states";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Row {
  id: string;
  code: string | null;
  sku: string;
  productName: string;
  quantity: string;
  bomType: string;
  active: boolean;
  lines: number;
  operations: number;
}

/** Daftar bill of materials. */
export default function BomsPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    api<Row[]>("/boms")
      .then(setRows)
      .catch((e: Error) => toast.error(e.message));
  }, []);
  const term = q.trim().toLowerCase();
  const shown = rows?.filter(
    (r) => !term || `${r.sku} ${r.productName} ${r.code ?? ""}`.toLowerCase().includes(term),
  );
  return (
    <>
      <header className="toolbar">
        <h1>{l("Bill of Materials", "Bills of Materials")}</h1>
        <input
          type="search"
          placeholder={l("Cari produk, kode…", "Search product, code…")}
          aria-label={l("Cari", "Search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {can(me.permissions, "mrp.manage") && (
          <Link className="button primary" href="/manufacturing/boms/new">
            {l("Baru", "New")}
          </Link>
        )}
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Produk", "Product")}</th>
              <th>{l("Kode", "Code")}</th>
              <th className="num">{l("Hasil", "Yields")}</th>
              <th>{l("Jenis", "Type")}</th>
              <th className="num">{l("Komponen", "Components")}</th>
              <th className="num">{l("Operasi", "Operations")}</th>
              <th>{l("Aktif", "Active")}</th>
            </tr>
          </thead>
          <tbody>
            {shown?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {l("Belum ada BOM.", "No BOMs yet.")}
                </td>
              </tr>
            )}
            {shown?.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/manufacturing/boms/${r.id}`}>
                    {r.sku} {r.productName}
                  </Link>
                </td>
                <td>{r.code ?? "—"}</td>
                <td className="num">{money(r.quantity, locale, 4)}</td>
                <td>{l(...(BOM_TYPE[r.bomType] ?? [r.bomType, r.bomType]))}</td>
                <td className="num">{r.lines}</td>
                <td className="num">{r.operations}</td>
                <td>{r.active ? "✓" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
