"use client";

import { QualityChecksPanel } from "../../../../../components/quality/quality-ui";
import {
  CustomFieldsSection,
  customPayload,
  useCustomFields,
  type CustomValues,
} from "../../../../../components/custom-fields";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useOptions, type ProductOption } from "../../../../../components/accounting/use-options";
import { ask, toast } from "../../../../../components/feedback";
import { MO_STATE, moPill } from "../../../../../components/manufacturing/states";
import { useMe } from "../../../../../components/me-context";
import { api, ApiError } from "../../../../../lib/api";
import { formatDate, money, today } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";
import { RelatedDocuments } from "../../../../../components/related-documents";

interface Component {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  tracking: string;
  productType: string;
  qtyRequired: string;
  qtyConsumed: string | null;
  value: string | null;
  available: string | null;
  short: string | null;
}
interface Operation {
  id: string;
  name: string;
  workCenterName: string;
  plannedMinutes: string;
  actualMinutes: string | null;
  costPerHour: string;
  state: "pending" | "running" | "done";
  plannedCost: string;
  cost: string;
}
interface Order {
  id: string;
  custom?: CustomValues;
  name: string;
  state: string;
  productId: string;
  sku: string;
  productName: string;
  tracking: string;
  quantity: string;
  qtyProduced: string;
  datePlanned: string;
  warehouseName: string;
  origin: string | null;
  lotName: string | null;
  materialCost: string;
  conversionCost: string;
  unitCost: string;
  accountMoveId: string | null;
  plannedConversion: string;
  shortages: number;
  components: Component[];
  operations: Operation[];
}
interface BomRow {
  id: string;
  productId: string;
  code: string | null;
  bomType: string;
  active: boolean;
}

const n = (v: string | null) => (v == null ? "" : String(Number(v)));

function NewOrder() {
  const router = useRouter();
  const search = useSearchParams();
  const { l } = useI18n();
  const products = useOptions<ProductOption>("/products").filter((p) => !p.isVariantTemplate);
  const warehouses = useOptions<{ id: string; code: string; name: string }>("/warehouses");
  const [boms, setBoms] = useState<BomRow[]>([]);
  const [form, setForm] = useState({
    productId: search.get("productId") ?? "",
    bomId: search.get("bomId") ?? "",
    quantity: "1",
    warehouseId: "",
    datePlanned: today(),
    origin: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<CustomValues>({});
  const customDefs = useCustomFields("production_order");
  useEffect(() => {
    api<BomRow[]>("/boms")
      .then(setBoms)
      .catch(() => undefined);
  }, []);
  const productBoms = boms.filter(
    (b) => b.productId === form.productId && b.active && b.bomType === "normal",
  );
  const withBom = products.filter((p) =>
    boms.some((b) => b.productId === p.id && b.active && b.bomType === "normal"),
  );
  const create = async () => {
    setErrors({});
    try {
      const created = await api<{ id: string }>("/production-orders", {
        method: "POST",
        body: {
          productId: form.productId,
          bomId: form.bomId || null,
          quantity: form.quantity,
          warehouseId: form.warehouseId || null,
          datePlanned: form.datePlanned,
          origin: form.origin || null,
          ...(customDefs.length ? { custom: customPayload(customDefs, custom) } : {}),
        },
      });
      router.replace(`/manufacturing/orders/${created.id}`);
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const err = (k: string) => errors[k] && <small className="error">{errors[k]}</small>;
  return (
    <div className="stack-wide">
      <header className="toolbar">
        <h1>
          <Link href="/manufacturing/orders">{l("Order Produksi", "Production Orders")}</Link> /{" "}
          {l("Baru", "New")}
        </h1>
        <button className="primary" onClick={create}>
          {l("Buat", "Create")}
        </button>
      </header>
      <div className="panel">
        <div className="fields">
          <label className="field">
            <span>{l("Produk jadi *", "Finished product *")}</span>
            <select
              value={form.productId}
              onChange={(e) => setForm({ ...form, productId: e.target.value, bomId: "" })}
            >
              <option value="">—</option>
              {withBom.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} {p.name}
                </option>
              ))}
            </select>
            {err("productId")}
          </label>
          <label className="field">
            <span>{l("BOM", "BOM")}</span>
            <select value={form.bomId} onChange={(e) => setForm({ ...form, bomId: e.target.value })}>
              <option value="">{l("BOM aktif pertama", "First active BOM")}</option>
              {productBoms.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code ?? b.id.slice(0, 8)}
                </option>
              ))}
            </select>
            {err("bomId")}
          </label>
          <label className="field">
            <span>{l("Jumlah *", "Quantity *")}</span>
            <input
              inputMode="decimal"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
            {err("quantity")}
          </label>
          <label className="field">
            <span>{l("Gudang", "Warehouse")}</span>
            <select
              value={form.warehouseId}
              onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
            >
              <option value="">{l("Gudang utama", "Main warehouse")}</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Tanggal rencana *", "Planned date *")}</span>
            <input
              type="date"
              value={form.datePlanned}
              onChange={(e) => setForm({ ...form, datePlanned: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Dokumen asal", "Source document")}</span>
            <input value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} />
          </label>
        </div>
        <CustomFieldsSection
          bare
          model="production_order"
          value={custom}
          onChange={setCustom}
          editable
          errors={errors}
        />
      </div>
    </div>
  );
}

