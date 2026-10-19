"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { formatDate, money, today } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { can, PICKING_STATE_LABEL, PICKING_TYPE_LABEL } from "../../lib/resources";
import { useOptions } from "../accounting/use-options";
import { Chatter } from "../chatter";
import { useMe } from "../me-context";
import { RefSelect } from "../ref-select";

interface Move {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  tracking: "none" | "lot" | "serial";
  uomName: string;
  name: string;
  quantity: string;
  quantityDone: string;
  quantityReserved: string;
  priceUnit: string | null;
  unitCost: string | null;
  value: string | null;
  state: string;
  returnedQty: string;
  lots: { lotId: string; lotName: string; quantity: string }[];
}
interface Picking {
  id: string;
  name: string;
  pickingType: "incoming" | "outgoing" | "internal" | "dropship";
  state: "draft" | "ready" | "done" | "cancel";
  /** Ketersediaan stok untuk barang keluar dari lokasi internal (null = tidak relevan). */
  availability: "available" | "partial" | "waiting" | null;
  warehouseId: string;
  partnerId: string | null;
  partnerName: string | null;
  locationId: string;
  locationDestId: string;
  locationName: string;
  locationDestName: string;
  scheduledDate: string;
  dateDone: string | null;
  origin: string | null;
  note: string | null;
  saleOrderId: string | null;
  purchaseOrderId: string | null;
  moves: Move[];
  related: {
    id: string;
    name: string;
    state: string;
    returnOfId: string | null;
    backorderOfId: string | null;
  }[];
  order: { id: string; name: string } | null;
  accountMove: { id: string; name: string | null } | null;
}
interface Product {
  id: string;
  sku: string;
  name: string;
  productType: string;
}
interface Location {
  id: string;
  completeName: string;
  usage: string;
}
interface LotRow {
  lotId: string;
  lotName: string;
  quantity: string;
  expirationDate: string;
}
interface Work {
  quantityDone: string;
  lots: LotRow[];
}

const num = (v: string | null | undefined) => String(Number(v ?? 0));
const emptyLot = (qty = "1"): LotRow => ({ lotId: "", lotName: "", quantity: qty, expirationDate: "" });

