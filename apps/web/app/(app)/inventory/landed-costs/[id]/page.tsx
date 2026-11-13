"use client";

import { LANDED_COST_SPLIT_LABEL, LANDED_COST_SPLIT_METHODS, type LandedCostSplit } from "@erp/shared";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useOptions, type AccountOption } from "../../../../../components/accounting/use-options";
import { ask, toast } from "../../../../../components/feedback";
import { LC_STATE } from "../../../../../components/inventory/landed-cost-state";
import { useMe } from "../../../../../components/me-context";
import { api, ApiError } from "../../../../../lib/api";
import { money, today } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";

interface Line {
  name: string;
  accountId: string;
  amount: string;
  splitMethod: LandedCostSplit;
}
interface ProductRow {
  moveId: string;
  pickingName: string;
  sku: string;
  productName: string;
  quantity: string;
  remainingQty: string;
  value: string;
  addition: string;
  stockPortion: string;
  soldPortion: string;
  newUnitCost: string | null;
}
interface LandedCost {
  id: string;
  name: string;
  date: string;
  state: string;
  note: string | null;
  vendorBillId: string | null;
  total: string;
  pickings: { id: string; name: string; origin: string | null }[];
  lines: (Line & { id: string })[];
  products: ProductRow[];
  errors: string[];
  accountMove: { id: string; name: string } | null;
}
interface Picking {
  id: string;
  name: string;
  origin: string | null;
  partnerName?: string | null;
}

const emptyLine = (): Line => ({ name: "", accountId: "", amount: "", splitMethod: "value" });

