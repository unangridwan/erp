"use client";

import { computeInvoice } from "@erp/shared";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { money, today } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { can, MOVE_TYPE_LABEL } from "../../lib/resources";
import { Chatter } from "../chatter";
import { useMe } from "../me-context";
import { RefSelect } from "../ref-select";
import { PaymentBadge, StateBadge } from "./badges";
import {
  useOptions,
  type AccountOption,
  type CurrencyOption,
  type JournalOption,
  type ProductOption,
  type TaxOption,
} from "./use-options";

interface MoveLine {
  id: string;
  displayType: string;
  accountId: string;
  partnerId: string | null;
  name: string | null;
  debit: string;
  credit: string;
  productId: string | null;
  quantity: string | null;
  priceUnit: string | null;
  discount: string;
  taxIds: string[];
  branchId: string | null;
  businessUnitId: string | null;
}
interface Move {
  id: string;
  name: string | null;
  moveType: string;
  state: string;
  journalId: string;
  date: string;
  dueDate: string | null;
  partnerId: string | null;
  ref: string | null;
  narration: string | null;
  currencyCode: string;
  amountUntaxed: string;
  amountTax: string;
  amountTotal: string;
  amountResidual: string;
  paymentState: string;
  reversedEntryId: string | null;
  lines: MoveLine[];
}

interface InvoiceLine {
  productId: string;
  name: string;
  accountId: string;
  quantity: string;
  priceUnit: string;
  discount: string;
  taxIds: string[];
  branchId: string;
}
interface EntryLine {
  accountId: string;
  name: string;
  partnerId: string;
  debit: string;
  credit: string;
  branchId: string;
}

const emptyInvoiceLine = (): InvoiceLine => ({
  productId: "",
  name: "",
  accountId: "",
  quantity: "1",
  priceUnit: "0",
  discount: "0",
  taxIds: [],
  branchId: "",
});
const emptyEntryLine = (): EntryLine => ({
  accountId: "",
  name: "",
  partnerId: "",
  debit: "",
  credit: "",
  branchId: "",
});
const orNull = (v: string) => (v === "" ? null : v);

