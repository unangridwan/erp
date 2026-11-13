"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import {
  useOptions,
  type ProductOption,
  type UomOption,
} from "../../../../../components/accounting/use-options";
import { ask, toast } from "../../../../../components/feedback";
import { BOM_TYPE } from "../../../../../components/manufacturing/states";
import { useMe } from "../../../../../components/me-context";
import { api, ApiError } from "../../../../../lib/api";
import { money } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";

interface Line {
  productId: string;
  quantity: string;
  uomId: string;
}
interface Op {
  name: string;
  workCenterId: string;
  minutes: string;
}
interface Cost {
  quantity: string;
  material: string;
  conversion: string;
  total: string;
  unit: string;
  components: {
    productId: string;
    sku: string | null;
    productName: string | null;
    quantity: string;
    unitCost: string;
  }[];
  operations: { name: string; workCenterName: string | null; minutes: string }[];
}
interface Bom {
  id: string;
  productId: string;
  code: string | null;
  quantity: string;
  bomType: "normal" | "phantom";
  active: boolean;
  note: string | null;
  lines: { productId: string; quantity: string; uomId: string | null }[];
  operations: { name: string; workCenterId: string; minutes: string }[];
  cost: Cost | null;
}

const n = (v: string) => String(Number(v));

function BomForm() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const me = useMe();
  const { l, locale } = useI18n();
  const products = useOptions<ProductOption>("/products").filter((p) => !p.isVariantTemplate);
  const uoms = useOptions<UomOption>("/uoms");
  const centers = useOptions<{ id: string; code: string; name: string }>("/work-centers");
  const [doc, setDoc] = useState<Bom | null>(null);
  const [form, setForm] = useState({
    productId: "",
    code: "",
    quantity: "1",
    bomType: "normal" as "normal" | "phantom",
    active: true,
    note: "",
    lines: [{ productId: "", quantity: "1", uomId: "" }] as Line[],
    operations: [] as Op[],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const manage = can(me.permissions, "mrp.manage");

  const apply = (b: Bom) => {
    setDoc(b);
    setForm({
      productId: b.productId,
      code: b.code ?? "",
      quantity: n(b.quantity),
      bomType: b.bomType,
      active: b.active,
      note: b.note ?? "",
      lines: b.lines.map((x) => ({ productId: x.productId, quantity: n(x.quantity), uomId: x.uomId ?? "" })),
      operations: b.operations.map((o) => ({
        name: o.name,
        workCenterId: o.workCenterId,
        minutes: n(o.minutes),
      })),
    });
  };
  const load = useCallback(() => {
    if (isNew) return;
    api<Bom>(`/boms/${id}`)
      .then(apply)
      .catch((e: Error) => toast.error(e.message));
  }, [id, isNew]);
  useEffect(load, [load]);

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const body = {
        ...form,
        code: form.code || null,
        note: form.note || null,
        lines: form.lines.filter((x) => x.productId).map((x) => ({ ...x, uomId: x.uomId || null })),
        operations: form.operations.filter((o) => o.name && o.workCenterId),
      };
      if (isNew) {
        const created = await api<Bom>("/boms", { method: "POST", body });
        router.replace(`/manufacturing/boms/${created.id}`);
      } else {
        apply(await api<Bom>(`/boms/${id}`, { method: "PUT", body }));
        toast.success(l("Disimpan", "Saved"));
      }
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await ask({ message: l("Hapus BOM ini?", "Delete this BOM?"), danger: true }))) return;
    try {
      await api(`/boms/${id}`, { method: "DELETE" });
      router.replace("/manufacturing/boms");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const err = (k: string) => errors[k] && <small className="error">{errors[k]}</small>;
  const setLine = (i: number, patch: Partial<Line>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const setOp = (i: number, patch: Partial<Op>) =>
    setForm((f) => ({ ...f, operations: f.operations.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const productLabel = (pid: string) => {
    const p = products.find((x) => x.id === pid);
    return p ? `${p.sku} ${p.name}` : "";
  };

  return (
    <div className="stack-wide">
      <header className="toolbar">
        <h1>
          <Link href="/manufacturing/boms">{l("Bill of Materials", "Bills of Materials")}</Link> /{" "}
          {isNew ? l("Baru", "New") : productLabel(form.productId)}
        </h1>
        {manage && (
          <button className="primary" disabled={busy} aria-busy={busy} onClick={save}>
            {l("Simpan", "Save")}
          </button>
        )}
        {manage && !isNew && (
          <button className="danger" disabled={busy} onClick={remove}>
            {l("Hapus", "Delete")}
          </button>
        )}
        {!isNew && doc?.bomType === "normal" && can(me.permissions, "mrp.write") && (
          <Link className="button" href={`/manufacturing/orders/new?productId=${form.productId}&bomId=${id}`}>
            {l("Buat order produksi", "Create production order")}
          </Link>
        )}
      </header>
      <div className="panel">
        <fieldset className="fields" disabled={!manage}>
          <label className="field">
            <span>{l("Produk jadi *", "Finished product *")}</span>
            <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
              <option value="">—</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} {p.name}
                </option>
              ))}
            </select>
            {err("productId")}
          </label>
          <label className="field">
            <span>{l("Jumlah hasil per BOM *", "Quantity produced per BOM *")}</span>
            <input
              inputMode="decimal"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
            {err("quantity")}
          </label>
          <label className="field">
            <span>{l("Jenis", "Type")}</span>
            <select
              value={form.bomType}
              onChange={(e) => setForm({ ...form, bomType: e.target.value as "normal" | "phantom" })}
            >
              {Object.entries(BOM_TYPE).map(([k, v]) => (
                <option key={k} value={k}>
                  {l(...v)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Kode / versi", "Code / version")}</span>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </label>
          <label className="field">
            <span>{l("Catatan", "Note")}</span>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />{" "}
            {l("Aktif", "Active")}
          </label>
        </fieldset>

        <h2>{l("Komponen", "Components")}</h2>
        {err("lines")}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Produk", "Product")}</th>
                <th className="num">{l("Jumlah", "Quantity")}</th>
                <th>{l("Satuan", "Unit")}</th>
                {manage && <th />}
              </tr>
            </thead>
            <tbody>
              {form.lines.map((x, i) => {
                const product = products.find((p) => p.id === x.productId);
                const base = uoms.find((u) => u.id === product?.uomId);
                return (
                  <tr key={i}>
                    <td>
                      <select
                        aria-label={l("Komponen", "Component")}
                        disabled={!manage}
                        value={x.productId}
                        onChange={(e) => setLine(i, { productId: e.target.value, uomId: "" })}
                      >
                        <option value="">—</option>
                        {products
                          .filter((p) => p.id !== form.productId)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.sku} {p.name}
                            </option>
                          ))}
                      </select>
                      {err(`lines.${i}.productId`)}
                    </td>
                    <td className="num">
                      <input
                        className="num short"
                        inputMode="decimal"
                        disabled={!manage}
                        aria-label={l("Jumlah", "Quantity")}
                        value={x.quantity}
                        onChange={(e) => setLine(i, { quantity: e.target.value })}
                      />
                      {err(`lines.${i}.quantity`)}
                    </td>
                    <td>
                      <select
                        aria-label={l("Satuan", "Unit")}
                        disabled={!manage}
                        value={x.uomId}
                        onChange={(e) => setLine(i, { uomId: e.target.value })}
                      >
                        <option value="">{base?.name ?? l("satuan produk", "product unit")}</option>
                        {uoms
                          .filter((u) => !base || (u.categoryId === base.categoryId && u.id !== base.id))
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                      </select>
                      {err(`lines.${i}.uomId`)}
                    </td>
                    {manage && (
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
        {manage && (
          <button
            type="button"
            className="link"
            onClick={() =>
              setForm((f) => ({ ...f, lines: [...f.lines, { productId: "", quantity: "1", uomId: "" }] }))
            }
          >
            + {l("Tambah komponen", "Add component")}
          </button>
        )}

        <h2>{l("Operasi (rute)", "Operations (routing)")}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Operasi", "Operation")}</th>
                <th>{l("Stasiun kerja", "Work center")}</th>
                <th className="num">{l("Menit per hasil BOM", "Minutes per BOM yield")}</th>
                {manage && <th />}
              </tr>
            </thead>
            <tbody>
              {form.operations.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    {l("Tanpa operasi: biaya hanya bahan.", "No operations: cost is materials only.")}
                  </td>
                </tr>
              )}
              {form.operations.map((o, i) => (
                <tr key={i}>
                  <td>
                    <input
                      aria-label={l("Operasi", "Operation")}
                      disabled={!manage}
                      value={o.name}
                      onChange={(e) => setOp(i, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={l("Stasiun kerja", "Work center")}
                      disabled={!manage}
                      value={o.workCenterId}
                      onChange={(e) => setOp(i, { workCenterId: e.target.value })}
                    >
                      <option value="">—</option>
                      {centers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} {c.name}
                        </option>
                      ))}
                    </select>
                    {err(`operations.${i}.workCenterId`)}
                  </td>
                  <td className="num">
                    <input
                      className="num short"
                      inputMode="decimal"
                      disabled={!manage}
                      aria-label={l("Menit", "Minutes")}
                      value={o.minutes}
                      onChange={(e) => setOp(i, { minutes: e.target.value })}
                    />
                  </td>
                  {manage && (
                    <td>
                      <button
                        type="button"
                        className="link"
                        aria-label={l("Hapus operasi", "Remove operation")}
                        onClick={() =>
                          setForm((f) => ({ ...f, operations: f.operations.filter((_, j) => j !== i) }))
                        }
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
        {manage && (
          <button
            type="button"
            className="link"
            onClick={() =>
              setForm((f) => ({
                ...f,
                operations: [...f.operations, { name: "", workCenterId: centers[0]?.id ?? "", minutes: "0" }],
              }))
            }
          >
            + {l("Tambah operasi", "Add operation")}
          </button>
        )}
      </div>

      {doc?.cost && (
        <div className="panel">
          <h2>
            {l("Estimasi biaya", "Cost estimate")} ({money(doc.cost.quantity, locale, 4)})
          </h2>
          <div className="cards">
            <div className="card">
              <small className="muted">{l("Bahan", "Materials")}</small>
              <strong>{money(doc.cost.material, locale)}</strong>
            </div>
            <div className="card">
              <small className="muted">{l("Konversi", "Conversion")}</small>
              <strong>{money(doc.cost.conversion, locale)}</strong>
            </div>
            <div className="card">
              <small className="muted">{l("Biaya per unit", "Unit cost")}</small>
              <strong>{money(doc.cost.unit, locale, 2)}</strong>
            </div>
          </div>
          <p className="muted">
            {l(
              "Bahan memakai biaya rata-rata/terakhir saat ini; kit phantom diurai ke komponennya. Biaya aktual dihitung saat order produksi selesai.",
              "Materials use current average/last cost; phantom kits are exploded into their components. Actual cost is computed when the production order is done.",
            )}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Bahan (terurai)", "Materials (exploded)")}</th>
                  <th className="num">{l("Jumlah", "Quantity")}</th>
                  <th className="num">{l("Biaya/unit", "Unit cost")}</th>
                </tr>
              </thead>
              <tbody>
                {doc.cost.components.map((c) => (
                  <tr key={c.productId}>
                    <td>
                      {c.sku} {c.productName}
                    </td>
                    <td className="num">{money(c.quantity, locale, 4)}</td>
                    <td className="num">{money(c.unitCost, locale, 2)}</td>
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

export default function BomPage() {
  return (
    <Suspense>
      <BomForm />
    </Suspense>
  );
}
