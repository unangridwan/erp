"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { formatDate, money, today } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import {
  can,
  DELIVERY_STATUS_LABEL,
  INVOICE_STATUS_LABEL,
  MOVE_TYPE_LABEL,
  ORDER_STATE_LABEL,
  PAYMENT_STATE_LABEL,
  PICKING_STATE_LABEL,
  PURCHASE_STATE_LABEL,
} from "../../lib/resources";
import { download } from "../accounting/download";
import { useOptions, type ProductOption, type TaxOption, type UomOption } from "../accounting/use-options";
import { UomPick } from "../uom-pick";
import { Chatter } from "../chatter";
import { ActivitiesPanel } from "../crm/activities-panel";
import { useMe } from "../me-context";
import { RefSelect } from "../ref-select";
import { ask } from "../feedback";

interface OrderLine {
  id: string;
  productId: string | null;
  name: string;
  quantity: string;
  priceUnit: string;
  discount: string;
  taxIds: string[];
  priceSubtotal: string;
  isDownpayment: boolean;
  qtyInvoiced: string;
  qtyDelivered: string;
  productType: string | null;
  uomId: string | null;
  uomName: string | null;
  dropship: boolean;
}
interface Order {
  id: string;
  name: string;
  state: "draft" | "sent" | "sale" | "cancel";
  partnerId: string;
  partnerName: string;
  dateOrder: string;
  validityDate: string | null;
  paymentTermId: string | null;
  pricelistId: string | null;
  currencyCode: string;
  userId: string | null;
  teamId: string | null;
  leadId: string | null;
  leadName: string | null;
  clientOrderRef: string | null;
  note: string | null;
  branchId: string | null;
  icPurchaseOrderId: string | null;
  amountUntaxed: string;
  amountTax: string;
  amountTotal: string;
  invoiceStatus: string;
  deliveryStatus: string;
  warehouseId: string | null;
  pickings: { id: string; name: string; state: string; pickingType: string; scheduledDate: string }[];
  dropshipOrders: { id: string; name: string; state: string }[];
  lines: OrderLine[];
  taxes: { taxId: string; name: string; amount: string }[];
  invoices: {
    id: string;
    name: string | null;
    moveType: string;
    state: string;
    date: string;
    amountTotal: string;
    paymentState: string;
  }[];
}
interface Preview {
  currencyCode: string;
  paymentTermId: string | null;
  pricelistId: string | null;
  userId: string | null;
  lines: {
    priceUnit: string;
    taxIds: string[];
    priceSubtotal: string;
    uomId: string | null;
    dropship: boolean;
  }[];
  taxes: { taxId: string; name: string; amount: string }[];
  amountUntaxed: string;
  amountTax: string;
  amountTotal: string;
}

/** Baris form: harga kosong = dari daftar harga; pajak null = pajak bawaan. */
interface FormLine {
  productId: string;
  name: string;
  quantity: string;
  priceUnit: string;
  discount: string;
  taxIds: string[] | null;
  /** Kosong = satuan jual produk. */
  uomId: string;
  /** null = bawaan produk. */
  dropship: boolean | null;
}
const emptyLine = (): FormLine => ({
  productId: "",
  name: "",
  quantity: "1",
  priceUnit: "",
  discount: "0",
  taxIds: null,
  uomId: "",
  dropship: null,
});
const num = (v: string) => String(Number(v));
const orNull = (v: string) => (v === "" ? null : v);

type Defaultable = "paymentTermId" | "pricelistId" | "userId";