function LandedCostForm() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const isNew = id === "new";
  const router = useRouter();
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const m = (v: string) => money(v, locale);
  const accounts = useOptions<AccountOption>("/accounts");
  const pickings = useOptions<Picking>("/pickings?pickingType=incoming&state=done");
  const [doc, setDoc] = useState<LandedCost | null>(null);
  const [form, setForm] = useState({
    date: today(),
    note: "",
    pickingIds: search.get("pickingId") ? [search.get("pickingId")!] : ([] as string[]),
    lines: [emptyLine()],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const manage = can(me.permissions, "inventory.manage");
  const editable = manage && (isNew || doc?.state === "draft");

  const apply = (d: LandedCost) => {
    setDoc(d);
    setForm({
      date: d.date,
      note: d.note ?? "",
      pickingIds: d.pickings.map((p) => p.id),
      lines: d.lines.map((x) => ({
        name: x.name,
        accountId: x.accountId,
        amount: String(Number(x.amount)),
        splitMethod: x.splitMethod,
      })),
    });
  };
  const load = useCallback(() => {
    if (isNew) return;
    api<LandedCost>(`/landed-costs/${id}`)
      .then(apply)
      .catch((e: Error) => toast.error(e.message));
  }, [id, isNew]);
  useEffect(load, [load]);

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const body = { ...form, note: form.note || null, vendorBillId: doc?.vendorBillId ?? null };
      if (isNew) {
        const created = await api<LandedCost>("/landed-costs", { method: "POST", body });
        router.replace(`/inventory/landed-costs/${created.id}`);
      } else {
        apply(await api<LandedCost>(`/landed-costs/${id}`, { method: "PUT", body }));
        toast.success(l("Disimpan", "Saved"));
      }
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const action = async (path: "post" | "cancel", confirm: string) => {
    if (!(await ask({ message: confirm, danger: path === "cancel" }))) return;
    setBusy(true);
    try {
      apply(await api<LandedCost>(`/landed-costs/${id}/${path}`, { method: "POST" }));
      toast.success(
        path === "post" ? l("Landed cost diposting", "Landed cost posted") : l("Dibatalkan", "Cancelled"),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const setLine = (i: number, patch: Partial<Line>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const err = (k: string) => errors[k] && <small className="error">{errors[k]}</small>;
  const total = form.lines.reduce((s, x) => s + Number(x.amount || 0), 0);

  return (
    <div className="stack-wide">
      <header className="toolbar">
        <h1>
          <Link href="/inventory/landed-costs">{l("Landed cost", "Landed costs")}</Link> /{" "}
          {isNew ? l("Baru", "New") : doc?.name}
        </h1>
        {doc && (
          <span className={`pill ${doc.state === "posted" ? "ok" : ""}`}>
            {l(...(LC_STATE[doc.state] ?? [doc.state, doc.state]))}
          </span>
        )}
      </header>

      <div className="panel">
        <div className="fields">
          <label className="field">
            <span>{l("Tanggal", "Date")}</span>
            <input
              type="date"
              disabled={!editable}
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Penerimaan *", "Receipts *")}</span>
            <select
              multiple
              size={4}
              disabled={!editable}
              value={form.pickingIds}
              onChange={(e) =>
                setForm({ ...form, pickingIds: [...e.target.selectedOptions].map((o) => o.value) })
              }
            >
              {pickings.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.origin ? `· ${p.origin}` : ""} {p.partnerName ? `· ${p.partnerName}` : ""}
                </option>
              ))}
            </select>
            {err("pickingIds")}
          </label>
          <label className="field">
            <span>{l("Catatan", "Note")}</span>
            <input
              disabled={!editable}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
        </div>
        {doc?.accountMove && (
          <p className="muted">
            {l("Jurnal", "Journal entry")}:{" "}
            <Link href={`/accounting/moves/${doc.accountMove.id}`}>{doc.accountMove.name}</Link>
          </p>
        )}

        <h2>{l("Biaya tambahan", "Additional costs")}</h2>
        <div className="table-wrap">
          <table className="lines">
            <thead>
              <tr>
                <th>{l("Deskripsi", "Description")}</th>
                <th>{l("Akun lawan", "Counterpart account")}</th>
                <th>{l("Dibagi menurut", "Split by")}</th>
                <th className="num">{l("Jumlah", "Amount")}</th>
                {editable && <th />}
              </tr>
            </thead>
            <tbody>
              {form.lines.map((x, i) => (
                <tr key={i}>
                  <td>
                    <input
                      disabled={!editable}
                      aria-label={l("Deskripsi", "Description")}
                      placeholder={l("mis. Ongkos angkut", "e.g. Freight")}
                      value={x.name}
                      onChange={(e) => setLine(i, { name: e.target.value })}
                    />
                    {err(`lines.${i}.name`)}
                  </td>
                  <td>
                    <select
                      disabled={!editable}
                      aria-label={l("Akun lawan", "Counterpart account")}
                      value={x.accountId}
                      onChange={(e) => setLine(i, { accountId: e.target.value })}
                    >
                      <option value="">—</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} {a.name}
                        </option>
                      ))}
                    </select>
                    {err(`lines.${i}.accountId`)}
                  </td>
                  <td>
                    <select
                      disabled={!editable}
                      aria-label={l("Dibagi menurut", "Split by")}
                      value={x.splitMethod}
                      onChange={(e) => setLine(i, { splitMethod: e.target.value as LandedCostSplit })}
                    >
                      {LANDED_COST_SPLIT_METHODS.map((s) => (
                        <option key={s} value={s}>
                          {l(...LANDED_COST_SPLIT_LABEL[s])}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="num"
                      inputMode="decimal"
                      disabled={!editable}
                      aria-label={l("Jumlah", "Amount")}
                      value={x.amount}
                      onChange={(e) => setLine(i, { amount: e.target.value })}
                    />
                    {err(`lines.${i}.amount`)}
                  </td>
                  {editable && (
                    <td>
                      <button
                        type="button"
                        className="link"
                        aria-label={l("Hapus baris", "Remove line")}
                        onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}
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
                <td colSpan={3}>
                  {editable && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => setForm({ ...form, lines: [...form.lines, emptyLine()] })}
                    >
                      + {l("Tambah biaya", "Add cost")}
                    </button>
                  )}
                </td>
                <td className="num">
                  <strong>{m(String(total))}</strong>
                </td>
                {editable && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="cp-right">
          {editable && (
            <button className="primary" disabled={busy} onClick={save}>
              {isNew ? l("Simpan & pratinjau", "Save & preview") : l("Simpan", "Save")}
            </button>
          )}
          {doc?.state === "draft" && can(me.permissions, "accounting.post") && (
            <button
              className="primary"
              disabled={busy || doc.errors.length > 0}
              onClick={() =>
                void action(
                  "post",
                  l(
                    `Posting ${doc.name}? Nilai persediaan dinaikkan dan jurnal dibuat.`,
                    `Post ${doc.name}? Inventory value is increased and a journal entry is created.`,
                  ),
                )
              }
            >
              {l("Posting", "Post")}
            </button>
          )}
          {doc && doc.state !== "cancel" && manage && (
            <button
              className="danger"
              disabled={busy}
              onClick={() => void action("cancel", l(`Batalkan ${doc.name}?`, `Cancel ${doc.name}?`))}
            >
              {l("Batalkan", "Cancel")}
            </button>
          )}
        </div>
      </div>

      {doc && (
        <div className="panel">
          <h2>
            {doc.state === "posted"
              ? l("Hasil pembagian", "Allocation result")
              : l("Pratinjau pembagian", "Allocation preview")}
          </h2>
          {doc.errors.map((e) => (
            <p key={e} className="error">
              {e}
            </p>
          ))}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Penerimaan", "Receipt")}</th>
                  <th>{l("Produk", "Product")}</th>
                  <th className="num">{l("Diterima", "Received")}</th>
                  <th className="num">{l("Sisa di gudang", "Still in stock")}</th>
                  <th className="num">{l("Nilai awal", "Original value")}</th>
                  <th className="num">{l("Tambahan", "Added cost")}</th>
                  <th className="num">{l("Ke persediaan", "To inventory")}</th>
                  <th className="num">{l("Ke HPP", "To COGS")}</th>
                  <th className="num">{l("Biaya/unit baru", "New unit cost")}</th>
                </tr>
              </thead>
              <tbody>
                {doc.products.map((p) => (
                  <tr key={p.moveId}>
                    <td>{p.pickingName}</td>
                    <td>
                      {p.sku} {p.productName}
                    </td>
                    <td className="num">{Number(p.quantity).toLocaleString(locale)}</td>
                    <td className="num">{Number(p.remainingQty).toLocaleString(locale)}</td>
                    <td className="num">{m(p.value)}</td>
                    <td className="num">{m(p.addition)}</td>
                    <td className="num">{m(p.stockPortion)}</td>
                    <td className="num">{m(p.soldPortion)}</td>
                    <td className="num">{p.newUnitCost ? m(p.newUnitCost) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            {tx({
              id: "Barang yang sudah keluar sejak diterima tidak lagi di persediaan, sehingga porsi biayanya langsung dibebankan ke HPP.",
              en: "Goods that left stock since receipt are no longer in inventory, so their share of the cost goes straight to COGS.",
            })}
          </p>
        </div>
      )}
    </div>
  );
}

export default function LandedCostPage() {
  return (
    <Suspense>
      <LandedCostForm />
    </Suspense>
  );
}
