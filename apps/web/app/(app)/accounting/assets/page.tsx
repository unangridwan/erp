"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

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
  return (state: string) =>
    ({
      draft: l("Draft", "Draft"),
      running: l("Berjalan", "Running"),
      closed: l("Selesai disusutkan", "Fully depreciated"),
      disposed: l("Dilepas", "Disposed"),
    })[state] ?? state;
}

export default function AssetsPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const stateLabel = useAssetStateLabel();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [date, setDate] = useState(today());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<{ items: Asset[] }>("/assets?limit=200").then((d) => setAssets(d.items));
  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

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
      await load();
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
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Aset", "Asset")}</th>
              <th>{l("Tanggal perolehan", "Acquired")}</th>
              <th>{l("Metode", "Method")}</th>
              <th className="num">{l("Masa manfaat (bln)", "Life (months)")}</th>
              <th className="num">{l("Harga perolehan", "Cost")}</th>
              <th>{l("Status", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link href={`/accounting/assets/${a.id}`}>
                    {a.code ? `${a.code} — ` : ""}
                    {a.name}
                  </Link>
                </td>
                <td>{formatDate(a.acquisitionDate, locale)}</td>
                <td>
                  {a.method === "straight_line"
                    ? l("Garis lurus", "Straight line")
                    : l("Saldo menurun", "Declining balance")}
                </td>
                <td className="num">{a.usefulLifeMonths}</td>
                <td className="num">{money(a.cost, locale)}</td>
                <td>
                  <span className={`badge state-${a.state === "draft" ? "draft" : "posted"}`}>
                    {stateLabel(a.state)}
                  </span>
                </td>
              </tr>
            ))}
            {assets.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {l("Belum ada aset.", "No assets yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