function OrderForm({ id }: { id: string }) {
  const router = useRouter();
  const me = useMe();
  const { l, locale } = useI18n();
  const [doc, setDoc] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [produce, setProduce] = useState<{
    qtyProduced: string;
    lotName: string;
    serialNames: string;
    consumed: Record<string, string>;
  } | null>(null);
  const [minutes, setMinutes] = useState<Record<string, string>>({});
  const write = can(me.permissions, "mrp.write");
  const manage = can(me.permissions, "mrp.manage");
  const load = useCallback(() => {
    api<Order>(`/production-orders/${id}`)
      .then(setDoc)
      .catch((e: Error) => toast.error(e.message));
  }, [id]);
  useEffect(load, [load]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const msg =
        e instanceof ApiError && Object.keys(e.fieldErrors).length
          ? Object.values(e.fieldErrors).join("; ")
          : e instanceof Error
            ? e.message
            : String(e);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };
  const post = (path: string, body: object = {}) =>
    run(async () => setDoc(await api<Order>(`/production-orders/${id}/${path}`, { method: "POST", body })));
  if (!doc) return <p className="muted">{l("Memuat…", "Loading…")}</p>;
  const open = doc.state === "confirmed" || doc.state === "in_progress";
  const m = (v: string) => money(v, locale);
  const startProduce = () =>
    setProduce({
      qtyProduced: n(doc.quantity),
      lotName: "",
      serialNames: "",
      consumed: Object.fromEntries(doc.components.map((c) => [c.id, n(c.qtyRequired)])),
    });
  const scale = (qty: string) => {
    if (!produce) return;
    const f = Number(qty) / Number(doc.quantity);
    setProduce({
      ...produce,
      qtyProduced: qty,
      consumed: Object.fromEntries(
        doc.components.map((c) => [c.id, String(Math.round(Number(c.qtyRequired) * f * 10000) / 10000)]),
      ),
    });
  };
  const submitProduce = () =>
    run(async () => {
      if (!produce) return;
      const body = {
        qtyProduced: produce.qtyProduced,
        lotName: doc.tracking === "lot" ? produce.lotName : null,
        serialNames:
          doc.tracking === "serial"
            ? produce.serialNames
                .split(/[\n,]/)
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        components: doc.components.map((c) => ({ id: c.id, qtyConsumed: produce.consumed[c.id] || "0" })),
      };
      setDoc(await api<Order>(`/production-orders/${id}/produce`, { method: "POST", body }));
      setProduce(null);
      toast.success(
        l("Produksi selesai; barang jadi masuk persediaan", "Production done; finished goods in stock"),
      );
    });

  return (
    <div className="stack-wide">
      <header className="toolbar">
        <h1>
          <Link href="/manufacturing/orders">{l("Order Produksi", "Production Orders")}</Link> / {doc.name}
        </h1>
        <span className={`pill ${moPill(doc.state)}`}>
          {l(...(MO_STATE[doc.state] ?? [doc.state, doc.state]))}
        </span>
        {write && doc.state === "draft" && (
          <button className="primary" disabled={busy} onClick={() => post("confirm")}>
            {l("Konfirmasi", "Confirm")}
          </button>
        )}
        {manage && open && !produce && (
          <button className="primary" disabled={busy} onClick={startProduce}>
            {l("Produksi", "Produce")}
          </button>
        )}
        {write && (doc.state === "draft" || open) && (
          <button
            disabled={busy}
            onClick={async () => {
              if (
                await ask({
                  message: l("Batalkan order produksi ini?", "Cancel this production order?"),
                  danger: true,
                })
              )
                post("cancel");
            }}
          >
            {l("Batalkan", "Cancel")}
          </button>
        )}
        {write && (doc.state === "draft" || doc.state === "cancel") && (
          <button
            className="danger"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (
                  !(await ask({
                    message: l("Hapus order produksi ini?", "Delete this production order?"),
                    danger: true,
                  }))
                )
                  return;
                await api(`/production-orders/${id}`, { method: "DELETE" });
                router.replace("/manufacturing/orders");
              })
            }
          >
            {l("Hapus", "Delete")}
          </button>
        )}
      </header>

      <div className="cards">
        <div className="card">
          <small className="muted">{l("Produk", "Product")}</small>
          <strong>
            {doc.sku} {doc.productName}
          </strong>
          <small className="muted">
            {doc.state === "done"
              ? `${l("Diproduksi", "Produced")} ${money(doc.qtyProduced, locale, 4)}${doc.lotName ? ` · ${doc.lotName}` : ""}`
              : `${l("Rencana", "Planned")} ${money(doc.quantity, locale, 4)} · ${formatDate(doc.datePlanned, locale)}`}
          </small>
        </div>
        <div className="card">
          <small className="muted">{l("Gudang", "Warehouse")}</small>
          <strong>{doc.warehouseName}</strong>
          {doc.origin && <small className="muted">{doc.origin}</small>}
        </div>
        {doc.state === "done" ? (
          <div className="card">
            <small className="muted">{l("Biaya aktual", "Actual cost")}</small>
            <strong>{m(String(Number(doc.materialCost) + Number(doc.conversionCost)))}</strong>
            <small className="muted">
              {l("bahan", "materials")} {m(doc.materialCost)} · {l("konversi", "conversion")}{" "}
              {m(doc.conversionCost)} · {l("per unit", "per unit")} {money(doc.unitCost, locale, 2)}
            </small>
          </div>
        ) : (
          <div className="card">
            <small className="muted">{l("Konversi rencana", "Planned conversion")}</small>
            <strong>{m(doc.plannedConversion)}</strong>
            {doc.shortages > 0 && (
              <small className="overdue">
                {l(`${doc.shortages} bahan kurang stok`, `${doc.shortages} components short`)}
              </small>
            )}
          </div>
        )}
      </div>
      {doc.accountMoveId && (
        <p className="muted">
          {l("Jurnal barang jadi", "Finished goods entry")}:{" "}
          <Link href={`/accounting/moves/${doc.accountMoveId}`}>{l("lihat", "view")}</Link>
        </p>
      )}

      {produce && (
        <div className="panel" role="dialog" aria-label={l("Catat produksi", "Record production")}>
          <h2>{l("Catat produksi", "Record production")}</h2>
          <div className="fields">
            <label className="field">
              <span>{l("Jumlah dihasilkan", "Quantity produced")}</span>
              <input
                inputMode="decimal"
                value={produce.qtyProduced}
                onChange={(e) => scale(e.target.value)}
              />
            </label>
            {doc.tracking === "lot" && (
              <label className="field">
                <span>{l("Nomor lot hasil *", "Finished lot number *")}</span>
                <input
                  value={produce.lotName}
                  onChange={(e) => setProduce({ ...produce, lotName: e.target.value })}
                />
              </label>
            )}
            {doc.tracking === "serial" && (
              <label className="field">
                <span>{l("Nomor serial (satu per baris) *", "Serial numbers (one per line) *")}</span>
                <textarea
                  rows={4}
                  value={produce.serialNames}
                  onChange={(e) => setProduce({ ...produce, serialNames: e.target.value })}
                />
              </label>
            )}
          </div>
          <p className="muted">
            {l(
              "Ubah jumlah bahan terpakai bila berbeda dari BOM. Lot bahan dipilih otomatis (kedaluwarsa terdekat, lalu tertua).",
              "Adjust consumed quantities if they differ from the BOM. Component lots are picked automatically (nearest expiry, then oldest).",
            )}
          </p>
          <div className="toolbar">
            <button className="primary" disabled={busy} aria-busy={busy} onClick={submitProduce}>
              {l("Selesaikan produksi", "Finish production")}
            </button>
            <button disabled={busy} onClick={() => setProduce(null)}>
              {l("Batal", "Cancel")}
            </button>
          </div>
        </div>
      )}

      <CustomFieldsSection
        model="production_order"
        value={doc.custom ?? {}}
        editable={false}
        recordId={doc.id}
        onSaved={(c) => setDoc({ ...doc, custom: c })}
      />

      <h2>{l("Bahan", "Components")}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Produk", "Product")}</th>
              <th className="num">{l("Dibutuhkan", "Required")}</th>
              {doc.state !== "done" && <th className="num">{l("Tersedia", "Available")}</th>}
              <th className="num">{l("Terpakai", "Consumed")}</th>
              {doc.state === "done" && <th className="num">{l("Nilai", "Value")}</th>}
            </tr>
          </thead>
          <tbody>
            {doc.components.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.sku} {c.productName}
                  {c.tracking !== "none" && <small className="muted"> · {c.tracking}</small>}
                </td>
                <td className="num">{money(c.qtyRequired, locale, 4)}</td>
                {doc.state !== "done" && (
                  <td className={`num${c.short ? " overdue" : ""}`}>
                    {c.available == null ? "—" : money(c.available, locale, 4)}
                    {c.short && (
                      <small>
                        {" "}
                        ({l("kurang", "short")} {Number(c.short)})
                      </small>
                    )}
                  </td>
                )}
                <td className="num">
                  {produce ? (
                    <input
                      className="num short"
                      inputMode="decimal"
                      aria-label={l(`Terpakai ${c.sku}`, `Consumed ${c.sku}`)}
                      value={produce.consumed[c.id] ?? ""}
                      onChange={(e) =>
                        setProduce({ ...produce, consumed: { ...produce.consumed, [c.id]: e.target.value } })
                      }
                    />
                  ) : c.qtyConsumed == null ? (
                    "—"
                  ) : (
                    money(c.qtyConsumed, locale, 4)
                  )}
                </td>
                {doc.state === "done" && <td className="num">{c.value == null ? "—" : m(c.value)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {doc.operations.length > 0 && (
        <>
          <h2>{l("Operasi", "Operations")}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Operasi", "Operation")}</th>
                  <th>{l("Stasiun kerja", "Work center")}</th>
                  <th className="num">{l("Menit rencana", "Planned min")}</th>
                  <th className="num">{l("Menit aktual", "Actual min")}</th>
                  <th className="num">{l("Biaya", "Cost")}</th>
                  <th>{l("Status", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {doc.operations.map((o) => (
                  <tr key={o.id}>
                    <td>{o.name}</td>
                    <td>{o.workCenterName}</td>
                    <td className="num">{money(o.plannedMinutes, locale, 2)}</td>
                    <td className="num">
                      {write && open && o.state !== "done" ? (
                        <input
                          className="num short"
                          inputMode="decimal"
                          aria-label={l(`Menit aktual ${o.name}`, `Actual minutes ${o.name}`)}
                          placeholder={o.state === "running" ? l("otomatis", "auto") : ""}
                          value={minutes[o.id] ?? n(o.actualMinutes)}
                          onChange={(e) => setMinutes({ ...minutes, [o.id]: e.target.value })}
                        />
                      ) : o.actualMinutes == null ? (
                        "—"
                      ) : (
                        money(o.actualMinutes, locale, 2)
                      )}
                    </td>
                    <td className="num">{m(o.state === "done" ? o.cost : o.plannedCost)}</td>
                    <td>
                      {write && open && o.state === "pending" && (
                        <button
                          className="link"
                          disabled={busy}
                          onClick={() => post(`operations/${o.id}`, { action: "start" })}
                        >
                          {l("Mulai", "Start")}
                        </button>
                      )}
                      {write && open && o.state !== "done" && (
                        <button
                          className="link"
                          disabled={busy}
                          onClick={() =>
                            post(`operations/${o.id}`, {
                              action: "finish",
                              actualMinutes: minutes[o.id] ? minutes[o.id] : null,
                            })
                          }
                        >
                          {l("Selesai", "Finish")}
                        </button>
                      )}
                      {o.state === "done" && "✓"}
                      {o.state === "running" && <small className="muted"> {l("berjalan", "running")}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {doc?.state === "done" && <QualityChecksPanel productionOrderId={doc.id} />}
      {id && id !== "new" && <RelatedDocuments model="production_order" id={id} />}
    </div>
  );
}

function Page() {
  const { id } = useParams<{ id: string }>();
  return id === "new" ? <NewOrder /> : <OrderForm id={id} />;
}

export default function ProductionOrderPage() {
  return (
    <Suspense>
      <Page />
    </Suspense>
  );
}
