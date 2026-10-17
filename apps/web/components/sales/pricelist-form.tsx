"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { can } from "../../lib/resources";
import { useOptions, type CurrencyOption, type ProductOption } from "../accounting/use-options";
import { useMe } from "../me-context";

interface Item {
  productId: string;
  categoryId: string;
  minQuantity: string;
  compute: "fixed" | "discount";
  fixedPrice: string;
  discount: string;
  dateStart: string;
  dateEnd: string;
}
interface Pricelist {
  id: string;
  name: string;
  currencyCode: string;
  companyId: string | null;
  active: boolean;
  items: Record<keyof Item, string | null>[];
}

const emptyItem = (): Item => ({
  productId: "",
  categoryId: "",
  minQuantity: "0",
  compute: "discount",
  fixedPrice: "",
  discount: "0",
  dateStart: "",
  dateEnd: "",
});
const orNull = (v: string) => (v === "" ? null : v);
const trim = (v: string | null) => (v == null ? "" : String(Number(v)));

/** Daftar harga dengan aturan per produk/kategori/semua produk, minimum kuantitas, dan periode promo. */
export function PricelistForm({ id }: { id: string }) {
  const me = useMe();
  const router = useRouter();
  const { l } = useI18n();
  const isNew = id === "new";
  const editable = can(me.permissions, "sales.manage");
  const products = useOptions<ProductOption>("/products");
  const categories = useOptions<{ id: string; name: string }>("/product-categories");
  const currencies = useOptions<CurrencyOption>("/currencies");
  const [header, setHeader] = useState({ name: "", currencyCode: "IDR", active: true });
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(isNew);

  useEffect(() => {
    if (isNew) return;
    api<Pricelist>(`/pricelists/${id}`)
      .then((p) => {
        setHeader({ name: p.name, currencyCode: p.currencyCode, active: p.active });
        setItems(
          p.items.map((i) => ({
            productId: i.productId ?? "",
            categoryId: i.categoryId ?? "",
            minQuantity: trim(i.minQuantity),
            compute: (i.compute as Item["compute"]) ?? "discount",
            fixedPrice: i.fixedPrice == null ? "" : trim(i.fixedPrice),
            discount: trim(i.discount),
            dateStart: i.dateStart ?? "",
            dateEnd: i.dateEnd ?? "",
          })),
        );
        setLoaded(true);
      })
      .catch((e: Error) => setError(e.message));
  }, [id, isNew]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const body = {
        ...header,
        items: items.map((i) => ({
          productId: orNull(i.productId),
          categoryId: orNull(i.categoryId),
          minQuantity: i.minQuantity || "0",
          compute: i.compute,
          fixedPrice: i.compute === "fixed" ? orNull(i.fixedPrice) : null,
          discount: i.compute === "discount" ? i.discount || "0" : "0",
          dateStart: orNull(i.dateStart),
          dateEnd: orNull(i.dateEnd),
        })),
      };
      const saved = isNew
        ? await api<Pricelist>("/pricelists", { method: "POST", body })
        : await api<Pricelist>(`/pricelists/${id}`, { method: "PATCH", body });
      if (isNew) router.replace(`/sales/pricelists/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(l("Hapus daftar harga ini?", "Delete this pricelist?"))) return;
    try {
      await api(`/pricelists/${id}`, { method: "DELETE" });
      router.replace("/sales/pricelists");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!loaded) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  const err = (path: string) => fieldErrors[path] && <small className="error">{fieldErrors[path]}</small>;
  const set = (i: number, patch: Partial<Item>) =>
    setItems((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form className="panel" onSubmit={onSubmit}>
      <header className="toolbar">
        <h1>{header.name || l("Daftar harga baru", "New pricelist")}</h1>
        {editable && (
          <button className="primary" disabled={busy}>
            {l("Simpan", "Save")}
          </button>
        )}
        {editable && !isNew && (
          <button type="button" className="danger" onClick={remove}>
            {l("Hapus", "Delete")}
          </button>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      <fieldset className="fields" disabled={!editable}>
        <label className="field">
          <span>{l("Nama *", "Name *")}</span>
          <input
            required
            value={header.name}
            onChange={(e) => setHeader((h) => ({ ...h, name: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Mata uang", "Currency")}</span>
          <select
            value={header.currencyCode}
            onChange={(e) => setHeader((h) => ({ ...h, currencyCode: e.target.value }))}
          >
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
        </label>
        <label className="field check">
          <input
            type="checkbox"
            checked={header.active}
            onChange={(e) => setHeader((h) => ({ ...h, active: e.target.checked }))}
          />
          <span>{l("Aktif", "Active")}</span>
        </label>
      </fieldset>

      <h2>{l("Aturan harga", "Price rules")}</h2>
      <p className="muted">
        {l(
          "Aturan paling spesifik yang berlaku dipakai: produk > kategori (terdekat) > semua produk; lalu minimum kuantitas tertinggi; lalu aturan bertanggal (promo).",
          "The most specific applicable rule wins: product > category (closest) > all products; then the highest minimum quantity; then dated (promo) rules.",
        )}
      </p>
      <div className="table-wrap">
        <table className="lines">
          <thead>
            <tr>
              <th>{l("Produk", "Product")}</th>
              <th>{l("Kategori", "Category")}</th>
              <th className="num">{l("Min. qty", "Min. qty")}</th>
              <th>{l("Perhitungan", "Computation")}</th>
              <th className="num">{l("Nilai", "Value")}</th>
              <th>{l("Mulai", "Start")}</th>
              <th>{l("Selesai", "End")}</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {items.map((x, i) => (
              <tr key={i}>
                <td>
                  <select
                    disabled={!editable}
                    value={x.productId}
                    onChange={(e) =>
                      set(i, { productId: e.target.value, categoryId: e.target.value ? "" : x.categoryId })
                    }
                  >
                    <option value="">{x.categoryId ? "—" : l("Semua produk", "All products")}</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} {p.name}
                      </option>
                    ))}
                  </select>
                  {err(`items.${i}.productId`)}
                  {err(`items.${i}`)}
                </td>
                <td>
                  <select
                    disabled={!editable || Boolean(x.productId)}
                    value={x.categoryId}
                    onChange={(e) => set(i, { categoryId: e.target.value })}
                  >
                    <option value="">—</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    disabled={!editable}
                    className="num short"
                    inputMode="decimal"
                    value={x.minQuantity}
                    onChange={(e) => set(i, { minQuantity: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    disabled={!editable}
                    value={x.compute}
                    onChange={(e) => set(i, { compute: e.target.value as Item["compute"] })}
                  >
                    <option value="discount">
                      {l("Diskon % dari harga jual", "Discount % of sales price")}
                    </option>
                    <option value="fixed">{l("Harga tetap", "Fixed price")}</option>
                  </select>
                </td>
                <td>
                  <input
                    disabled={!editable}
                    className="num"
                    inputMode="decimal"
                    value={x.compute === "fixed" ? x.fixedPrice : x.discount}
                    onChange={(e) =>
                      set(
                        i,
                        x.compute === "fixed" ? { fixedPrice: e.target.value } : { discount: e.target.value },
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    disabled={!editable}
                    type="date"
                    value={x.dateStart}
                    onChange={(e) => set(i, { dateStart: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    disabled={!editable}
                    type="date"
                    value={x.dateEnd}
                    onChange={(e) => set(i, { dateEnd: e.target.value })}
                  />
                  {err(`items.${i}.dateEnd`)}
                </td>
                {editable && (
                  <td>
                    <button
                      type="button"
                      className="link"
                      aria-label={l("Hapus baris", "Remove line")}
                      onClick={() => setItems((r) => r.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {editable && (
            <tfoot>
              <tr>
                <td colSpan={8}>
                  <button type="button" className="link" onClick={() => setItems((r) => [...r, emptyItem()])}>
                    + {l("Tambah aturan", "Add rule")}
                  </button>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </form>
  );
}
