"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import {
  useOptions,
  type CurrencyOption,
  type ProductOption,
  type TaxOption,
  type UomOption,
} from "../../../../../components/accounting/use-options";
import { ask, toast } from "../../../../../components/feedback";
import { useMe } from "../../../../../components/me-context";
import { CONTRACT_STATE, contractPill } from "../../../../../components/purchase/contract-state";
import { RefSelect } from "../../../../../components/ref-select";
import { api, ApiError } from "../../../../../lib/api";
import { formatDate, money, today } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can, PURCHASE_STATE_LABEL } from "../../../../../lib/resources";

interface Line {
  productId: string;
  name: string;
  quantity: string;
  uomId: string;
  priceUnit: string;
  discount: string;
  taxIds: string[];
  minOrderQty: string;
}
interface Contract {
  id: string;
  name: string;
  partnerId: string;
  partnerName: string;
  partnerRef: string | null;
  dateStart: string;
  dateEnd: string;
  currencyCode: string;
  paymentTermId: string | null;
  valueLimit: string | null;
  note: string | null;
  state: string;
  committedValue: string;
  orderedValue: string;
  qtyPct: number;
  valuePct: number;
  approval: { id: string; number: string | null; state: string } | null;
  lines: {
    id: string;
    productId: string;
    name: string;
    sku: string | null;
    quantity: string;
    uomId: string | null;
    uomName: string | null;
    priceUnit: string;
    discount: string;
    taxIds: string[];
    minOrderQty: string | null;
    ordered: string;
    remaining: string;
    pct: number;
  }[];
  orders: {
    id: string;
    name: string;
    state: string;
    dateOrder: string;
    amountUntaxed: string;
    contractWarning: string | null;
  }[];
}

const emptyLine = (): Line => ({
  productId: "",
  name: "",
  quantity: "",
  uomId: "",
  priceUnit: "",
  discount: "0",
  taxIds: [],
  minOrderQty: "",
});
const plusYear = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCFullYear(x.getUTCFullYear() + 1);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};
const n = (v: string | null | undefined) => (v == null ? "" : String(Number(v)));

