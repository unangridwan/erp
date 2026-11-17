"use client";

import { CustomFieldsSection, customPayload, useCustomFields, type CustomValues } from "../custom-fields";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { formatDate, money, today } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import {
  can,
  INVOICE_STATUS_LABEL,
  MOVE_TYPE_LABEL,
  PAYMENT_STATE_LABEL,
  PICKING_STATE_LABEL,
  PURCHASE_STATE_LABEL,
  RECEIPT_STATUS_LABEL,
} from "../../lib/resources";
import { download } from "../accounting/download";
import {
  useOptions,
  type CurrencyOption,
  type ProductOption,
  type TaxOption,
  type UomOption,
} from "../accounting/use-options";
import { Chatter } from "../chatter";
import { RelatedDocuments } from "../related-documents";
import { UomPick } from "../uom-pick";
import { useMe } from "../me-context";
import { RefSelect } from "../ref-select";
import { ask } from "../feedback";

interface Line {
  id: string;
  productId: string | null;
  productType: string | null;
  name: string;
  quantity: string;
  priceUnit: string;
  discount: string;
  taxIds: string[];
  priceSubtotal: string;
  qtyReceived: string;
  uomId: string | null;
  uomName: string | null;
  qtyBilled: string;
  contractLineId: string | null;
}
interface Order {
  id: string;
  custom?: CustomValues;
  name: string;
  state: "draft" | "sent" | "to_approve" | "purchase" | "cancel";
  partnerId: string;
  partnerRef: string | null;
  icSaleOrderId: string | null;
  dateOrder: string;
  datePlanned: string | null;
  paymentTermId: string | null;
  currencyCode: string;
  userId: string | null;
  warehouseId: string | null;
  note: string | null;
  amountUntaxed: string;
  amountTax: string;
  amountTotal: string;
  billStatus: string;
  receiptStatus: string;
  approvedAt: string | null;
  contractId: string | null;
  contract: { id: string; name: string } | null;
  /** Peringatan kontrak (melebihi sisa/plafon, di luar masa kontrak). */
  contractWarnings: string[];
  /** Tahap persetujuan (bila menunggu persetujuan). */
  approval: {
    step: number;
    levels: number;
    steps: { step: number; label: string | null; approver: string }[];
    canApprove: boolean;
  } | null;
  lines: Line[];
  taxes: { taxId: string; name: string; amount: string }[];
  pickings: { id: string; name: string; state: string; pickingType: string; scheduledDate: string }[];
  bills: {
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
  lines: {
    priceUnit: string;
    taxIds: string[];
    priceSubtotal: string;
    uomId: string | null;
    contractLineId: string | null;
  }[];
  contractId: string | null;
  taxes: { taxId: string; name: string; amount: string }[];
  amountUntaxed: string;
  amountTotal: string;
  currencyCode: string;
}
interface FormLine {
  productId: string;
  name: string;
  quantity: string;
  priceUnit: string;
  discount: string;
  taxIds: string[] | null;
  /** Kosong = satuan beli produk. */
  uomId: string;
  /** Baris kontrak pembelian (dipertahankan saat menyimpan ulang). */
  contractLineId: string;
}

const emptyLine = (): FormLine => ({
  productId: "",
  name: "",
  quantity: "1",
  priceUnit: "",
  discount: "0",
  taxIds: null,
  uomId: "",
  contractLineId: "",
});
const num = (v: string) => String(Number(v));
interface ContractOption {
  id: string;
  name: string;
  dateStart: string;
  dateEnd: string;
  valid: boolean;
}
const orNull = (v: string) => (v === "" ? null : v);

export function PurchaseForm({ id }: { id: string }) {
  const me = useMe();
  const router = useRouter();
  const { l, tx, locale } = useI18n();
  const isNew = id === "new";
  const [order, setOrder] = useState<Order | null>(null);
  const [version, setVersion] = useState(0);
  const [header, setHeader] = useState({
    partnerId: "",
    partnerRef: "",
    dateOrder: today(),
    datePlanned: "",
    paymentTermId: "",
    currencyCode: "",
    warehouseId: "",
    note: "",
    contractId: "",
  });
  const [contracts, setContracts] = useState<ContractOption[]>([]);
  const [lines, setLines] = useState<FormLine[]>([emptyLine()]);
  const [custom, setCustom] = useState<CustomValues>({});
  const customDefs = useCustomFields("purchase_order");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // Produk induk varian tidak dipilih langsung; pilih variannya.
  const products = useOptions<ProductOption>("/products").filter((p) => !p.isVariantTemplate);
  const uoms = useOptions<UomOption>("/uoms");
  const taxes = useOptions<TaxOption>("/taxes").filter((t) => t.typeTaxUse === "purchase");
  const terms = useOptions<{ id: string; name: string }>("/payment-terms");
  const currencies = useOptions<CurrencyOption>("/currencies");
  const warehouses = useOptions<{ id: string; code: string; name: string }>("/warehouses");

  useEffect(() => {
    if (isNew) return;
    api<Order>(`/purchase-orders/${id}`)
      .then((o) => {
        setOrder(o);
        setCustom(o.custom ?? {});
        setHeader({
          partnerId: o.partnerId,
          partnerRef: o.partnerRef ?? "",
          dateOrder: o.dateOrder,
          datePlanned: o.datePlanned ?? "",
          paymentTermId: o.paymentTermId ?? "",
          currencyCode: o.currencyCode,
          warehouseId: o.warehouseId ?? "",
          note: o.note ?? "",
          contractId: o.contractId ?? "",
        });
        setLines(
          o.lines.map((x) => ({
            productId: x.productId ?? "",
            name: x.name,
            quantity: num(x.quantity),
            priceUnit: num(x.priceUnit),
            discount: num(x.discount),
            taxIds: x.taxIds,
            uomId: x.uomId ?? "",
            contractLineId: x.contractLineId ?? "",
          })),
        );
      })
      .catch((e: Error) => setError(e.message));
  }, [id, isNew, version]);

  const editable =
    (isNew || order?.state === "draft" || order?.state === "sent") && can(me.permissions, "purchase.write");

  const payload = () => ({
    partnerId: header.partnerId,
    partnerRef: orNull(header.partnerRef),
    dateOrder: header.dateOrder,
    datePlanned: orNull(header.datePlanned),
    paymentTermId: isNew && !header.paymentTermId ? undefined : orNull(header.paymentTermId),
    currencyCode: header.currencyCode || undefined,
    warehouseId: orNull(header.warehouseId),
    note: orNull(header.note),
    contractId: orNull(header.contractId),
    ...(customDefs.length ? { custom: customPayload(customDefs, custom) } : {}),
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
        contractLineId: header.contractId ? orNull(x.contractLineId) : null,
      })),
  });

  // Pratinjau harga pemasok & total dari server.
  const body = useMemo(() => JSON.stringify(payload()), [header, lines]);
  const seq = useRef(0);
  useEffect(() => {
    if (!editable) return;
    const parsed = JSON.parse(body) as ReturnType<typeof payload>;
    if (!parsed.partnerId || !parsed.lines.length) return setPreview(null);
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      api<Preview>("/purchase-orders/compute", { method: "POST", body: parsed })
        .then((p) => mine === seq.current && setPreview(p))
        .catch((e) => mine === seq.current && e instanceof ApiError && setFieldErrors(e.fieldErrors));
    }, 300);
    return () => clearTimeout(timer);
  }, [body, editable]);

  // Kontrak pembelian aktif milik pemasok terpilih.
  useEffect(() => {
    if (!editable || !header.partnerId) return setContracts([]);
    api<ContractOption[]>(
      `/purchase-contracts/lookup?partnerId=${header.partnerId}&date=${header.dateOrder || today()}`,
    )
      .then(setContracts)
      .catch(() => setContracts([]));
  }, [editable, header.partnerId, header.dateOrder]);

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
      const created = await api<Order>("/purchase-orders", { method: "POST", body: payload() });
      router.replace(`/purchase/orders/${created.id}`);
      return false;
    }
    if (editable) await api(`/purchase-orders/${id}`, { method: "PUT", body: payload() });
    return true;
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (await save()) setVersion((v) => v + 1);
    });
  };
  const action = (path: string, bodyArg?: object) =>
    run(async () => {
      if (editable) await save();
      await api(`/purchase-orders/${id}/${path}`, { method: "POST", body: bodyArg ?? {} });
      setVersion((v) => v + 1);
    });
  const bill = () =>
    run(async () => {
      const res = await api<{ moveId: string }>(`/purchase-orders/${id}/bill`, { method: "POST", body: {} });
      router.push(`/accounting/moves/${res.moveId}`);
    });

  if (!isNew && !order) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;

  const err = (path: string) => fieldErrors[path] && <small className="error">{fieldErrors[path]}</small>;
  const setLine = (i: number, patch: Partial<FormLine>) =>
    setLines((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const confirmed = order?.state === "purchase";
  const totals = editable && preview ? preview : order;
  const taxRows = editable && preview ? preview.taxes : (order?.taxes ?? []);
  const currency = (editable && preview?.currencyCode) || order?.currencyCode || "";

  return (
    <div className="form-layout">
      <div className="stack-wide">
        <form className="panel" onSubmit={onSubmit}>
          <header className="toolbar">
            <h1>{order?.name ?? l("RFQ baru", "New RFQ")}</h1>
            {order && (
              <span className={`badge state-${order.state}`}>{tx(PURCHASE_STATE_LABEL[order.state]!)}</span>
            )}
            {confirmed && order && (
              <>
                <span className="badge">{tx(RECEIPT_STATUS_LABEL[order.receiptStatus]!)}</span>
                <span className={`badge state-${order.billStatus}`}>
                  {tx(INVOICE_STATUS_LABEL[order.billStatus]!)}
                </span>
              </>
            )}
            {editable && (
              <button className="primary" disabled={busy}>
                {l("Simpan", "Save")}
              </button>
            )}
            {order && editable && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const to = prompt(
                      l("Kirim ke email (kosong = email pemasok)", "Send to email (empty = vendor email)"),
                      "",
                    );
                    if (to !== null) void action("send", { to: to || null });
                  }}
                >
                  {l("Kirim RFQ", "Send RFQ")}
                </button>
                <button type="button" className="primary" disabled={busy} onClick={() => action("confirm")}>
                  {l("Konfirmasi pesanan", "Confirm order")}
                </button>
              </>
            )}
            {order?.state === "to_approve" && order.approval?.canApprove && (
              <button type="button" className="primary" disabled={busy} onClick={() => action("approve")}>
                {l("Setujui", "Approve")}
              </button>
            )}
            {order && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    download(
                      `/purchase-orders/${order.id}/pdf`,
                      `${order.name.replace(/[^\w.-]+/g, "_")}.pdf`,
                    ),
                  )
                }
              >
                PDF
              </button>
            )}
            {confirmed && order?.billStatus === "to_invoice" && can(me.permissions, "accounting.write") && (
              <button type="button" className="primary" disabled={busy} onClick={bill}>
                {l("Buat tagihan", "Create bill")}
              </button>
            )}
            {order && order.state !== "cancel" && can(me.permissions, "purchase.write") && (
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
            {order?.state === "cancel" && can(me.permissions, "purchase.write") && (
              <button type="button" disabled={busy} onClick={() => action("draft")}>
                {l("Jadikan RFQ", "Set to RFQ")}
              </button>
            )}
            {order &&
              (order.state === "draft" || order.state === "cancel") &&
              can(me.permissions, "purchase.write") && (
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    run(async () => {
                      if (!(await ask(l("Hapus pesanan ini?", "Delete this order?")))) return;
                      await api(`/purchase-orders/${order.id}`, { method: "DELETE" });
                      router.replace("/purchase/rfq");
                    })
                  }
                >
                  {l("Hapus", "Delete")}
                </button>
              )}
          </header>
          {error && <p className="error">{error}</p>}
          {order?.icSaleOrderId && (
            <p className="notice">
              {l(
                "Terhubung dengan pesanan penjualan di perusahaan grup; fakturnya otomatis menjadi draft tagihan PO ini.",
                "Linked to a sales order in a group company; its invoices automatically become draft bills for this PO.",
              )}
            </p>
          )}
          {(order?.contract || (editable && preview?.contractId)) && (
            <p className="muted">
              {l("Kontrak pembelian", "Purchase contract")}:{" "}
              {order?.contract ? (
                <Link href={`/purchase/contracts/${order.contract.id}`}>{order.contract.name}</Link>
              ) : (
                (contracts.find((c) => c.id === preview?.contractId)?.name ?? "—")
              )}
              {editable &&
                !header.contractId &&
                preview?.contractId &&
                ` — ${l("harga kontrak dipakai otomatis", "contract prices applied automatically")}`}
            </p>
          )}
          {order && order.contractWarnings.length > 0 && order.state !== "cancel" && (
            <div className="error" role="alert">
              <strong>
                {order.state === "purchase"
                  ? l("Dikonfirmasi di luar kontrak:", "Confirmed outside the contract:")
                  : l(
                      "Di luar kontrak — konfirmasi PO ini butuh persetujuan:",
                      "Outside the contract — confirming this PO requires approval:",
                    )}
              </strong>
              <ul>
                {order.contractWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {order?.state === "to_approve" && (
            <div className="notice">
              {order.approval && order.approval.levels > 0 ? (
                <>
                  {l("Menunggu persetujuan", "Waiting for approval")} — {l("tahap", "step")}{" "}
                  {order.approval.step}/{order.approval.levels}
                  <ol className="approval-steps">
                    {order.approval.steps.map((s) => (
                      <li key={s.step} className={s.step === order.approval!.step ? "current" : ""}>
                        {s.label ? `${s.label} — ` : ""}
                        {s.approver}
                        {s.step < order.approval!.step ? " ✓" : ""}
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                l(
                  "Total pesanan melebihi batas wewenang pembuat; menunggu persetujuan.",
                  "The order total exceeds the creator's approval limit; waiting for approval.",
                )
              )}
            </div>
          )}

          <fieldset className="fields" disabled={!editable}>
            <label className="field">
              <span>{l("Pemasok *", "Vendor *")}</span>
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
              <span>{l("Ref. pemasok (no. penawaran)", "Vendor reference")}</span>
              <input
                value={header.partnerRef}
                onChange={(e) => setHeader((h) => ({ ...h, partnerRef: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>{l("Tanggal pesanan *", "Order date *")}</span>
              <input
                type="date"
                required
                value={header.dateOrder}
                onChange={(e) => setHeader((h) => ({ ...h, dateOrder: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>{l("Rencana diterima", "Expected arrival")}</span>
              <input
                type="date"
                value={header.datePlanned}
                onChange={(e) => setHeader((h) => ({ ...h, datePlanned: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>{l("Termin pembayaran", "Payment terms")}</span>
              <select
                value={header.paymentTermId}
                onChange={(e) => setHeader((h) => ({ ...h, paymentTermId: e.target.value }))}
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
              <span>{l("Mata uang", "Currency")}</span>
              <select
                value={header.currencyCode}
                onChange={(e) => setHeader((h) => ({ ...h, currencyCode: e.target.value }))}
              >
                <option value="">{l("Mata uang perusahaan", "Company currency")}</option>
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
              {err("currencyCode")}
            </label>
            {(contracts.length > 0 || header.contractId) && (
              <label className="field">
                <span>{l("Kontrak pembelian", "Purchase contract")}</span>
                <select
                  value={header.contractId}
                  onChange={(e) => {
                    const contractId = e.target.value;
                    setHeader((h) => ({ ...h, contractId }));
                    setLines((ls) => ls.map((x) => ({ ...x, contractLineId: "", priceUnit: "" })));
                  }}
                >
                  <option value="">
                    {l("Otomatis (bila hanya satu kontrak aktif)", "Automatic (if one active contract)")}
                  </option>
                  {contracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.dateStart} – {c.dateEnd})
                      {c.valid ? "" : ` · ${l("di luar masa", "out of period")}`}
                    </option>
                  ))}
                  {header.contractId && !contracts.some((c) => c.id === header.contractId) && (
                    <option value={header.contractId}>{order?.contract?.name ?? header.contractId}</option>
                  )}
                </select>
                {err("contractId")}
              </label>
            )}
            <label className="field">
              <span>{l("Diterima di gudang", "Deliver to")}</span>
              <select
                value={header.warehouseId}
                onChange={(e) => setHeader((h) => ({ ...h, warehouseId: e.target.value }))}
              >
                <option value="">{l("Gudang utama", "Main warehouse")}</option>
                {warehouses.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.code} — {x.name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          <CustomFieldsSection
            bare
            model="purchase_order"
            value={custom}
            onChange={setCustom}
            editable={editable}
            recordId={isNew ? undefined : id}
            errors={fieldErrors}
            onSaved={setCustom}
          />

          <h2>{l("Produk", "Products")}</h2>
          <div className="table-wrap">
            <table className="lines">
              <thead>
                <tr>
                  <th>{l("Produk", "Product")}</th>
                  <th>{l("Deskripsi", "Description")}</th>
                  <th className="num">{l("Qty", "Qty")}</th>
                  {confirmed && <th className="num">{l("Diterima", "Received")}</th>}
                  {confirmed && <th className="num">{l("Ditagih", "Billed")}</th>}
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
                  const saved = order?.lines[i];
                  const shown = x.taxIds ?? p?.taxIds ?? [];
                  if (!editable)
                    return (
                      <tr key={i}>
                        <td>{products.find((pr) => pr.id === x.productId)?.sku ?? ""}</td>
                        <td>{x.name}</td>
                        <td className="num">
                          {money(x.quantity, locale, 4)} {saved?.uomName ?? ""}
                        </td>
                        {confirmed && (
                          <td className="num">{saved ? money(saved.qtyReceived, locale, 4) : ""}</td>
                        )}
                        {confirmed && (
                          <td
                            className={`num${saved && Number(saved.qtyBilled) > Number(saved.qtyReceived) && saved.productType !== "service" ? " overdue" : ""}`}
                          >
                            {saved ? money(saved.qtyBilled, locale, 4) : ""}
                          </td>
                        )}
                        <td className="num">{money(x.priceUnit, locale, 4)}</td>
                        <td className="num">{money(x.discount, locale)}</td>
                        <td>
                          <small>
                            {shown.map((tid) => taxes.find((t) => t.id === tid)?.name ?? "").join(", ")}
                          </small>
                        </td>
                        <td className="num">{money(saved?.priceSubtotal ?? "", locale)}</td>
                      </tr>
                    );
                  return (
                    <tr key={i}>
                      <td>
                        <select
                          value={x.productId}
                          onChange={(e) => {
                            const product = products.find((pr) => pr.id === e.target.value);
                            setLine(i, {
                              productId: e.target.value,
                              name: product?.name ?? x.name,
                              priceUnit: "",
                              uomId: "",
                              contractLineId: "",
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
                        <input value={x.name} onChange={(e) => setLine(i, { name: e.target.value })} />
                        {err(`lines.${i}.name`)}
                      </td>
                      <td>
                        <input
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
                            products.find((pr) => pr.id === x.productId)?.purchaseUomId ||
                            ""
                          }
                          onChange={(uomId) => setLine(i, { uomId, priceUnit: "" })}
                        />
                        {err(`lines.${i}.uomId`)}
                      </td>
                      <td>
                        <input
                          className="num"
                          inputMode="decimal"
                          placeholder={p ? money(p.priceUnit, locale, 4) : l("harga pemasok", "vendor price")}
                          value={x.priceUnit}
                          onChange={(e) => setLine(i, { priceUnit: e.target.value })}
                        />
                        {p?.contractLineId && (
                          <small className="badge">{l("harga kontrak", "contract price")}</small>
                        )}
                        {err(`lines.${i}.priceUnit`)}
                      </td>
                      <td>
                        <input
                          className="num short"
                          inputMode="decimal"
                          value={x.discount}
                          onChange={(e) => setLine(i, { discount: e.target.value })}
                        />
                      </td>
                      <td>
                        <div className="tax-picks">
                          {taxes.map((t) => (
                            <label key={t.id} title={t.name}>
                              <input
                                type="checkbox"
                                checked={shown.includes(t.id)}
                                onChange={(e) =>
                                  setLine(i, {
                                    taxIds: e.target.checked
                                      ? [...shown, t.id]
                                      : shown.filter((tid) => tid !== t.id),
                                  })
                                }
                              />{" "}
                              {t.name}
                            </label>
                          ))}
                        </div>
                        {err(`lines.${i}.taxIds`)}
                      </td>
                      <td className="num">{money(p?.priceSubtotal ?? "", locale)}</td>
                      <td>
                        <button
                          type="button"
                          aria-label="Hapus baris / Remove"
                          className="link"
                          onClick={() => setLines((r) => r.filter((_, j) => j !== i))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
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
              {taxRows.map((t) => (
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
            <span>{l("Catatan", "Notes")}</span>
            <textarea
              rows={2}
              disabled={!editable}
              value={header.note}
              onChange={(e) => setHeader((h) => ({ ...h, note: e.target.value }))}
            />
          </label>

          {order && order.pickings.length > 0 && (
            <>
              <h2>{l("Penerimaan barang", "Receipts")}</h2>
              <div className="table-scroll">
                <table>
                  <tbody>
                    {order.pickings.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/inventory/pickings/${p.id}`}>{p.name}</Link>
                          {p.pickingType === "outgoing" && (
                            <small className="muted"> · {l("retur", "return")}</small>
                          )}
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
          {order && order.bills.length > 0 && (
            <>
              <h2>{l("Tagihan", "Bills")}</h2>
              <div className="table-scroll">
                <table>
                  <tbody>
                    {order.bills.map((m) => (
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
        {order && <RelatedDocuments model="purchase_order" id={order.id} version={version} />}
      </div>
      {order && <Chatter model="purchase_order" id={order.id} version={version} labels={{}} />}
    </div>
  );
}