export function PickingForm({ id, newType }: { id: string; newType: string }) {
  const me = useMe();
  const router = useRouter();
  const { l, tx, locale } = useI18n();
  const isNew = id === "new";
  const [picking, setPicking] = useState<Picking | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [work, setWork] = useState<Record<string, Work>>({});
  const [backorder, setBackorder] = useState(true);
  /** Dokumen yang dibuat otomatis saat validasi (mis. draft nota kredit dari retur yang sudah ditagih). */
  const [documents, setDocuments] = useState<{ id: string; moveType: "out_refund" | "in_refund" }[]>([]);
  const [returnQty, setReturnQty] = useState<Record<string, string> | null>(null);
  const [lotOptions, setLotOptions] = useState<
    Record<string, { id: string; name: string; onHand: string }[]>
  >({});
  const products = useOptions<Product>("/products").filter((p) => p.productType !== "service");
  const warehouses = useOptions<{ id: string; code: string; name: string }>("/warehouses");
  const internal = useOptions<Location>("/stock-locations?usage=internal");

  const type = (picking?.pickingType ?? newType) as Picking["pickingType"];
  const [header, setHeader] = useState({
    partnerId: "",
    warehouseId: "",
    locationId: "",
    locationDestId: "",
    scheduledDate: today(),
    origin: "",
    note: "",
  });
  const [lines, setLines] = useState<{ productId: string; quantity: string; priceUnit: string }[]>([
    { productId: "", quantity: "1", priceUnit: "" },
  ]);

  useEffect(() => {
    if (isNew) return;
    api<Picking>(`/pickings/${id}`)
      .then((p) => {
        setPicking(p);
        setHeader({
          partnerId: p.partnerId ?? "",
          warehouseId: p.warehouseId,
          locationId: p.locationId,
          locationDestId: p.locationDestId,
          scheduledDate: p.scheduledDate,
          origin: p.origin ?? "",
          note: p.note ?? "",
        });
        setLines(
          p.moves.map((m) => ({
            productId: m.productId,
            quantity: num(m.quantity),
            priceUnit: m.priceUnit ? num(m.priceUnit) : "",
          })),
        );
        setWork(
          Object.fromEntries(
            p.moves.map((m) => [
              m.id,
              {
                quantityDone: num(m.quantity),
                lots:
                  m.tracking === "serial"
                    ? Array.from({ length: Math.max(1, Math.round(Number(m.quantity))) }, () => emptyLot())
                    : m.tracking === "lot"
                      ? [emptyLot(num(m.quantity))]
                      : [],
              },
            ]),
          ),
        );
        // Barang keluar/internal memilih lot yang tersedia.
        if (p.pickingType !== "incoming") {
          for (const m of p.moves.filter((x) => x.tracking !== "none")) {
            api<{ id: string; name: string; onHand: string }[]>(
              `/stock/lots?productId=${m.productId}&available=true`,
            )
              .then((rows) => setLotOptions((prev) => ({ ...prev, [m.productId]: rows })))
              .catch(() => undefined);
          }
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [id, isNew, version]);

  const writable = can(me.permissions, "inventory.write");
  const editable =
    writable && (isNew || (picking?.state === "draft" && !picking.saleOrderId && !picking.purchaseOrderId));
  // Transfer draft manual diedit dulu; validasi (isi kuantitas & lot/serial) setelah ditandai siap.
  const workable = writable && (picking?.state === "ready" || (picking?.state === "draft" && !editable));
  const err = (path: string) => fieldErrors[path] && <small className="error">{fieldErrors[path]}</small>;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  const payload = () => ({
    pickingType: type,
    partnerId: header.partnerId || null,
    warehouseId: header.warehouseId || undefined,
    locationId: header.locationId || undefined,
    locationDestId: header.locationDestId || undefined,
    scheduledDate: header.scheduledDate,
    origin: header.origin || null,
    note: header.note || null,
    moves: lines
      .filter((x) => x.productId)
      .map((x) => ({
        productId: x.productId,
        quantity: x.quantity || "0",
        priceUnit: x.priceUnit === "" ? null : x.priceUnit,
      })),
  });

  const save = (e?: FormEvent) => {
    e?.preventDefault();
    return run(async () => {
      if (isNew) {
        const created = await api<Picking>("/pickings", { method: "POST", body: payload() });
        router.replace(`/inventory/pickings/${created.id}`);
      } else {
        const updated = await api<Picking>(`/pickings/${id}`, { method: "PUT", body: payload() });
        if (updated.id !== id) router.replace(`/inventory/pickings/${updated.id}`);
        else setVersion((v) => v + 1);
      }
    });
  };

  const validate = () =>
    run(async () => {
      if (!picking) return;
      const body = {
        createBackorder: backorder,
        moves: picking.moves.map((m) => {
          const w = work[m.id]!;
          return {
            id: m.id,
            quantityDone: w.quantityDone || "0",
            lots:
              m.tracking === "none"
                ? undefined
                : w.lots
                    .filter((x) => x.lotId || x.lotName)
                    .map((x) => ({
                      lotId: x.lotId || undefined,
                      lotName: x.lotId ? undefined : x.lotName,
                      quantity: x.quantity,
                      expirationDate: x.expirationDate || null,
                    })),
          };
        }),
      };
      const res = await api<
        Picking & {
          backorderId: string | null;
          documents: { id: string; moveType: "out_refund" | "in_refund" }[];
        }
      >(`/pickings/${id}/validate`, {
        method: "POST",
        body,
      });
      setDocuments(res.documents ?? []);
      if (res.backorderId)
        alert(
          l("Sisa kuantitas dibuat sebagai backorder.", "The remaining quantity was moved to a backorder."),
        );
      setVersion((v) => v + 1);
    });

  const action = (path: string) =>
    run(async () => {
      await api(`/pickings/${id}/${path}`, { method: "POST", body: {} });
      setVersion((v) => v + 1);
    });

  const createReturn = () =>
    run(async () => {
      if (!returnQty) return;
      const body = {
        lines: Object.entries(returnQty)
          .filter(([, q]) => Number(q) > 0)
          .map(([moveId, quantity]) => ({ moveId, quantity })),
      };
      const ret = await api<Picking>(`/pickings/${id}/return`, { method: "POST", body });
      router.push(`/inventory/pickings/${ret.id}`);
    });

  if (!isNew && !picking) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;

  const title = picking?.name ?? `${tx(PICKING_TYPE_LABEL[type]!)} ${l("baru", "new")}`;
  const setWorkFor = (moveId: string, patch: Partial<Work>) =>
    setWork((w) => ({ ...w, [moveId]: { ...w[moveId]!, ...patch } }));
  const setLot = (moveId: string, i: number, patch: Partial<LotRow>) =>
    setWorkFor(moveId, { lots: work[moveId]!.lots.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const orderHref = picking?.saleOrderId
    ? `/sales/orders/${picking.saleOrderId}`
    : picking?.purchaseOrderId
      ? `/purchase/orders/${picking.purchaseOrderId}`
      : null;

  return (
    <div className="form-layout">
      <div className="stack-wide">
        <form className="panel" onSubmit={save}>
          <header className="toolbar">
            <h1>{title}</h1>
            {picking && (
              <span className={`badge state-${picking.state === "done" ? "posted" : picking.state}`}>
                {tx(PICKING_STATE_LABEL[picking.state]!)}
              </span>
            )}
            <span className="badge">{tx(PICKING_TYPE_LABEL[type]!)}</span>
            {picking?.state === "ready" && picking.availability && (
              <span
                className={`badge ${picking.availability === "available" ? "state-posted" : picking.availability === "partial" ? "state-sent" : "state-cancel"}`}
              >
                {picking.availability === "available"
                  ? l("Stok tersedia", "Available")
                  : picking.availability === "partial"
                    ? l("Tersedia sebagian", "Partially available")
                    : l("Menunggu stok", "Waiting")}
              </span>
            )}
            {editable && (
              <button className="primary" disabled={busy}>
                {l("Simpan", "Save")}
              </button>
            )}
            {picking?.state === "draft" && writable && (
              <button type="button" disabled={busy} onClick={() => action("confirm")}>
                {l("Tandai siap", "Mark as ready")}
              </button>
            )}
            {workable && (
              <button type="button" className="primary" disabled={busy} onClick={validate}>
                {l("Validasi", "Validate")}
              </button>
            )}
            {picking?.state === "ready" &&
              writable &&
              picking.availability &&
              picking.availability !== "available" && (
                <button type="button" disabled={busy} onClick={() => action("reserve")}>
                  {l("Cek ketersediaan", "Check availability")}
                </button>
              )}
            {picking?.state === "ready" &&
              writable &&
              picking.moves.some((m) => Number(m.quantityReserved) > 0) && (
                <button type="button" disabled={busy} onClick={() => action("unreserve")}>
                  {l("Lepas cadangan", "Unreserve")}
                </button>
              )}
            {workable && (
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() =>
                  confirm(l("Batalkan transfer ini?", "Cancel this transfer?")) && action("cancel")
                }
              >
                {l("Batalkan", "Cancel")}
              </button>
            )}
            {picking?.state === "done" &&
              picking.pickingType !== "internal" &&
              picking.pickingType !== "dropship" &&
              writable &&
              !returnQty && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setReturnQty(
                      Object.fromEntries(
                        picking.moves
                          .filter((m) => m.state === "done")
                          .map((m) => [m.id, num(String(Number(m.quantityDone) - Number(m.returnedQty)))]),
                      ),
                    )
                  }
                >
                  {l("Retur", "Return")}
                </button>
              )}
            {picking && editable && (
              <button
                type="button"
                className="link"
                onClick={() =>
                  run(async () => {
                    if (!confirm(l("Hapus transfer ini?", "Delete this transfer?"))) return;
                    await api(`/pickings/${id}`, { method: "DELETE" });
                    router.replace("/inventory/overview");
                  })
                }
              >
                {l("Hapus", "Delete")}
              </button>
            )}
          </header>
          {error && <p className="error">{error}</p>}
          {documents.map((d) => (
            <p key={d.id} className="notice">
              {l(
                "Barang ini sudah ditagih; dibuat otomatis:",
                "These goods were already invoiced; created automatically:",
              )}{" "}
              <Link href={`/accounting/moves/${d.id}`}>
                {d.moveType === "out_refund"
                  ? l("draft nota kredit pelanggan", "draft customer credit note")
                  : l("draft nota debit pemasok", "draft vendor debit note")}
              </Link>
            </p>
          ))}

          {returnQty && picking && (
            <div className="inline-panel">
              <strong>{l("Kuantitas retur", "Quantity to return")}</strong>
              {picking.moves
                .filter((m) => m.state === "done")
                .map((m) => (
                  <label key={m.id} className="field">
                    <span>
                      {m.productName} ({l("maks.", "max")}{" "}
                      {num(String(Number(m.quantityDone) - Number(m.returnedQty)))})
                    </span>
                    <input
                      className="num short"
                      inputMode="decimal"
                      value={returnQty[m.id] ?? ""}
                      onChange={(e) => setReturnQty({ ...returnQty, [m.id]: e.target.value })}
                    />
                  </label>
                ))}
              <button type="button" className="primary" disabled={busy} onClick={createReturn}>
                {l("Buat retur", "Create return")}
              </button>
              <button type="button" className="link" onClick={() => setReturnQty(null)}>
                {l("Batal", "Cancel")}
              </button>
            </div>
          )}

          <fieldset className="fields" disabled={!editable}>
            <label className="field">
              <span>
                {type === "incoming" ? l("Pemasok / pengirim", "Vendor / from") : l("Partner", "Partner")}
              </span>
              <RefSelect
                name="partnerId"
                resource="partners"
                display="name"
                value={header.partnerId}
                onChange={(v) => setHeader((h) => ({ ...h, partnerId: v }))}
              />
            </label>
            <label className="field">
              <span>{l("Jadwal *", "Scheduled *")}</span>
              <input
                type="date"
                required
                value={header.scheduledDate}
                onChange={(e) => setHeader((h) => ({ ...h, scheduledDate: e.target.value }))}
              />
            </label>
            {isNew ? (
              <>
                <label className="field">
                  <span>{l("Gudang", "Warehouse")}</span>
                  <select
                    value={header.warehouseId}
                    onChange={(e) => setHeader((h) => ({ ...h, warehouseId: e.target.value }))}
                  >
                    <option value="">{l("Gudang utama", "Main warehouse")}</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} — {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                {type !== "incoming" && (
                  <label className="field">
                    <span>{l("Dari lokasi", "Source location")}</span>
                    <select
                      value={header.locationId}
                      onChange={(e) => setHeader((h) => ({ ...h, locationId: e.target.value }))}
                    >
                      <option value="">{l("Stok gudang", "Warehouse stock")}</option>
                      {internal.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.completeName}
                        </option>
                      ))}
                    </select>
                    {err("locationId")}
                  </label>
                )}
                {type !== "outgoing" && (
                  <label className="field">
                    <span>{l("Ke lokasi", "Destination location")}</span>
                    <select
                      value={header.locationDestId}
                      onChange={(e) => setHeader((h) => ({ ...h, locationDestId: e.target.value }))}
                    >
                      <option value="">{l("Stok gudang", "Warehouse stock")}</option>
                      {internal.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.completeName}
                        </option>
                      ))}
                    </select>
                    {err("locationDestId")}
                  </label>
                )}
              </>
            ) : (
              <p className="field">
                <span>{l("Dari → ke", "From → to")}</span>
                <strong>
                  {picking?.locationName} → {picking?.locationDestName}
                </strong>
              </p>
            )}
            <label className="field">
              <span>{l("Dokumen asal", "Source document")}</span>
              {orderHref ? (
                <Link href={orderHref}>{picking?.order?.name ?? picking?.origin}</Link>
              ) : (
                <input
                  value={header.origin}
                  onChange={(e) => setHeader((h) => ({ ...h, origin: e.target.value }))}
                />
              )}
            </label>
          </fieldset>

          <h2>{l("Produk", "Products")}</h2>
          {editable ? (
            <table className="lines">
              <thead>
                <tr>
                  <th>{l("Produk", "Product")}</th>
                  <th className="num">{l("Kuantitas", "Quantity")}</th>
                  {type === "incoming" && (
                    <th className="num">
                      {l("Biaya/unit (kosong = biaya saat ini)", "Unit cost (empty = current)")}
                    </th>
                  )}
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((x, i) => (
                  <tr key={i}>
                    <td>
                      <select
                        value={x.productId}
                        onChange={(e) =>
                          setLines((r) =>
                            r.map((y, j) => (j === i ? { ...y, productId: e.target.value } : y)),
                          )
                        }
                      >
                        <option value="">—</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} {p.name}
                          </option>
                        ))}
                      </select>
                      {err(`moves.${i}.productId`)}
                    </td>
                    <td>
                      <input
                        className="num short"
                        inputMode="decimal"
                        value={x.quantity}
                        onChange={(e) =>
                          setLines((r) => r.map((y, j) => (j === i ? { ...y, quantity: e.target.value } : y)))
                        }
                      />
                      {err(`moves.${i}.quantity`)}
                    </td>
                    {type === "incoming" && (
                      <td>
                        <input
                          className="num"
                          inputMode="decimal"
                          value={x.priceUnit}
                          onChange={(e) =>
                            setLines((r) =>
                              r.map((y, j) => (j === i ? { ...y, priceUnit: e.target.value } : y)),
                            )
                          }
                        />
                      </td>
                    )}
                    <td>
                      <button
                        type="button"
                        className="link"
                        onClick={() => setLines((r) => r.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>
                    <button
                      type="button"
                      className="link"
                      onClick={() => setLines((r) => [...r, { productId: "", quantity: "1", priceUnit: "" }])}
                    >
                      + {l("Tambah produk", "Add product")}
                    </button>
                    {err("moves")}
                  </td>
                </tr>
              </tfoot>
            </table>
          ) : (
            picking && (
              <div className="table-wrap">
                <table className="lines">
                  <thead>
                    <tr>
                      <th>{l("Produk", "Product")}</th>
                      <th className="num">{l("Diminta", "Demand")}</th>
                      {picking.state === "ready" && picking.availability && (
                        <th className="num">{l("Dicadangkan", "Reserved")}</th>
                      )}
                      <th className="num">{l("Dikerjakan", "Done")}</th>
                      <th>{l("Lot / serial", "Lot / serial")}</th>
                      {picking.state === "done" && <th className="num">{l("Biaya/unit", "Unit cost")}</th>}
                      {picking.state === "done" && <th className="num">{l("Nilai", "Value")}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {picking.moves.map((m, i) => {
                      const w = work[m.id];
                      const active = workable && m.state !== "cancel" && w;
                      return (
                        <tr key={m.id} className={m.state === "cancel" ? "muted" : ""}>
                          <td>
                            {m.sku} {m.productName}
                            {Number(m.returnedQty) > 0 && (
                              <small className="muted">
                                {" "}
                                · {l("diretur", "returned")} {num(m.returnedQty)}
                              </small>
                            )}
                          </td>
                          <td className="num">
                            {num(m.quantity)} {m.uomName}
                          </td>
                          {picking.state === "ready" && picking.availability && (
                            <td className="num">{num(m.quantityReserved)}</td>
                          )}
                          <td className="num">
                            {active ? (
                              <input
                                className="num short"
                                inputMode="decimal"
                                value={w.quantityDone}
                                onChange={(e) => setWorkFor(m.id, { quantityDone: e.target.value })}
                              />
                            ) : (
                              num(m.quantityDone)
                            )}
                            {err(`moves.${i}.quantityDone`)}
                          </td>
                          <td>
                            {active && m.tracking !== "none" ? (
                              <div className="stack">
                                {w.lots.map((x, j) => (
                                  <span key={j}>
                                    {type === "incoming" ? (
                                      <input
                                        placeholder={
                                          m.tracking === "serial"
                                            ? l("No. serial", "Serial no.")
                                            : l("No. lot", "Lot no.")
                                        }
                                        value={x.lotName}
                                        onChange={(e) => setLot(m.id, j, { lotName: e.target.value })}
                                      />
                                    ) : (
                                      <select
                                        value={x.lotId}
                                        onChange={(e) => setLot(m.id, j, { lotId: e.target.value })}
                                      >
                                        <option value="">—</option>
                                        {(lotOptions[m.productId] ?? []).map((o) => (
                                          <option key={o.id} value={o.id}>
                                            {o.name} ({num(o.onHand)})
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                    {m.tracking === "lot" && (
                                      <input
                                        className="num short"
                                        inputMode="decimal"
                                        value={x.quantity}
                                        onChange={(e) => setLot(m.id, j, { quantity: e.target.value })}
                                      />
                                    )}
                                    {type === "incoming" && (
                                      <input
                                        type="date"
                                        title={l("Kedaluwarsa", "Expiration")}
                                        value={x.expirationDate}
                                        onChange={(e) => setLot(m.id, j, { expirationDate: e.target.value })}
                                      />
                                    )}
                                    <button
                                      type="button"
                                      className="link"
                                      onClick={() =>
                                        setWorkFor(m.id, { lots: w.lots.filter((_, k) => k !== j) })
                                      }
                                    >
                                      ✕
                                    </button>
                                  </span>
                                ))}
                                <button
                                  type="button"
                                  className="link"
                                  onClick={() => setWorkFor(m.id, { lots: [...w.lots, emptyLot()] })}
                                >
                                  + {m.tracking === "serial" ? l("serial", "serial") : l("lot", "lot")}
                                </button>
                                {err(`moves.${i}.lots`)}
                              </div>
                            ) : (
                              m.lots
                                .map(
                                  (x) => `${x.lotName}${m.tracking === "lot" ? ` (${num(x.quantity)})` : ""}`,
                                )
                                .join(", ")
                            )}
                          </td>
                          {picking.state === "done" && (
                            <td className="num">{m.unitCost ? money(m.unitCost, locale, 4) : "—"}</td>
                          )}
                          {picking.state === "done" && (
                            <td className="num">{m.value ? money(m.value, locale) : "—"}</td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
          {workable && (
            <label className="field check">
              <input type="checkbox" checked={backorder} onChange={(e) => setBackorder(e.target.checked)} />
              <span>
                {l("Buat backorder untuk sisa kuantitas", "Create a backorder for the remaining quantity")}
              </span>
            </label>
          )}
          {picking?.dateDone && (
            <p className="muted">
              {l("Selesai", "Done")}: {formatDate(picking.dateDone.slice(0, 10), locale)}
              {picking.accountMove && (
                <>
                  {" · "}
                  {l("Jurnal persediaan", "Stock journal entry")}:{" "}
                  <Link href={`/accounting/moves/${picking.accountMove.id}`}>{picking.accountMove.name}</Link>
                </>
              )}
            </p>
          )}
          {picking && picking.related.length > 0 && (
            <p>
              {l("Terkait", "Related")}:{" "}
              {picking.related.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && ", "}
                  <Link href={`/inventory/pickings/${r.id}`}>{r.name}</Link> (
                  {tx(PICKING_STATE_LABEL[r.state]!)})
                </span>
              ))}
            </p>
          )}
        </form>
      </div>
      {picking && <Chatter model="stock_picking" id={picking.id} version={version} labels={{}} />}
    </div>
  );
}