function ContractForm() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const products = useOptions<ProductOption>("/products").filter((p) => !p.isVariantTemplate);
  const uoms = useOptions<UomOption>("/uoms");
  const taxes = useOptions<TaxOption>("/taxes").filter((t) => t.typeTaxUse === "purchase");
  const terms = useOptions<{ id: string; name: string }>("/payment-terms");
  const currencies = useOptions<CurrencyOption>("/currencies");
  const [doc, setDoc] = useState<Contract | null>(null);
  const [form, setForm] = useState({
    partnerId: "",
    partnerRef: "",
    dateStart: today(),
    dateEnd: plusYear(today()),
    currencyCode: "",
    paymentTermId: "",
    valueLimit: "",
    note: "",
    lines: [emptyLine()],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [orderQty, setOrderQty] = useState<Record<string, string> | null>(null);
  const write = can(me.permissions, "purchase.write");
  const editable = write && (isNew || doc?.state === "draft");

  const apply = (c: Contract) => {
    setDoc(c);
    setForm({
      partnerId: c.partnerId,
      partnerRef: c.partnerRef ?? "",
      dateStart: c.dateStart,
      dateEnd: c.dateEnd,
      currencyCode: c.currencyCode,
      paymentTermId: c.paymentTermId ?? "",
      valueLimit: n(c.valueLimit),
      note: c.note ?? "",
      lines: c.lines.map((x) => ({
        productId: x.productId,
        name: x.name,
        quantity: n(x.quantity),
        uomId: x.uomId ?? "",
        priceUnit: n(x.priceUnit),
        discount: n(x.discount),
        taxIds: x.taxIds,
        minOrderQty: n(x.minOrderQty),
      })),
    });
  };
  const load = useCallback(() => {
    if (isNew) return;
    api<Contract>(`/purchase-contracts/${id}`)
      .then(apply)
      .catch((e: Error) => toast.error(e.message));
  }, [id, isNew]);
  useEffect(load, [load]);

  const body = () => ({
    partnerId: form.partnerId,
    partnerRef: form.partnerRef || null,
    dateStart: form.dateStart,
    dateEnd: form.dateEnd,
    currencyCode: form.currencyCode || undefined,
    paymentTermId: form.paymentTermId || (isNew ? undefined : null),
    valueLimit: form.valueLimit || null,
    note: form.note || null,
    lines: form.lines
      .filter((x) => x.productId)
      .map((x) => ({
        productId: x.productId,
        name: x.name || undefined,
        quantity: x.quantity || "0",
        uomId: x.uomId || null,
        priceUnit: x.priceUnit || "0",
        discount: x.discount || "0",
        taxIds: x.taxIds,
        minOrderQty: x.minOrderQty || null,
      })),
  });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErrors({});
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      if (isNew) {
        const created = await api<Contract>("/purchase-contracts", { method: "POST", body: body() });
        router.replace(`/purchase/contracts/${created.id}`);
      } else {
        apply(await api<Contract>(`/purchase-contracts/${id}`, { method: "PUT", body: body() }));
        toast.success(l("Disimpan", "Saved"));
      }
    });
  const action = (path: string, message: string, done: string, danger = false) =>
    run(async () => {
      if (!(await ask({ message, danger }))) return;
      if (editable) await api(`/purchase-contracts/${id}`, { method: "PUT", body: body() });
      apply(await api<Contract>(`/purchase-contracts/${id}/${path}`, { method: "POST" }));
      toast.success(done);
    });
  const remove = () =>
    run(async () => {
      if (!(await ask({ message: l("Hapus kontrak ini?", "Delete this contract?"), danger: true }))) return;
      await api(`/purchase-contracts/${id}`, { method: "DELETE" });
      router.replace("/purchase/contracts");
    });
  const createOrder = () =>
    run(async () => {
      const lines = Object.entries(orderQty ?? {})
        .filter(([, q]) => Number(q) > 0)
        .map(([contractLineId, quantity]) => ({ contractLineId, quantity }));
      const res = await api<{ id: string }>(`/purchase-contracts/${id}/purchase-order`, {
        method: "POST",
        body: { lines },
      });
      router.push(`/purchase/orders/${res.id}`);
    });

  const setLine = (i: number, patch: Partial<Line>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const err = (k: string) => errors[k] && <small className="error">{errors[k]}</small>;
  const m = (v: string) => money(v, locale);
  const committed = form.lines.reduce(
    (s, x) =>
      s + (Number(x.quantity) || 0) * (Number(x.priceUnit) || 0) * (1 - (Number(x.discount) || 0) / 100),
    0,
  );

  return (
    <div className="stack-wide">
      <header className="toolbar">
        <h1>
          <Link href="/purchase/contracts">{l("Kontrak Pembelian", "Purchase Contracts")}</Link> /{" "}
          {isNew ? l("Baru", "New") : doc?.name}
        </h1>
        {doc && (
          <span className={`pill ${contractPill(doc.state)}`}>
            {l(...(CONTRACT_STATE[doc.state] ?? [doc.state, doc.state]))}
          </span>
        )}
        {editable && (
          <button className="primary" disabled={busy} aria-busy={busy} onClick={save}>
            {l("Simpan", "Save")}
          </button>
        )}
        {write && doc?.state === "draft" && (
          <button
            disabled={busy}
            onClick={() =>
              action(
                "submit",
                l("Ajukan kontrak ini untuk persetujuan?", "Submit this contract for approval?"),
                l("Diajukan", "Submitted"),
              )
            }
          >
            {l("Ajukan persetujuan", "Submit for approval")}
          </button>
        )}
        {write && doc?.state === "active" && (
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              setOrderQty(
                Object.fromEntries(doc.lines.map((x) => [x.id, String(Math.max(Number(x.remaining), 0))])),
              )
            }
          >
            {l("Buat PO", "Create PO")}
          </button>
        )}
        {write && (doc?.state === "active" || doc?.state === "expired") && (
          <button
            disabled={busy}
            onClick={() =>
              action(
                "close",
                l(
                  "Tutup kontrak? PO baru tidak bisa memakai kontrak ini lagi.",
                  "Close the contract? New POs can no longer use it.",
                ),
                l("Kontrak ditutup", "Contract closed"),
              )
            }
          >
            {l("Tutup kontrak", "Close contract")}
          </button>
        )}
        {write && (doc?.state === "draft" || doc?.state === "in_approval") && (
          <button
            disabled={busy}
            onClick={() =>
              action(
                "cancel",
                l("Batalkan kontrak ini?", "Cancel this contract?"),
                l("Dibatalkan", "Cancelled"),
                true,
              )
            }
          >
            {l("Batalkan", "Cancel")}
          </button>
        )}
        {write && (doc?.state === "cancel" || doc?.state === "refused") && (
          <>
            <button
              disabled={busy}
              onClick={() =>
                action(
                  "draft",
                  l("Kembalikan ke draft?", "Reset to draft?"),
                  l("Kembali ke draft", "Reset to draft"),
                )
              }
            >
              {l("Jadikan draft", "Reset to draft")}
            </button>
            <button className="danger" disabled={busy} onClick={remove}>
              {l("Hapus", "Delete")}
            </button>
          </>
        )}
      </header>

      {doc?.approval && (
        <p className="muted">
          {l("Permintaan persetujuan", "Approval request")}:{" "}
          <Link href={`/hr/approval-requests/${doc.approval.id}`}>{doc.approval.number ?? "—"}</Link>
          {doc.state === "in_approval" && ` — ${l("menunggu keputusan", "awaiting decision")}`}
        </p>
      )}
      {doc && doc.state !== "draft" && (
        <div className="cards">
          <div className="card">
            <small className="muted">{l("Nilai komitmen", "Committed value")}</small>
            <strong>{m(doc.valueLimit ?? doc.committedValue)}</strong>
            <small className="muted">
              {doc.valueLimit ? l("plafon", "value cap") : l("kuantitas × harga", "quantity × price")}
            </small>
          </div>
          <div className="card">
            <small className="muted">{l("Sudah dipesan", "Ordered")}</small>
            <strong>{m(doc.orderedValue)}</strong>
            <small className="muted">{doc.valuePct}%</small>
          </div>
          <div className="card">
            <small className="muted">{l("Realisasi kuantitas", "Quantity used")}</small>
            <strong>{doc.qtyPct}%</strong>
          </div>
        </div>
      )}

      {orderQty && doc && (
        <div
          className="panel"
          role="dialog"
          aria-label={l("Buat PO dari kontrak", "Create PO from contract")}
        >
          <h2>{l("Buat PO dari kontrak", "Create PO from contract")}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Produk", "Product")}</th>
                  <th className="num">{l("Sisa", "Remaining")}</th>
                  <th className="num">{l("Pesan", "Order")}</th>
                </tr>
              </thead>
              <tbody>
                {doc.lines.map((x) => (
                  <tr key={x.id}>
                    <td>{x.name}</td>
                    <td className="num">
                      {money(x.remaining, locale, 4)} {x.uomName ?? ""}
                    </td>
                    <td className="num">
                      <input
                        className="num short"
                        inputMode="decimal"
                        aria-label={x.name}
                        value={orderQty[x.id] ?? ""}
                        onChange={(e) => setOrderQty({ ...orderQty, [x.id]: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {err("lines")}
          <div className="toolbar">
            <button className="primary" disabled={busy} aria-busy={busy} onClick={createOrder}>
              {l("Buat RFQ", "Create RFQ")}
            </button>
            <button disabled={busy} onClick={() => setOrderQty(null)}>
              {l("Batal", "Cancel")}
            </button>
          </div>
        </div>
      )}

      <div className="panel">
        <fieldset className="fields" disabled={!editable}>
          <label className="field">
            <span>{l("Pemasok *", "Vendor *")}</span>
            <RefSelect
              name="partnerId"
              resource="partners"
              display="name"
              required
              value={form.partnerId}
              onChange={(v) => setForm((f) => ({ ...f, partnerId: v }))}
            />
            {err("partnerId")}
          </label>
          <label className="field">
            <span>{l("Ref. pemasok", "Vendor reference")}</span>
            <input
              value={form.partnerRef}
              onChange={(e) => setForm({ ...form, partnerRef: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Berlaku mulai *", "Valid from *")}</span>
            <input
              type="date"
              required
              value={form.dateStart}
              onChange={(e) => setForm({ ...form, dateStart: e.target.value })}
            />
            {err("dateStart")}
          </label>
          <label className="field">
            <span>{l("Berlaku sampai *", "Valid until *")}</span>
            <input
              type="date"
              required
              value={form.dateEnd}
              onChange={(e) => setForm({ ...form, dateEnd: e.target.value })}
            />
            {err("dateEnd")}
          </label>
          <label className="field">
            <span>{l("Mata uang", "Currency")}</span>
            <select
              value={form.currencyCode}
              onChange={(e) => setForm({ ...form, currencyCode: e.target.value })}
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
          <label className="field">
            <span>{l("Termin pembayaran", "Payment terms")}</span>
            <select
              value={form.paymentTermId}
              onChange={(e) => setForm({ ...form, paymentTermId: e.target.value })}
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
            <span>{l("Plafon nilai (sebelum pajak)", "Value cap (before tax)")}</span>
            <input
              inputMode="decimal"
              placeholder={l("tanpa plafon", "no cap")}
              value={form.valueLimit}
              onChange={(e) => setForm({ ...form, valueLimit: e.target.value })}
            />
            {err("valueLimit")}
          </label>
          <label className="field">
            <span>{l("Catatan", "Note")}</span>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
        </fieldset>

        <h2>{l("Produk & harga kontrak", "Products & contract prices")}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Produk", "Product")}</th>
                <th>{l("Deskripsi", "Description")}</th>
                <th className="num">{l("Komitmen", "Committed")}</th>
                <th className="num">{l("Harga", "Price")}</th>
                <th className="num">{l("Diskon %", "Disc. %")}</th>
                <th>{l("Pajak", "Taxes")}</th>
                <th className="num">{l("Min. pesan", "Min. order")}</th>
                {!isNew && doc?.state !== "draft" && <th className="num">{l("Dipesan", "Ordered")}</th>}
                {!isNew && doc?.state !== "draft" && <th className="num">{l("Sisa", "Remaining")}</th>}
                {editable && <th />}
              </tr>
            </thead>
            <tbody>
              {form.lines.map((x, i) => {
                const saved = doc?.lines[i];
                const product = products.find((p) => p.id === x.productId);
                return (
                  <tr key={i}>
                    <td>
                      {editable ? (
                        <select
                          aria-label={l("Produk", "Product")}
                          value={x.productId}
                          onChange={(e) => {
                            const p = products.find((pr) => pr.id === e.target.value);
                            setLine(i, { productId: e.target.value, name: p?.name ?? x.name, uomId: "" });
                          }}
                        >
                          <option value="">—</option>
                          {products.map((pr) => (
                            <option key={pr.id} value={pr.id}>
                              {pr.sku} {pr.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        (saved?.sku ?? product?.sku ?? "")
                      )}
                      {err(`lines.${i}.productId`)}
                    </td>
                    <td>
                      {editable ? (
                        <input
                          aria-label={l("Deskripsi", "Description")}
                          value={x.name}
                          onChange={(e) => setLine(i, { name: e.target.value })}
                        />
                      ) : (
                        x.name
                      )}
                    </td>
                    <td className="num">
                      {editable ? (
                        <>
                          <input
                            className="num short"
                            inputMode="decimal"
                            aria-label={l("Komitmen", "Committed")}
                            value={x.quantity}
                            onChange={(e) => setLine(i, { quantity: e.target.value })}
                          />
                          <select
                            aria-label={l("Satuan", "Unit")}
                            value={x.uomId}
                            onChange={(e) => setLine(i, { uomId: e.target.value })}
                          >
                            <option value="">{l("satuan beli", "purchase unit")}</option>
                            {uoms
                              .filter((u) => {
                                const base = uoms.find((b) => b.id === product?.uomId);
                                return !base || u.categoryId === base.categoryId;
                              })
                              .map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))}
                          </select>
                        </>
                      ) : (
                        `${money(x.quantity, locale, 4)} ${saved?.uomName ?? ""}`
                      )}
                      {err(`lines.${i}.quantity`)}
                      {err(`lines.${i}.uomId`)}
                    </td>
                    <td className="num">
                      {editable ? (
                        <input
                          className="num"
                          inputMode="decimal"
                          aria-label={l("Harga", "Price")}
                          value={x.priceUnit}
                          onChange={(e) => setLine(i, { priceUnit: e.target.value })}
                        />
                      ) : (
                        money(x.priceUnit, locale, 4)
                      )}
                      {err(`lines.${i}.priceUnit`)}
                    </td>
                    <td className="num">
                      {editable ? (
                        <input
                          className="num short"
                          inputMode="decimal"
                          aria-label={l("Diskon %", "Disc. %")}
                          value={x.discount}
                          onChange={(e) => setLine(i, { discount: e.target.value })}
                        />
                      ) : (
                        money(x.discount, locale)
                      )}
                    </td>
                    <td>
                      {editable ? (
                        <select
                          multiple
                          size={2}
                          aria-label={l("Pajak", "Taxes")}
                          value={x.taxIds}
                          onChange={(e) =>
                            setLine(i, { taxIds: [...e.target.selectedOptions].map((o) => o.value) })
                          }
                        >
                          {taxes.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <small>
                          {x.taxIds.map((t) => taxes.find((y) => y.id === t)?.name ?? "").join(", ")}
                        </small>
                      )}
                      {err(`lines.${i}.taxIds`)}
                    </td>
                    <td className="num">
                      {editable ? (
                        <input
                          className="num short"
                          inputMode="decimal"
                          aria-label={l("Min. pesan", "Min. order")}
                          value={x.minOrderQty}
                          onChange={(e) => setLine(i, { minOrderQty: e.target.value })}
                        />
                      ) : x.minOrderQty ? (
                        money(x.minOrderQty, locale, 4)
                      ) : (
                        "—"
                      )}
                    </td>
                    {!isNew && doc?.state !== "draft" && (
                      <td className="num">
                        {saved ? `${money(saved.ordered, locale, 4)} (${saved.pct}%)` : ""}
                      </td>
                    )}
                    {!isNew && doc?.state !== "draft" && (
                      <td className={`num${saved && Number(saved.remaining) < 0 ? " overdue" : ""}`}>
                        {saved ? money(saved.remaining, locale, 4) : ""}
                      </td>
                    )}
                    {editable && (
                      <td>
                        <button
                          type="button"
                          className="link"
                          aria-label={l("Hapus baris", "Remove line")}
                          onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))}
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {err("lines")}
        {editable && (
          <button
            type="button"
            className="link"
            onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }))}
          >
            + {l("Tambah produk", "Add product")}
          </button>
        )}
        <p className="muted">
          {l(
            "Nilai komitmen (kuantitas × harga, sebelum pajak)",
            "Committed value (quantity × price, before tax)",
          )}
          : <strong>{m(String(committed.toFixed(2)))}</strong>
          {form.valueLimit && ` · ${l("plafon", "cap")} ${m(form.valueLimit)}`}
        </p>
      </div>

      {doc && doc.orders.length > 0 && (
        <div className="panel">
          <h2>{l("Pesanan pembelian terkait", "Related purchase orders")}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Nomor", "Number")}</th>
                  <th>{l("Tanggal", "Date")}</th>
                  <th className="num">{l("Nilai (sebelum pajak)", "Amount (untaxed)")}</th>
                  <th>{l("Status", "Status")}</th>
                  <th>{l("Catatan kontrak", "Contract note")}</th>
                </tr>
              </thead>
              <tbody>
                {doc.orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/purchase/orders/${o.id}`}>{o.name}</Link>
                    </td>
                    <td>{formatDate(o.dateOrder, locale)}</td>
                    <td className="num">{m(o.amountUntaxed)}</td>
                    <td>{PURCHASE_STATE_LABEL[o.state] ? tx(PURCHASE_STATE_LABEL[o.state]!) : o.state}</td>
                    <td>
                      <small>{o.contractWarning ?? ""}</small>
                    </td>
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

export default function PurchaseContractPage() {
  return (
    <Suspense>
      <ContractForm />
    </Suspense>
  );
}
