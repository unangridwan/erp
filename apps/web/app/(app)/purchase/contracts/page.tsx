"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "../../../../components/feedback";
import { useMe } from "../../../../components/me-context";
import { CONTRACT_STATE, contractPill } from "../../../../components/purchase/contract-state";
import { api } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Row {
  id: string;
  name: string;
  partnerName: string;
  dateStart: string;
  dateEnd: string;
  state: string;
  currencyCode: string;
  valueLimit: string | null;
  committedValue: string;
  orderedValue: string;
  qtyPct: number;
  valuePct: number;
  daysLeft: number;
}

function Bar({ pct }: { pct: number }) {
  return (
    <span className="contract-usage">
      <span className={`meter${pct > 100 ? " meter-over" : ""}`} role="img" aria-label={`${pct}%`}>
        <span style={{ width: `${Math.min(pct, 100)}%` }} />
      </span>
      <small>{pct}%</small>
    </span>
  );
}

/** Daftar kontrak pembelian (blanket order) + realisasi. */
export default function PurchaseContractsPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [state, setState] = useState("");
  useEffect(() => {
    api<Row[]>("/purchase-contracts")
      .then(setRows)
      .catch((e: Error) => toast.error(e.message));
  }, []);
  const shown = rows?.filter((r) => !state || r.state === state);
  return (
    <>
      <header className="toolbar">
        <h1>{l("Kontrak Pembelian", "Purchase Contracts")}</h1>
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label={l("Status", "Status")}>
          <option value="">{l("Semua status", "All states")}</option>
          {Object.entries(CONTRACT_STATE).map(([k, v]) => (
            <option key={k} value={k}>
              {l(...v)}
            </option>
          ))}
        </select>
        {can(me.permissions, "purchase.write") && (
          <Link className="button primary" href="/purchase/contracts/new">
            {l("Baru", "New")}
          </Link>
        )}
      </header>
      <p className="muted">
        {l(
          "Kontrak harga tetap & kuantitas komitmen per produk dengan pemasok. PO memakai harga kontrak; PO yang melebihi sisa, plafon, atau masa kontrak wajib disetujui.",
          "Fixed-price contracts with committed quantities per product. POs use the contract price; POs exceeding the remaining quantity, value cap or contract period need approval.",
        )}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Nomor", "Number")}</th>
              <th>{l("Pemasok", "Vendor")}</th>
              <th>{l("Periode", "Period")}</th>
              <th className="num">{l("Komitmen", "Commitment")}</th>
              <th>{l("Realisasi kuantitas", "Quantity used")}</th>
              <th>{l("Realisasi nilai", "Value used")}</th>
              <th>{l("Status", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {shown?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {l("Belum ada kontrak pembelian.", "No purchase contracts yet.")}
                </td>
              </tr>
            )}
            {shown?.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/purchase/contracts/${r.id}`}>{r.name}</Link>
                </td>
                <td>{r.partnerName}</td>
                <td>
                  {formatDate(r.dateStart, locale)} – {formatDate(r.dateEnd, locale)}
                  {r.state === "active" && r.daysLeft <= 30 && (
                    <>
                      {" "}
                      <span className="badge warn">
                        {l(`${r.daysLeft} hari lagi`, `${r.daysLeft} days left`)}
                      </span>
                    </>
                  )}
                </td>
                <td className="num">
                  {money(r.valueLimit ?? r.committedValue, locale)} {r.currencyCode}
                </td>
                <td>
                  <Bar pct={r.qtyPct} />
                </td>
                <td>
                  <Bar pct={r.valuePct} />
                </td>
                <td>
                  <span className={`pill ${contractPill(r.state)}`}>
                    {l(...(CONTRACT_STATE[r.state] ?? [r.state, r.state]))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