export function MoveForm({ id, newType }: { id: string; newType: string }) {
  const me = useMe();
  const router = useRouter();
  const { l, tx, locale } = useI18n();
  const isNew = id === "new";
  const [move, setMove] = useState<Move | null>(null);
  const moveType = move?.moveType ?? newType;
  const isEntry = moveType === "entry";
  const sale = moveType.startsWith("out_");

  const accounts = useOptions<AccountOption>("/accounts");
  const taxes = useOptions<TaxOption>("/taxes");
  const journals = useOptions<JournalOption>("/journals");
  const products = useOptions<ProductOption>(isEntry ? null : "/products");
  const currencies = useOptions<CurrencyOption>("/currencies");
  const branches = useOptions<{ id: string; name: string; companyId: string }>("/branches");

  const [header, setHeader] = useState({
    partnerId: "",
    date: today(),
    dueDate: "",
    currencyCode: "",
    ref: "",
    narration: "",
  });
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>([emptyInvoiceLine()]);
  const [entryLines, setEntryLines] = useState<EntryLine[]>([emptyEntryLine(), emptyEntryLine()]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (isNew) return;
    api<Move>(`/moves/${id}`)
      .then((m) => {
        setMove(m);
        setHeader({
          partnerId: m.partnerId ?? "",
          date: m.date,
          dueDate: m.dueDate ?? "",
          currencyCode: m.currencyCode,
          ref: m.ref ?? "",
          narration: m.narration ?? "",
        });
        if (m.moveType === "entry") {
          setEntryLines(
            m.lines.map((x) => ({
              accountId: x.accountId,
              name: x.name ?? "",
              partnerId: x.partnerId ?? "",
              debit: Number(x.debit) ? x.debit : "",
              credit: Number(x.credit) ? x.credit : "",
              branchId: x.branchId ?? "",
            })),
          );
        } else {
          setInvoiceLines(
            m.lines
              .filter((x) => x.displayType === "product")
              .map((x) => ({
                productId: x.productId ?? "",
                name: x.name ?? "",
                accountId: x.accountId,
                // Buang nol desimal berlebih dari kolom numeric (2.0000 → 2).
                quantity: String(Number(x.quantity ?? 1)),
                priceUnit: String(Number(x.priceUnit ?? 0)),
                discount: String(Number(x.discount)),
                taxIds: x.taxIds,
                branchId: x.branchId ?? "",
              })),
          );
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [id, isNew, version]);

  const editable = (isNew || move?.state === "draft") && can(me.permissions, "accounting.write");
  const usableTaxes = taxes.filter((t) => t.typeTaxUse === (sale ? "sale" : "purchase"));
  const decimals = currencies.find((c) => c.code === (header.currencyCode || "IDR"))?.decimals ?? 2;
  const accountLabel = (accountId: string) => {
    const a = accounts.find((x) => x.id === accountId);
    return a ? `${a.code} ${a.name}` : "";
  };

  const preview = useMemo(() => {
    if (isEntry) return null;
    try {
      return computeInvoice(
        invoiceLines.map((x) => ({
          quantity: x.quantity || 0,
          priceUnit: x.priceUnit || 0,
          discount: x.discount || 0,
          taxIds: x.taxIds,
        })),
        usableTaxes.map((t) => ({ id: t.id, amount: t.amount, baseRatio: t.baseRatio })),
        decimals,
      );
    } catch {
      return null;
    }
  }, [isEntry, invoiceLines, usableTaxes, decimals]);

  const entryTotals = useMemo(() => {
    const d = entryLines.reduce((s, x) => s + Number(x.debit || 0), 0);
    const c = entryLines.reduce((s, x) => s + Number(x.credit || 0), 0);
    return { debit: d, credit: c, diff: Math.round((d - c) * 100) / 100 };
  }, [entryLines]);

  function payload() {
    if (isEntry) {
      return {
        date: header.date,
        ref: orNull(header.ref),
        narration: orNull(header.narration),
        lines: entryLines
          .filter((x) => x.accountId)
          .map((x) => ({
            accountId: x.accountId,
            name: orNull(x.name),
            partnerId: orNull(x.partnerId),
            debit: x.debit || "0",
            credit: x.credit || "0",
            branchId: orNull(x.branchId),
          })),
      };
    }
    return {
      moveType,
      partnerId: header.partnerId,
      date: header.date,
      dueDate: orNull(header.dueDate),
      currencyCode: header.currencyCode || undefined,
      ref: orNull(header.ref),
      narration: orNull(header.narration),
      lines: invoiceLines.map((x) => ({
        productId: orNull(x.productId),
        accountId: orNull(x.accountId),
        name: x.name,
        quantity: x.quantity,
        priceUnit: x.priceUnit,
        discount: x.discount || "0",
        taxIds: x.taxIds,
        branchId: orNull(x.branchId),
      })),
    };
  }

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      const saved = isNew
        ? await api<Move>("/moves", { method: "POST", body: payload() })
        : await api<Move>(`/moves/${id}`, { method: "PATCH", body: payload() });
      if (isNew) router.replace(`/accounting/moves/${saved.id}`);
      else setVersion((v) => v + 1);
      return saved;
    });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await save();
  }

  const postMove = () =>
    run(async () => {
      await api(`/moves/${id}`, { method: "PATCH", body: payload() });
      await api(`/moves/${id}/post`, { method: "POST" });
      setVersion((v) => v + 1);
    });

  const remove = () =>
    run(async () => {
      if (!confirm(l("Hapus draft ini?", "Delete this draft?"))) return;
      await api(`/moves/${id}`, { method: "DELETE" });
      router.replace(isEntry ? "/accounting/entries" : sale ? "/accounting/invoices" : "/accounting/bills");
    });

  const reverse = () =>
    run(async () => {
      if (!confirm(l("Buat jurnal balik untuk dokumen ini?", "Create a reversal for this document?"))) return;
      const reversal = await api<Move>(`/moves/${id}/reverse`, { method: "POST", body: {} });
      router.push(`/accounting/moves/${reversal.id}`);
    });

  if (!isNew && !move) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;

  const title =
    move?.name ?? `${tx(MOVE_TYPE_LABEL[moveType] ?? MOVE_TYPE_LABEL.entry!)} ${l("baru", "new")}`;
  const err = (path: string) => fieldErrors[path] && <small className="error">{fieldErrors[path]}</small>;
  const setInv = (i: number, patch: Partial<InvoiceLine>) =>
    setInvoiceLines((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setEnt = (i: number, patch: Partial<EntryLine>) =>
    setEntryLines((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="form-layout">
      <div className="stack-wide">
        <form className="panel" onSubmit={onSubmit}>
          <header className="toolbar">
            <h1>{title}</h1>
            {move && <StateBadge state={move.state} />}
            {move?.state === "posted" && !isEntry && <PaymentBadge state={move.paymentState} />}
            {editable && (
              <button className="primary" disabled={busy}>
                {l("Simpan draft", "Save draft")}
              </button>
            )}
            {editable && !isNew && can(me.permissions, "accounting.post") && (
              <button type="button" className="primary" disabled={busy} onClick={postMove}>
                {l("Posting", "Post")}
              </button>
            )}
            {editable && !isNew && (
              <button type="button" className="danger" disabled={busy} onClick={remove}>
                {l("Hapus", "Delete")}
              </button>
            )}
            {move?.state === "posted" &&
              can(me.permissions, "accounting.post") &&
              move.paymentState !== "reversed" && (
                <button type="button" disabled={busy} onClick={reverse}>
                  {l("Balik", "Reverse")}
                </button>
              )}
          </header>
          {error && <p className="error">{error}</p>}

          <fieldset disabled={!editable} className="fields">
            {!isEntry && (
              <label className="field">
                <span>{sale ? l("Pelanggan *", "Customer *") : l("Pemasok *", "Vendor *")}</span>
                <RefSelect
                  name="partnerId"
                  resource="partners"
                  display="name"
                  value={header.partnerId}
                  required
                  onChange={(v) => setHeader((h) => ({ ...h, partnerId: v }))}
                />
                {err("partnerId")}
              </label>
            )}
            <label className="field">
              <span>{l("Tanggal *", "Date *")}</span>
              <input
                type="date"
                required
                value={header.date}
                onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))}
              />
              {err("date")}
            </label>
            {!isEntry && (
              <>
                <label className="field">
                  <span>{l("Jatuh tempo", "Due date")}</span>
                  <input
                    type="date"
                    value={header.dueDate}
                    onChange={(e) => setHeader((h) => ({ ...h, dueDate: e.target.value }))}
                  />
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
              </>
            )}
            <label className="field">
              <span>{l("Referensi", "Reference")}</span>
              <input value={header.ref} onChange={(e) => setHeader((h) => ({ ...h, ref: e.target.value }))} />
            </label>
          </fieldset>

          <h2>{isEntry ? l("Baris jurnal", "Journal items") : l("Baris", "Lines")}</h2>
          <div className="table-wrap">
            {isEntry ? (
              <div className="table-scroll">
                <table className="lines">
                  <thead>
                    <tr>
                      <th>{l("Akun", "Account")}</th>
                      <th>{l("Keterangan", "Label")}</th>
                      <th>{l("Partner", "Partner")}</th>
                      <th>{l("Cabang", "Branch")}</th>
                      <th className="num">{l("Debit", "Debit")}</th>
                      <th className="num">{l("Kredit", "Credit")}</th>
                      {editable && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {entryLines.map((x, i) => (
                      <tr key={i}>
                        <td>
                          <select
                            disabled={!editable}
                            value={x.accountId}
                            onChange={(e) => setEnt(i, { accountId: e.target.value })}
                          >
                            <option value="">—</option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} {a.name}
                              </option>
                            ))}
                          </select>
                          {err(`lines.${i}.accountId`)}
                          {err(`lines.${i}`)}
                        </td>
                        <td>
                          <input
                            disabled={!editable}
                            value={x.name}
                            onChange={(e) => setEnt(i, { name: e.target.value })}
                          />
                        </td>
                        <td>
                          <RefSelect
                            name="partnerId"
                            resource="partners"
                            display="name"
                            value={x.partnerId}
                            disabled={!editable}
                            onChange={(v) => setEnt(i, { partnerId: v })}
                          />
                        </td>
                        <td>
                          <select
                            disabled={!editable}
                            value={x.branchId}
                            onChange={(e) => setEnt(i, { branchId: e.target.value })}
                          >
                            <option value="">—</option>
                            {branches.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            disabled={!editable}
                            className="num"
                            inputMode="decimal"
                            value={x.debit}
                            onChange={(e) =>
                              setEnt(i, { debit: e.target.value, credit: e.target.value ? "" : x.credit })
                            }
                          />
                        </td>
                        <td>
                          <input
                            disabled={!editable}
                            className="num"
                            inputMode="decimal"
                            value={x.credit}
                            onChange={(e) =>
                              setEnt(i, { credit: e.target.value, debit: e.target.value ? "" : x.debit })
                            }
                          />
                        </td>
                        {editable && (
                          <td>
                            <button
                              type="button"
                              className="link"
                              onClick={() => setEntryLines((r) => r.filter((_, j) => j !== i))}
                              aria-label={l("Hapus baris", "Remove line")}
                            >
                              ✕
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}>
                        {editable && (
                          <button
                            type="button"
                            className="link"
                            onClick={() => setEntryLines((r) => [...r, emptyEntryLine()])}
                          >
                            + {l("Tambah baris", "Add line")}
                          </button>
                        )}
                        {entryTotals.diff !== 0 && (
                          <span className="error">
                            {" "}
                            {l("Selisih", "Difference")}: {money(entryTotals.diff, locale)}
                          </span>
                        )}
                      </td>
                      <td className="num">{money(entryTotals.debit, locale)}</td>
                      <td className="num">{money(entryTotals.credit, locale)}</td>
                      {editable && <td />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="lines">
                  <thead>
                    <tr>
                      <th>{l("Produk", "Product")}</th>
                      <th>{l("Deskripsi *", "Description *")}</th>
                      <th>{l("Akun", "Account")}</th>
                      <th className="num">{l("Qty", "Qty")}</th>
                      <th className="num">{l("Harga", "Price")}</th>
                      <th className="num">{l("Disk %", "Disc %")}</th>
                      <th>{l("Pajak", "Taxes")}</th>
                      <th className="num">{l("Subtotal", "Subtotal")}</th>
                      {editable && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceLines.map((x, i) => (
                      <tr key={i}>
                        <td>
                          <select
                            disabled={!editable}
                            value={x.productId}
                            onChange={(e) => {
                              const p = products.find((pr) => pr.id === e.target.value);
                              setInv(i, {
                                productId: e.target.value,
                                ...(p
                                  ? { name: x.name || p.name, priceUnit: sale ? p.salePrice : p.cost }
                                  : {}),
                              });
                            }}
                          >
                            <option value="">—</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.sku} {p.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            disabled={!editable}
                            required
                            value={x.name}
                            onChange={(e) => setInv(i, { name: e.target.value })}
                          />
                          {err(`lines.${i}.name`)}
                        </td>
                        <td>
                          <select
                            disabled={!editable}
                            value={x.accountId}
                            onChange={(e) => setInv(i, { accountId: e.target.value })}
                          >
                            <option value="">{l("Bawaan jurnal", "Journal default")}</option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} {a.name}
                              </option>
                            ))}
                          </select>
                          {err(`lines.${i}.accountId`)}
                        </td>
                        <td>
                          <input
                            disabled={!editable}
                            className="num short"
                            inputMode="decimal"
                            value={x.quantity}
                            onChange={(e) => setInv(i, { quantity: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            disabled={!editable}
                            className="num"
                            inputMode="decimal"
                            value={x.priceUnit}
                            onChange={(e) => setInv(i, { priceUnit: e.target.value })}
                          />
                          {err(`lines.${i}.priceUnit`)}
                        </td>
                        <td>
                          <input
                            disabled={!editable}
                            className="num short"
                            inputMode="decimal"
                            value={x.discount}
                            onChange={(e) => setInv(i, { discount: e.target.value })}
                          />
                        </td>
                        <td>
                          <div className="tax-picks">
                            {usableTaxes.map((t) => (
                              <label key={t.id} title={t.name}>
                                <input
                                  type="checkbox"
                                  disabled={!editable}
                                  checked={x.taxIds.includes(t.id)}
                                  onChange={(e) =>
                                    setInv(i, {
                                      taxIds: e.target.checked
                                        ? [...x.taxIds, t.id]
                                        : x.taxIds.filter((tid) => tid !== t.id),
                                    })
                                  }
                                />{" "}
                                {t.name}
                              </label>
                            ))}
                          </div>
                          {err(`lines.${i}.taxIds`)}
                        </td>
                        <td className="num">
                          {preview ? money(preview.lines[i]?.subtotal, locale, decimals) : ""}
                        </td>
                        {editable && (
                          <td>
                            <button
                              type="button"
                              className="link"
                              disabled={invoiceLines.length === 1}
                              onClick={() => setInvoiceLines((r) => r.filter((_, j) => j !== i))}
                              aria-label={l("Hapus baris", "Remove line")}
                            >
                              ✕
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {!isEntry && editable && (
            <button
              type="button"
              className="link"
              onClick={() => setInvoiceLines((r) => [...r, emptyInvoiceLine()])}
            >
              + {l("Tambah baris", "Add line")}
            </button>
          )}

          {!isEntry && preview && (
            <dl className="totals">
              <dt>{l("Subtotal", "Untaxed amount")}</dt>
              <dd>{money(preview.amountUntaxed, locale, decimals)}</dd>
              {preview.taxes.map((t) => (
                <div key={t.taxId} className="contents">
                  <dt>
                    {usableTaxes.find((x) => x.id === t.taxId)?.name}
                    <small className="muted"> · DPP {money(t.taxBase, locale, decimals)}</small>
                  </dt>
                  <dd>{money(t.amount, locale, decimals)}</dd>
                </div>
              ))}
              <dt>
                <strong>{l("Total", "Total")}</strong>
              </dt>
              <dd>
                <strong>
                  {header.currencyCode || ""} {money(preview.amountTotal, locale, decimals)}
                </strong>
              </dd>
              {move?.state === "posted" && (
                <>
                  <dt>{l("Sisa tagihan (mata uang perusahaan)", "Amount due (company currency)")}</dt>
                  <dd>{money(move.amountResidual, locale)}</dd>
                </>
              )}
            </dl>
          )}
        </form>

        {move?.state === "posted" &&
          !isEntry &&
          Number(move.amountResidual) > 0 &&
          can(me.permissions, "accounting.post") && (
            <PaymentPanel move={move} journals={journals} onDone={() => setVersion((v) => v + 1)} />
          )}

        {move && move.lines.length > 0 && (
          <section className="panel">
            <h2>{l("Jurnal akuntansi", "Journal items")}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{l("Akun", "Account")}</th>
                    <th>{l("Keterangan", "Label")}</th>
                    <th className="num">{l("Debit", "Debit")}</th>
                    <th className="num">{l("Kredit", "Credit")}</th>
                  </tr>
                </thead>
                <tbody>
                  {move.lines.map((x) => (
                    <tr key={x.id}>
                      <td>{accountLabel(x.accountId)}</td>
                      <td>{x.name}</td>
                      <td className="num">{Number(x.debit) ? money(x.debit, locale) : ""}</td>
                      <td className="num">{Number(x.credit) ? money(x.credit, locale) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
      {move && <Chatter model="account_move" id={move.id} version={version} labels={{}} />}
    </div>
  );
}

function PaymentPanel({
  move,
  journals,
  onDone,
}: {
  move: Move;
  journals: JournalOption[];
  onDone: () => void;
}) {
  const { l } = useI18n();
  const cashJournals = journals.filter((j) => j.journalType === "bank" || j.journalType === "cash");
  const [journalId, setJournalId] = useState("");
  const [amount, setAmount] = useState(move.amountResidual);
  const [date, setDate] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inbound = move.moveType === "out_invoice" || move.moveType === "in_refund";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/payments", {
        method: "POST",
        body: {
          paymentType: inbound ? "inbound" : "outbound",
          partnerId: move.partnerId,
          journalId: journalId || cashJournals[0]?.id,
          amount,
          date,
          moveIds: [move.id],
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h2>{inbound ? l("Terima pembayaran", "Register payment") : l("Bayar tagihan", "Pay bill")}</h2>
      <div className="fields">
        <label className="field">
          <span>{l("Jurnal kas/bank", "Bank/cash journal")}</span>
          <select value={journalId} onChange={(e) => setJournalId(e.target.value)}>
            {cashJournals.map((j) => (
              <option key={j.id} value={j.id}>
                {j.code} — {j.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{l("Jumlah (mata uang perusahaan)", "Amount (company currency)")}</span>
          <input
            className="num"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{l("Tanggal", "Date")}</span>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <button className="primary" disabled={busy}>
        {l("Catat pembayaran", "Create payment")}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
