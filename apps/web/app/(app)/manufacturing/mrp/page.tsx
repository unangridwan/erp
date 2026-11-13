"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { toast } from "../../../../components/feedback";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Proposal {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  kind: "manufacture" | "purchase";
  level: number;
  demand: string;
  available: string;
  quantity: string;
  dateNeeded: string;
  dateStart: string;
  supplierName: string | null;
  reason: string | null;
  state: "proposed" | "done" | "ignored";
  productionOrderId: string | null;
  productionOrderName: string | null;
  purchaseOrderId: string | null;
  purchaseOrderName: string | null;
}
interface Run {
  id: string;
  createdAt: string;
  horizonDate: string;
  warehouseName: string | null;
  proposals: Proposal[];
}
interface RunRow {
  id: string;
  createdAt: string;
  horizonDate: string;
  proposals: number;
  done: number;
  warehouseName: string;
}

const plus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** MRP: jalankan perencanaan kebutuhan, tinjau & konfirmasi usulan order produksi dan RFQ. */
export default function MrpPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const write = can(me.permissions, "mrp.write");
  const warehouses = useOptions<{ id: string; code: string; name: string }>("/warehouses");
  const [warehouseId, setWarehouseId] = useState("");
  const [horizon, setHorizon] = useState(plus(30));
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const open = (id: string) =>
    api<Run>(`/mrp/runs/${id}`)
      .then((r) => {
        setRun(r);
        setSelected(r.proposals.filter((p) => p.state === "proposed").map((p) => p.id));
      })
      .catch((e: Error) => toast.error(e.message));
  const loadRuns = () =>
    api<RunRow[]>("/mrp/runs")
      .then(setRuns)
      .catch((e: Error) => toast.error(e.message));
  useEffect(() => {
    api<RunRow[]>("/mrp/runs")
      .then((rows) => {
        setRuns(rows);
        if (rows[0]) void open(rows[0].id);
      })
      .catch((e: Error) => toast.error(e.message));
  }, []);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const execute = () =>
    act(async () => {
      const r = await api<Run>("/mrp/runs", {
        method: "POST",
        body: { warehouseId: warehouseId || null, horizonDate: horizon },
      });
      setRun(r);
      setSelected(r.proposals.map((p) => p.id));
      toast.success(
        r.proposals.length
          ? l(`${r.proposals.length} usulan dibuat`, `${r.proposals.length} proposals created`)
          : l(
              "Tidak ada kebutuhan: stok & pasokan mencukupi",
              "No requirements: stock & supply are sufficient",
            ),
      );
      loadRuns();
    });
  const confirm = () =>
    act(async () => {
      if (!run) return;
      const res = await api<{
        productionOrders: string[];
        purchaseOrders: string[];
        skipped: { id: string; reason: string }[];
        run: Run;
      }>(`/mrp/runs/${run.id}/confirm`, { method: "POST", body: { proposalIds: selected } });
      setRun(res.run);
      setSelected([]);
      toast.success(
        l(
          `${res.productionOrders.length} order produksi & ${res.purchaseOrders.length} RFQ dibuat`,
          `${res.productionOrders.length} production orders & ${res.purchaseOrders.length} RFQs created`,
        ),
      );
      if (res.skipped.length)
        toast.error(
          l(
            `${res.skipped.length} usulan dilewati: produk belum punya pemasok`,
            `${res.skipped.length} proposals skipped: product has no vendor`,
          ),
        );
      loadRuns();
    });
  const ignore = () =>
    act(async () => {
      if (!run) return;
      setRun(
        await api<Run>(`/mrp/runs/${run.id}/ignore`, { method: "POST", body: { proposalIds: selected } }),
      );
      setSelected([]);
    });

  const open_ = run?.proposals.filter((p) => p.state === "proposed") ?? [];
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="stack-wide">
      <header className="toolbar">
        <h1>{l("Perencanaan Kebutuhan (MRP)", "Material Requirements Planning")}</h1>
      </header>
      <p className="muted">
        {l(
          "Kebutuhan bersih per produk = pengiriman pelanggan belum selesai + bahan order produksi terbuka + pengisian stok minimum − (stok gudang + penerimaan/RFQ/order produksi terbuka), diurai per level BOM dengan lead time. Produk ber-BOM menjadi usulan order produksi, lainnya usulan pembelian ke pemasok utama.",
          "Net requirement per product = open customer deliveries + open production order components + minimum stock top-up − (warehouse stock + open receipts/RFQs/production orders), exploded per BOM level with lead times. Products with a BOM become production order proposals, others purchase proposals to the main vendor.",
        )}
      </p>
      {write && (
        <div className="panel">
          <div className="toolbar">
            <label className="field inline">
              <span>{l("Gudang", "Warehouse")}</span>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">{l("Gudang utama", "Main warehouse")}</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field inline">
              <span>{l("Permintaan sampai", "Demand until")}</span>
              <input type="date" value={horizon} onChange={(e) => setHorizon(e.target.value)} />
            </label>
            <button className="primary" disabled={busy} aria-busy={busy} onClick={execute}>
              {l("Jalankan MRP", "Run MRP")}
            </button>
          </div>
        </div>
      )}

      {run && (
        <div className="panel">
          <div className="toolbar">
            <h2>
              {l("Hasil", "Result")} {new Date(run.createdAt).toLocaleString(locale)} · {run.warehouseName} ·{" "}
              {l("s.d.", "until")} {formatDate(run.horizonDate, locale)}
            </h2>
            {write && open_.length > 0 && (
              <>
                <button className="primary" disabled={busy || !selected.length} onClick={confirm}>
                  {l(`Konfirmasi ${selected.length} usulan`, `Confirm ${selected.length} proposals`)}
                </button>
                <button disabled={busy || !selected.length} onClick={ignore}>
                  {l("Abaikan", "Ignore")}
                </button>
              </>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    {write && open_.length > 0 && (
                      <input
                        type="checkbox"
                        aria-label={l("Pilih semua", "Select all")}
                        checked={open_.length > 0 && open_.every((p) => selected.includes(p.id))}
                        onChange={(e) => setSelected(e.target.checked ? open_.map((p) => p.id) : [])}
                      />
                    )}
                  </th>
                  <th>{l("Produk", "Product")}</th>
                  <th>{l("Tindakan", "Action")}</th>
                  <th className="num">{l("Kebutuhan", "Demand")}</th>
                  <th className="num">{l("Stok + pasokan", "Stock + supply")}</th>
                  <th className="num">{l("Usulan", "Proposed")}</th>
                  <th>{l("Mulai", "Start")}</th>
                  <th>{l("Dibutuhkan", "Needed")}</th>
                  <th>{l("Asal kebutuhan", "Demand source")}</th>
                  <th>{l("Status", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {run.proposals.length === 0 && (
                  <tr>
                    <td colSpan={10} className="muted">
                      {l(
                        "Tidak ada kebutuhan: stok & pasokan mencukupi.",
                        "No requirements: stock & supply are sufficient.",
                      )}
                    </td>
                  </tr>
                )}
                {run.proposals.map((p) => (
                  <tr key={p.id} className={p.state === "ignored" ? "muted" : ""}>
                    <td>
                      {write && p.state === "proposed" && (
                        <input
                          type="checkbox"
                          aria-label={p.sku}
                          checked={selected.includes(p.id)}
                          onChange={() => toggle(p.id)}
                        />
                      )}
                    </td>
                    <td>
                      {"· ".repeat(p.level)}
                      {p.sku} {p.productName}
                    </td>
                    <td>
                      {p.kind === "manufacture"
                        ? l("Produksi", "Manufacture")
                        : `${l("Beli", "Buy")}${p.supplierName ? ` · ${p.supplierName}` : ` · ${l("pemasok belum diatur", "no vendor")}`}`}
                    </td>
                    <td className="num">{money(p.demand, locale, 4)}</td>
                    <td className="num">{money(p.available, locale, 4)}</td>
                    <td className="num">
                      <strong>{money(p.quantity, locale, 4)}</strong>
                    </td>
                    <td>{formatDate(p.dateStart, locale)}</td>
                    <td>{formatDate(p.dateNeeded, locale)}</td>
                    <td>
                      <small className="muted">{p.reason}</small>
                    </td>
                    <td>
                      {p.productionOrderId ? (
                        <Link href={`/manufacturing/orders/${p.productionOrderId}`}>
                          {p.productionOrderName}
                        </Link>
                      ) : p.purchaseOrderId ? (
                        <Link href={`/purchase/orders/${p.purchaseOrderId}`}>{p.purchaseOrderName}</Link>
                      ) : p.state === "ignored" ? (
                        l("Diabaikan", "Ignored")
                      ) : (
                        l("Usulan", "Proposed")
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {runs.length > 0 && (
        <div className="panel">
          <h2>{l("Riwayat MRP", "MRP history")}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Waktu", "Time")}</th>
                  <th>{l("Gudang", "Warehouse")}</th>
                  <th>{l("Sampai", "Until")}</th>
                  <th className="num">{l("Usulan", "Proposals")}</th>
                  <th className="num">{l("Dikonfirmasi", "Confirmed")}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button className="link" onClick={() => open(r.id)}>
                        {new Date(r.createdAt).toLocaleString(locale)}
                      </button>
                    </td>
                    <td>{r.warehouseName}</td>
                    <td>{formatDate(r.horizonDate, locale)}</td>
                    <td className="num">{r.proposals}</td>
                    <td className="num">{r.done}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