export function OrderForm(props: { id: string; leadId?: string; partnerId?: string }) {
  const me = useMe();
  const router = useRouter();
  const { l, tx, locale } = useI18n();
  const isNew = props.id === "new";
  const [order, setOrder] = useState<Order | null>(null);
  const [version, setVersion] = useState(0);
  const [header, setHeader] = useState({
    partnerId: props.partnerId ?? "",
    dateOrder: today(),
    validityDate: "",
    paymentTermId: "",
    pricelistId: "",
    userId: "",
    teamId: "",
    clientOrderRef: "",
    note: "",
    branchId: "",
    warehouseId: "",
  });
  // Field yang belum diubah user pada penawaran baru mengikuti bawaan pelanggan.
  const [touched, setTouched] = useState<Set<Defaultable>>(new Set());
  const [lines, setLines] = useState<FormLine[]>([emptyLine()]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState<{ method: string; value: string; date: string } | null>(
    null,
  );

  // Produk induk varian tidak dipilih langsung; pilih variannya.
  const products = useOptions<ProductOption>("/products").filter((p) => !p.isVariantTemplate);
  const uoms = useOptions<UomOption>("/uoms");
  const taxes = useOptions<TaxOption>("/taxes");
  const terms = useOptions<{ id: string; name: string }>("/payment-terms");
  const pricelists = useOptions<{ id: string; name: string; currencyCode: string }>("/pricelists");
  const users = useOptions<{ id: string; name: string }>("/users/options");
  const teams = useOptions<{ id: string; name: string }>("/sales-teams");
  const branches = useOptions<{ id: string; name: string }>("/branches");
  const warehouses = useOptions<{ id: string; code: string; name: string }>("/warehouses");
  const saleTaxes = taxes.filter((t) => t.typeTaxUse === "sale");

  useEffect(() => {
    if (isNew) return;
    api<Order>(`/sale-orders/${props.id}`)
      .then((o) => {
        setOrder(o);
        setHeader({
          partnerId: o.partnerId,
          dateOrder: o.dateOrder,
          validityDate: o.validityDate ?? "",
          paymentTermId: o.paymentTermId ?? "",
          pricelistId: o.pricelistId ?? "",
          userId: o.userId ?? "",
          teamId: o.teamId ?? "",
          clientOrderRef: o.clientOrderRef ?? "",
          note: o.note ?? "",
          branchId: o.branchId ?? "",
          warehouseId: o.warehouseId ?? "",
        });
        setLines(
          o.lines
            .filter((x) => !x.isDownpayment)
            .map((x) => ({
              productId: x.productId ?? "",
              name: x.name,
              quantity: num(x.quantity),
              priceUnit: num(x.priceUnit),
              discount: num(x.discount),
              taxIds: x.taxIds,
              uomId: x.uomId ?? "",
              dropship: x.dropship,
            })),
        );
      })
      .catch((e: Error) => setError(e.message));
  }, [props.id, isNew, version]);

  const editable =
    (isNew || order?.state === "draft" || order?.state === "sent") && can(me.permissions, "sales.write");

  function payload() {
    const defaultable = (f: Defaultable) => (isNew && !touched.has(f) ? undefined : orNull(header[f]));
    return {
      partnerId: header.partnerId,
      dateOrder: header.dateOrder,
      validityDate: orNull(header.validityDate),
      paymentTermId: defaultable("paymentTermId"),
      pricelistId: defaultable("pricelistId"),
      userId: defaultable("userId"),
      teamId: orNull(header.teamId),
      leadId: order?.leadId ?? props.leadId ?? null,
      clientOrderRef: orNull(header.clientOrderRef),
      note: orNull(header.note),
      branchId: orNull(header.branchId),
      warehouseId: header.warehouseId || undefined,
      lines: lines
        .filter((x) => x.productId || x.name)
        .map((x) => ({
          productId: orNull(x.productId),
          name: x.name || undefined,
          quantity: x.quantity || "0",
          priceUnit: x.priceUnit === "" ? null : x.priceUnit,
          discount: x.discount || "0",
          taxIds: x.taxIds ?? undefined,
          uomId: orNull(x.uomId),
          dropship: x.dropship ?? undefined,
        })),
    };
  }

  // Pratinjau harga & total dari server (daftar harga, pajak bawaan), ditunda agar tidak tiap ketikan.
  const body = useMemo(() => JSON.stringify(payload()), [header, lines, touched, order]);
  const seq = useRef(0);
  useEffect(() => {
    if (!editable) return;
    const parsed = JSON.parse(body) as ReturnType<typeof payload>;
    if (!parsed.partnerId || !parsed.lines.length) {
      setPreview(null);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      api<Preview>("/sale-orders/compute", { method: "POST", body: parsed })
        .then((p) => {
          if (mine !== seq.current) return;
          setPreview(p);
          setFieldErrors({});
          if (isNew) {
            setHeader((h) => ({
              ...h,
              paymentTermId: touched.has("paymentTermId") ? h.paymentTermId : (p.paymentTermId ?? ""),
              pricelistId: touched.has("pricelistId") ? h.pricelistId : (p.pricelistId ?? ""),
              userId: touched.has("userId") ? h.userId : (p.userId ?? ""),
            }));
          }
        })
        .catch((e) => {
          if (mine !== seq.current) return;
          if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [body, editable, isNew]);

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

  const save = async () => {
    if (isNew) {
      const created = await api<Order>("/sale-orders", { method: "POST", body: payload() });
      router.replace(`/sales/orders/${created.id}`);
      return null;
    }
    if (editable) await api(`/sale-orders/${props.id}`, { method: "PUT", body: payload() });
    return props.id;
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if ((await save()) !== null) setVersion((v) => v + 1);
    });
  };

  const action = (path: string, bodyArg?: object) =>
    run(async () => {
      // Simpan perubahan penawaran dulu agar aksi memakai isi terbaru.
      if (editable) await save();
      await api(`/sale-orders/${props.id}/${path}`, { method: "POST", body: bodyArg ?? {} });
      setVersion((v) => v + 1);
    });

  const send = () => {
    const to = prompt(
      l("Kirim ke email (kosong = email pelanggan)", "Send to email (empty = customer email)"),
      "",
    );
    if (to === null) return;
    void action("send", { to: to || null });
  };

  const createInvoice = () =>
    run(async () => {
      if (!invoiceForm) return;
      const bodyArg =
        invoiceForm.method === "regular"
          ? { method: "regular", date: invoiceForm.date }
          : invoiceForm.method === "percentage"
            ? { method: "percentage", percentage: Number(invoiceForm.value), date: invoiceForm.date }
            : { method: "fixed", amount: invoiceForm.value, date: invoiceForm.date };
      const res = await api<{ moveId: string }>(`/sale-orders/${props.id}/invoice`, {
        method: "POST",
        body: bodyArg,
      });
      router.push(`/accounting/moves/${res.moveId}`);
    });

  if (!isNew && !order) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;

  const err = (path: string) => fieldErrors[path] && <small className="error">{fieldErrors[path]}</small>;
  const setLine = (i: number, patch: Partial<FormLine>) =>
    setLines((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setDefaultable = (f: Defaultable, v: string) => {
    setTouched((t) => new Set(t).add(f));
    setHeader((h) => ({ ...h, [f]: v }));
  };
  const totals = editable && preview ? preview : order;
  const currency = (editable && preview?.currencyCode) || order?.currencyCode || "";
  const confirmed = order?.state === "sale";
  const title = order?.name ?? l("Penawaran baru", "New quotation");
  const dpLines = order?.lines.filter((x) => x.isDownpayment) ?? [];

  return (
    <div className="form-layout">
      <div className="stack-wide">
        <form className="panel" onSubmit={onSubmit}>
          <header className="toolbar">
            <h1>{title}</h1>
            {order && (
              <span className={`badge state-${order.state}`}>{tx(ORDER_STATE_LABEL[order.state]!)}</span>
            )}
            {confirmed && order && order.deliveryStatus !== "no" && (
              <span className="badge">{tx(DELIVERY_STATUS_LABEL[order.deliveryStatus]!)}</span>
            )}
            {confirmed && order && (
              <span className={`badge state-${order.invoiceStatus}`}>
                {tx(INVOICE_STATUS_LABEL[order.invoiceStatus]!)}
              </span>
            )}
            {editable && (
              <button className="primary" disabled={busy}>
                {l("Simpan", "Save")}
              </button>
            )}
            {order && editable && (
              <>
                <button type="button" disabled={busy} onClick={send}>
                  {l("Kirim email", "Send by email")}
                </button>
                <button type="button" className="primary" disabled={busy} onClick={() => action("confirm")}>
                  {l("Konfirmasi", "Confirm")}
                </button>
              </>
            )}
            {order && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    download(`/sale-orders/${order.id}/pdf`, `${order.name.replace(/[^\w.-]+/g, "_")}.pdf`),
                  )
                }
              >
                PDF
              </button>
            )}
            {confirmed &&
              order?.invoiceStatus === "to_invoice" &&
              can(me.permissions, "sales.write") &&
              can(me.permissions, "accounting.write") && (
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => setInvoiceForm({ method: "regular", value: "", date: today() })}
                >
                  {l("Buat faktur", "Create invoice")}
                </button>
              )}
            {order && order.state !== "cancel" && can(me.permissions, "sales.write") && (
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={async () =>
                  (await ask(l("Batalkan pesanan ini?", "Cancel this order?"))) && action("cancel")
                }
              >
                {l("Batalkan", "Cancel")}
              </button>
            )}
            {order?.state === "cancel" && can(me.permissions, "sales.write") && (
              <>
                <button type="button" disabled={busy} onClick={() => action("draft")}>
                  {l("Jadikan draft", "Set to draft")}
                </button>
              </>
            )}
            {order &&
              (order.state === "draft" || order.state === "cancel") &&
              can(me.permissions, "sales.write") && (
                <button
                  type="button"
                  className="link"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (!(await ask(l("Hapus penawaran ini?", "Delete this quotation?")))) return;
                      await api(`/sale-orders/${order.id}`, { method: "DELETE" });
                      router.replace("/sales/quotations");
                    })
                  }
                >
                  {l("Hapus", "Delete")}
                </button>
              )}
          </header>
          {error && <p className="error">{error}</p>}
          {order?.icPurchaseOrderId && (
            <p className="notice">
              {l(
                "Terhubung dengan pesanan pembelian di perusahaan grup; faktur yang diposting otomatis menjadi draft tagihan di sana.",
                "Linked to a purchase order in a group company; posted invoices automatically become draft bills there.",
              )}
            </p>
          )}

          {invoiceForm && (
            <div className="inline-panel">
              <label className="field">
                <span>{l("Jenis faktur", "Invoice type")}</span>
                <select
                  value={invoiceForm.method}
                  onChange={(e) => setInvoiceForm({ ...invoiceForm, method: e.target.value })}
                >
                  <option value="regular">
                    {l("Faktur biasa (sisa kuantitas, potong uang muka)", "Regular invoice")}
                  </option>
                  <option value="percentage">
                    {l("Uang muka (persentase)", "Down payment (percentage)")}
                  </option>
                  <option value="fixed">
                    {l("Uang muka (jumlah tetap, sebelum pajak)", "Down payment (fixed, untaxed)")}
                  </option>
                </select>
              </label>
              {invoiceForm.method !== "regular" && (
                <label className="field">
                  <span>{invoiceForm.method === "percentage" ? "%" : l("Jumlah", "Amount")}</span>
                  <input
                    className="num short"
                    inputMode="decimal"
                    required
                    value={invoiceForm.value}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, value: e.target.value })}
                  />
                  {err("amount")}
                </label>
              )}
              <label className="field">
                <span>{l("Tanggal faktur", "Invoice date")}</span>
                <input
                  type="date"
                  value={invoiceForm.date}
                  onChange={(e) => setInvoiceForm({ ...invoiceForm, date: e.target.value })}
                />
              </label>
              <button type="button" className="primary" disabled={busy} onClick={createInvoice}>
                {l("Buat draft faktur", "Create draft invoice")}
              </button>
              <button type="button" className="link" onClick={() => setInvoiceForm(null)}>
                {l("Batal", "Cancel")}
              </button>
            </div>
          )}

          <fieldset className="fields" disabled={!editable}>
            <label className="field">
              <span>{l("Pelanggan *", "Customer *")}</span>
              <RefSelect
                name="partnerId"
                resource="partners"
                display="name"
                required
                value={header.partnerId}
                onChange={(v) => setHeader((h) => ({ ...h, partnerId: v }))}
              />
              {err("partnerId")}
            </label>
            <label className="field">
              <span>{l("Tanggal *", "Date *")}</span>
              <input
                type="date"
                required
                value={header.dateOrder}
                onChange={(e) => setHeader((h) => ({ ...h, dateOrder: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>{l("Berlaku hingga", "Expiration")}</span>
              <input
                type="date"
                value={header.validityDate}
                onChange={(e) => setHeader((h) => ({ ...h, validityDate: e.target.value }))}
              />
              {err("validityDate")}
            </label>
            <label className="field">
              <span>{l("Termin pembayaran", "Payment terms")}</span>
              <select
                value={header.paymentTermId}
                onChange={(e) => setDefaultable("paymentTermId", e.target.value)}
              >
                <option value="">—</option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Daftar harga", "Pricelist")}</span>
              <select
                value={header.pricelistId}
                onChange={(e) => setDefaultable("pricelistId", e.target.value)}
              >
                <option value="">{l("Harga jual produk", "Product sales price")}</option>
                {pricelists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.currencyCode})
                  </option>
                ))}
              </select>
              {err("pricelistId")}
            </label>
            <label className="field">
              <span>{l("Penjual", "Salesperson")}</span>
              <select value={header.userId} onChange={(e) => setDefaultable("userId", e.target.value)}>
                <option value="">—</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              {err("userId")}
            </label>
            <label className="field">
              <span>{l("Tim penjualan", "Sales team")}</span>
              <select
                value={header.teamId}
                onChange={(e) => setHeader((h) => ({ ...h, teamId: e.target.value }))}
              >
                <option value="">—</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Ref. pelanggan (no. PO)", "Customer reference")}</span>
              <input
                value={header.clientOrderRef}
                onChange={(e) => setHeader((h) => ({ ...h, clientOrderRef: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>{l("Cabang", "Branch")}</span>
              <select
                value={header.branchId}
                onChange={(e) => setHeader((h) => ({ ...h, branchId: e.target.value }))}
              >
                <option value="">—</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {err("branchId")}
            </label>
            <label className="field">
              <span>{l("Dikirim dari gudang", "Ship from warehouse")}</span>
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
            {(order?.leadId ?? props.leadId) && (
              <p className="field">
                <span>{l("Peluang", "Opportunity")}</span>
                <Link href={`/crm/leads/${order?.leadId ?? props.leadId}`}>
                  {order?.leadName ?? l("Lihat", "Open")}
                </Link>
              </p>
            )}
          </fieldset>

          <h2>{l("Baris pesanan", "Order lines")}</h2>
          <div className="table-wrap">
            <table className="lines">
              <thead>
                <tr>
                  <th>{l("Produk", "Product")}</th>
                  <th>{l("Deskripsi", "Description")}</th>
                  <th className="num">{l("Qty", "Qty")}</th>
                  {confirmed && <th className="num">{l("Terkirim", "Delivered")}</th>}
                  {confirmed && <th className="num">{l("Tertagih", "Invoiced")}</th>}
                  <th className="num">{l("Harga", "Price")}</th>
                  <th className="num">{l("Disk %", "Disc %")}</th>
                  <th>{l("Pajak", "Taxes")}</th>
                  <th className="num">{l("Subtotal", "Subtotal")}</th>
                  {editable && <th />}
                </tr>
              </thead>
              <tbody>
                {lines.map((x, i) => {
                  const p = editable ? preview?.lines[i] : undefined;
                  const saved = !editable ? order?.lines.filter((o) => !o.isDownpayment)[i] : undefined;
                  const shownTaxes = x.taxIds ?? p?.taxIds ?? [];
                  if (!editable)
                    return (
                      <tr key={i}>
                        <td>{products.find((pr) => pr.id === x.productId)?.sku ?? ""}</td>
                        <td>{x.name}</td>
                        <td className="num">
                          {money(x.quantity, locale, 4)} {saved?.uomName ?? ""}
                          {saved?.dropship && <small className="muted"> · dropship</small>}
                        </td>
                        {confirmed && (
                          <td className="num">
                            {saved && saved.productType !== "service" && saved.productId
                              ? money(saved.qtyDelivered, locale, 4)
                              : "—"}
                          </td>
                        )}
                        {confirmed && (
                          <td className="num">{saved ? money(saved.qtyInvoiced, locale, 4) : ""}</td>
                        )}
                        <td className="num">{money(x.priceUnit, locale, 4)}</td>
                        <td className="num">{money(x.discount, locale)}</td>
                        <td>
                          <small>
                            {shownTaxes
                              .map((tid) => saleTaxes.find((t) => t.id === tid)?.name ?? "")
                              .join(", ")}
                          </small>
                        </td>
                        <td className="num">{money(saved?.priceSubtotal ?? "", locale)}</td>
                      </tr>
                    );
                  return (
                    <tr key={i}>
                      <td>
                        <select
                          disabled={!editable}
                          value={x.productId}
                          onChange={(e) => {
                            const product = products.find((pr) => pr.id === e.target.value);
                            // Harga dikosongkan agar diambil dari daftar harga.
                            setLine(i, {
                              productId: e.target.value,
                              name: product?.name ?? x.name,
                              priceUnit: "",
                              uomId: "",
                              dropship: null,
                            });
                          }}
                        >
                          <option value="">—</option>
                          {products.map((pr) => (
                            <option key={pr.id} value={pr.id}>
                              {pr.sku} {pr.name}
                            </option>
                          ))}
                        </select>
                        {err(`lines.${i}.productId`)}
                      </td>
                      <td>
                        <input
                          disabled={!editable}
                          value={x.name}
                          onChange={(e) => setLine(i, { name: e.target.value })}
                        />
                        {err(`lines.${i}.name`)}
                      </td>
                      <td>
                        <input
                          disabled={!editable}
                          className="num short"
                          inputMode="decimal"
                          value={x.quantity}
                          onChange={(e) => setLine(i, { quantity: e.target.value })}
                        />
                        <UomPick
                          product={products.find((pr) => pr.id === x.productId)}
                          uoms={uoms}
                          value={
                            x.uomId ||
                            p?.uomId ||
                            products.find((pr) => pr.id === x.productId)?.saleUomId ||
                            ""
                          }
                          onChange={(uomId) => setLine(i, { uomId, priceUnit: "" })}
                        />
                        {err(`lines.${i}.uomId`)}
                        {x.productId && (
                          <label
                            className="inline-check"
                            title={l(
                              "Dikirim pemasok langsung ke pelanggan",
                              "Vendor ships directly to customer",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={x.dropship ?? p?.dropship ?? false}
                              onChange={(e) => setLine(i, { dropship: e.target.checked })}
                            />{" "}
                            <small>dropship</small>
                          </label>
                        )}
                        {err(`lines.${i}.dropship`)}
                      </td>
                      {confirmed && <td className="num">{saved ? num(saved.qtyInvoiced) : ""}</td>}
                      <td>
                        <input
                          className="num"
                          inputMode="decimal"
                          placeholder={p ? money(p.priceUnit, locale, 4) : l("otomatis", "auto")}
                          value={x.priceUnit}
                          onChange={(e) => setLine(i, { priceUnit: e.target.value })}
                        />
                        {err(`lines.${i}.priceUnit`)}
                      </td>
                      <td>
                        <input
                          disabled={!editable}
                          className="num short"
                          inputMode="decimal"
                          value={x.discount}
                          onChange={(e) => setLine(i, { discount: e.target.value })}
                        />
                      </td>
                      <td>
                        <div className="tax-picks">
                          {saleTaxes.map((t) => (
                            <label key={t.id} title={t.name}>
                              <input
                                type="checkbox"
                                disabled={!editable}
                                checked={shownTaxes.includes(t.id)}
                                onChange={(e) =>
                                  setLine(i, {
                                    taxIds: e.target.checked
                                      ? [...shownTaxes, t.id]
                                      : shownTaxes.filter((tid) => tid !== t.id),
                                  })
                                }
                              />{" "}
                              {t.name}
                            </label>
                          ))}
                        </div>
                        {err(`lines.${i}.taxIds`)}
                      </td>
                      <td className="num">{money(p?.priceSubtotal ?? saved?.priceSubtotal ?? "", locale)}</td>
                      {editable && (
                        <td>
                          <button
                            type="button"
                            className="link"
                            aria-label={l("Hapus baris", "Remove line")}
                            onClick={() => setLines((r) => r.filter((_, j) => j !== i))}
                          >
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {dpLines.map((x) => (
                  <tr key={x.id} className="detail">
                    <td />
                    <td>{x.name}</td>
                    <td className="num">—</td>
                    {confirmed && <td className="num">—</td>}
                    {confirmed && <td className="num">{num(x.qtyInvoiced)}</td>}
                    <td className="num">{money(x.priceUnit, locale)}</td>
                    <td />
                    <td />
                    <td className="num">0</td>
                  </tr>
                ))}
              </tbody>
              {editable && (
                <tfoot>
                  <tr>
                    <td colSpan={8}>
                      <button
                        type="button"
                        className="link"
                        onClick={() => setLines((r) => [...r, emptyLine()])}
                      >
                        + {l("Tambah baris", "Add line")}
                      </button>
                      {err("lines")}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {totals && (
            <dl className="totals">
              <dt>{l("Subtotal", "Untaxed amount")}</dt>
              <dd>{money(totals.amountUntaxed, locale)}</dd>
              {(editable && preview ? preview.taxes : (order?.taxes ?? [])).map((t) => (
                <div key={t.taxId} className="contents">
                  <dt>{t.name}</dt>
                  <dd>{money(t.amount, locale)}</dd>
                </div>
              ))}
              <dt>
                <strong>{l("Total", "Total")}</strong>
              </dt>
              <dd>
                <strong>
                  {currency} {money(totals.amountTotal, locale)}
                </strong>
              </dd>
            </dl>
          )}

          <label className="field">
            <span>{l("Syarat & catatan", "Terms & notes")}</span>
            <textarea
              rows={3}
              disabled={!editable}
              value={header.note}
              onChange={(e) => setHeader((h) => ({ ...h, note: e.target.value }))}
            />
          </label>

          {order && order.pickings.length > 0 && (
            <>
              <h2>{l("Pengiriman", "Deliveries")}</h2>
              <div className="table-scroll">
                <table>
                  <tbody>
                    {order.pickings.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/inventory/pickings/${p.id}`}>{p.name}</Link>
                          {p.pickingType === "incoming" && (
                            <small className="muted"> · {l("retur", "return")}</small>
                          )}
                          {p.pickingType === "dropship" && <small className="muted"> · dropship</small>}
                        </td>
                        <td>{formatDate(p.scheduledDate, locale)}</td>
                        <td>
                          <span className={`badge state-${p.state === "done" ? "posted" : p.state}`}>
                            {tx(PICKING_STATE_LABEL[p.state]!)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {order && order.dropshipOrders.length > 0 && (
            <>
              <h2>{l("Pembelian dropship", "Dropship purchases")}</h2>
              <div className="table-scroll">
                <table>
                  <tbody>
                    {order.dropshipOrders.map((po) => (
                      <tr key={po.id}>
                        <td>
                          <Link href={`/purchase/orders/${po.id}`}>{po.name}</Link>
                        </td>
                        <td>
                          <span className="badge">{tx(PURCHASE_STATE_LABEL[po.state]!)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {order && order.invoices.length > 0 && (
            <>
              <h2>{l("Faktur", "Invoices")}</h2>
              <div className="table-scroll">
                <table>
                  <tbody>
                    {order.invoices.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <Link href={`/accounting/moves/${m.id}`}>{m.name ?? l("Draft", "Draft")}</Link>{" "}
                          <small className="muted">{tx(MOVE_TYPE_LABEL[m.moveType]!)}</small>
                        </td>
                        <td>{formatDate(m.date, locale)}</td>
                        <td>
                          <span className={`badge state-${m.state}`}>
                            {m.state === "posted" ? l("Diposting", "Posted") : l("Draft", "Draft")}
                          </span>{" "}
                          {m.state === "posted" && PAYMENT_STATE_LABEL[m.paymentState] && (
                            <span className={`badge pay-${m.paymentState}`}>
                              {tx(PAYMENT_STATE_LABEL[m.paymentState]!)}
                            </span>
                          )}
                        </td>
                        <td className="num">{money(m.amountTotal, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </form>
        {order && (
          <ActivitiesPanel
            resModel="sale_order"
            resId={order.id}
            editable={can(me.permissions, "sales.write")}
            onChange={() => setVersion((v) => v + 1)}
          />
        )}
      </div>
      {order && <Chatter model="sale_order" id={order.id} version={version} labels={{}} />}
    </div>
  );
}
