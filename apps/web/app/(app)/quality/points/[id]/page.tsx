"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useOptions } from "../../../../../components/accounting/use-options";
import { ask, toast } from "../../../../../components/feedback";
import { useMe } from "../../../../../components/me-context";
import { api, ApiError } from "../../../../../lib/api";
import { parseNumberInput } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";
import { LoadFailed, useLoadError } from "../../../../../components/load-failed";

interface Item {
  label: string;
  kind: "pass_fail" | "measure";
  min: string;
  max: string;
  unit: string;
  photo: boolean;
}
interface Form {
  name: string;
  trigger: "receipt" | "production";
  productId: string;
  categoryId: string;
  partnerId: string;
  sampling: "all" | "percent" | "quantity";
  sampleValue: string;
  instructions: string;
  quarantine: boolean;
  active: boolean;
  items: Item[];
}
const EMPTY: Form = {
  name: "",
  trigger: "receipt",
  productId: "",
  categoryId: "",
  partnerId: "",
  sampling: "all",
  sampleValue: "",
  instructions: "",
  quarantine: true,
  active: true,
  items: [{ label: "", kind: "pass_fail", min: "", max: "", unit: "", photo: false }],
};
/** Batas ukur: format Indonesia ("1.000,5"); teks tak valid dikirim apa adanya agar ditolak server, bukan jadi kosong. */
const num = (v: string): number | string | null => {
  if (v.trim() === "") return null;
  const n = Number(parseNumberInput(v));
  return Number.isFinite(n) ? n : v;
};

/** Editor titik kontrol: kapan diperiksa, untuk produk/kategori/pemasok mana, sampel, dan butir pemeriksaan. */
export default function QualityPointPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { l } = useI18n();
  const [loadError, failLoad] = useLoadError();
  const me = useMe();
  const isNew = id === "new";
  const [f, setF] = useState<Form | null>(isNew ? EMPTY : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const products = useOptions<{ id: string; sku: string; name: string }>("/products");
  const categories = useOptions<{ id: string; name: string }>("/product-categories");
  const partners = useOptions<{ id: string; name: string }>("/partners");
  const editable = can(me.permissions, "quality.manage");

  useEffect(() => {
    if (isNew) return;
    api<
      Form & {
        sampleValue: string | null;
        items: (Omit<Item, "min" | "max" | "unit"> & {
          min: number | null;
          max: number | null;
          unit: string | null;
        })[];
      }
    >(`/quality-points/${id}`).then(
      (p) =>
        setF({
          ...EMPTY,
          ...p,
          productId: p.productId ?? "",
          categoryId: p.categoryId ?? "",
          partnerId: p.partnerId ?? "",
          sampleValue: p.sampleValue ?? "",
          instructions: p.instructions ?? "",
          items: p.items.map((x) => ({
            ...x,
            min: x.min === null ? "" : String(x.min),
            max: x.max === null ? "" : String(x.max),
            unit: x.unit ?? "",
            photo: !!x.photo,
          })),
        }),
      failLoad,
    );
  }, [id, isNew]);
  if (!f)
    return loadError ? (
      <LoadFailed message={loadError} />
    ) : (
      <p className="muted">{l("Memuat…", "Loading…")}</p>
    );
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });
  const setItem = (idx: number, patch: Partial<Item>) =>
    set(
      "items",
      f.items.map((x, j) => (j === idx ? { ...x, ...patch } : x)),
    );
  const err = (k: string) => (errors[k] ? <small className="error">{errors[k]}</small> : null);

  async function save() {
    setBusy(true);
    setErrors({});
    const body = {
      name: f!.name,
      trigger: f!.trigger,
      productId: f!.productId || null,
      categoryId: f!.categoryId || null,
      partnerId: f!.trigger === "receipt" ? f!.partnerId || null : null,
      sampling: f!.sampling,
      sampleValue: f!.sampling === "all" ? null : f!.sampleValue,
      instructions: f!.instructions || null,
      quarantine: f!.quarantine,
      active: f!.active,
      items: f!.items.map((x) => ({
        label: x.label,
        kind: x.kind,
        min: x.kind === "measure" ? num(x.min) : null,
        max: x.kind === "measure" ? num(x.max) : null,
        unit: x.kind === "measure" ? x.unit || null : null,
        photo: x.photo,
      })),
    };
    try {
      const r = await api<{ id: string }>(isNew ? "/quality-points" : `/quality-points/${id}`, {
        method: isNew ? "POST" : "PATCH",
        body,
      });
      toast.success(l("Titik kontrol disimpan.", "Control point saved."));
      if (isNew) router.replace(`/quality/points/${r.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setErrors(e.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await ask({
      title: l("Hapus titik kontrol?", "Delete control point?"),
      message: l("Pemeriksaan yang sudah ada tetap tersimpan.", "Existing checks are kept."),
      confirmLabel: l("Hapus", "Delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/quality-points/${id}`, { method: "DELETE" });
      router.push("/quality/points");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <nav className="breadcrumb">
            <Link href="/quality/points">{l("Titik Kontrol Mutu", "Quality Control Points")}</Link> /{" "}
            {f.name || l("Baru", "New")}
          </nav>
        </div>
        {editable && (
          <div className="cp-right">
            {!isNew && (
              <button type="button" className="danger" onClick={remove} disabled={busy}>
                {l("Hapus", "Delete")}
              </button>
            )}
            <button type="button" className="primary" onClick={save} disabled={busy} aria-busy={busy}>
              {l("Simpan", "Save")}
            </button>
          </div>
        )}
      </header>
      <section className="panel">
        <div className="fields">
          <label className="field" data-field="name">
            <span>{l("Nama", "Name")} *</span>
            <input
              value={f.name}
              maxLength={160}
              disabled={!editable}
              onChange={(e) => set("name", e.target.value)}
            />
            {err("name")}
          </label>
          <label className="field">
            <span>{l("Periksa saat", "Inspect on")}</span>
            <select
              value={f.trigger}
              disabled={!editable}
              onChange={(e) => set("trigger", e.target.value as Form["trigger"])}
            >
              <option value="receipt">{l("Penerimaan dari pemasok", "Receipt from supplier")}</option>
              <option value="production">{l("Hasil produksi", "Production output")}</option>
            </select>
          </label>
          <label className="field">
            <span>{l("Produk", "Product")}</span>
            <select
              value={f.productId}
              disabled={!editable}
              onChange={(e) => set("productId", e.target.value)}
            >
              <option value="">{l("Semua produk", "All products")}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Kategori produk", "Product category")}</span>
            <select
              value={f.categoryId}
              disabled={!editable}
              onChange={(e) => set("categoryId", e.target.value)}
            >
              <option value="">{l("Semua kategori", "All categories")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {f.trigger === "receipt" && (
            <label className="field" data-field="partnerId">
              <span>{l("Pemasok", "Supplier")}</span>
              <select
                value={f.partnerId}
                disabled={!editable}
                onChange={(e) => set("partnerId", e.target.value)}
              >
                <option value="">{l("Semua pemasok", "All suppliers")}</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {err("partnerId")}
            </label>
          )}
          <label className="field">
            <span>{l("Sampel", "Sampling")}</span>
            <select
              value={f.sampling}
              disabled={!editable}
              onChange={(e) => set("sampling", e.target.value as Form["sampling"])}
            >
              <option value="all">{l("Semua barang", "All goods")}</option>
              <option value="percent">{l("Persen dari jumlah", "Percent of quantity")}</option>
              <option value="quantity">{l("Jumlah tetap", "Fixed quantity")}</option>
            </select>
          </label>
          {f.sampling !== "all" && (
            <label className="field" data-field="sampleValue">
              <span>{f.sampling === "percent" ? l("Persen", "Percent") : l("Jumlah", "Quantity")} *</span>
              <input
                type="number"
                min={0}
                value={f.sampleValue}
                disabled={!editable}
                onChange={(e) => set("sampleValue", e.target.value)}
              />
              {err("sampleValue")}
            </label>
          )}
          <label className="field check">
            <span>{l("Tahan di karantina sampai diputuskan", "Hold in quarantine until decided")}</span>
            <input
              type="checkbox"
              checked={f.quarantine}
              disabled={!editable}
              onChange={(e) => set("quarantine", e.target.checked)}
            />
          </label>
          <label className="field check">
            <span>{l("Aktif", "Active")}</span>
            <input
              type="checkbox"
              checked={f.active}
              disabled={!editable}
              onChange={(e) => set("active", e.target.checked)}
            />
          </label>
          <label className="field wide">
            <span>{l("Instruksi pemeriksaan", "Inspection instructions")}</span>
            <textarea
              rows={2}
              value={f.instructions}
              disabled={!editable}
              onChange={(e) => set("instructions", e.target.value)}
            />
          </label>
        </div>
      </section>
      <section className="panel">
        <h2>{l("Butir pemeriksaan", "Check items")}</h2>
        {err("items")}
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th>{l("Butir", "Item")}</th>
                <th>{l("Jenis", "Type")}</th>
                <th>Min</th>
                <th>Maks</th>
                <th>{l("Satuan", "Unit")}</th>
                <th>{l("Wajib foto", "Photo")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {f.items.map((x, idx) => (
                <tr key={idx}>
                  <td>
                    <input
                      aria-label={l("Butir", "Item")}
                      value={x.label}
                      maxLength={200}
                      disabled={!editable}
                      onChange={(e) => setItem(idx, { label: e.target.value })}
                    />
                    {err(`items.${idx}.label`)}
                  </td>
                  <td>
                    <select
                      aria-label={l("Jenis", "Type")}
                      value={x.kind}
                      disabled={!editable}
                      onChange={(e) => setItem(idx, { kind: e.target.value as Item["kind"] })}
                    >
                      <option value="pass_fail">{l("Lulus/gagal", "Pass/fail")}</option>
                      <option value="measure">{l("Ukur", "Measure")}</option>
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label="Min"
                      className="num short"
                      inputMode="decimal"
                      value={x.min}
                      disabled={!editable || x.kind !== "measure"}
                      onChange={(e) => setItem(idx, { min: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Max"
                      className="num short"
                      inputMode="decimal"
                      value={x.max}
                      disabled={!editable || x.kind !== "measure"}
                      onChange={(e) => setItem(idx, { max: e.target.value })}
                    />
                    {err(`items.${idx}.max`)}
                  </td>
                  <td>
                    <input
                      aria-label={l("Satuan", "Unit")}
                      className="short"
                      value={x.unit}
                      maxLength={20}
                      disabled={!editable || x.kind !== "measure"}
                      onChange={(e) => setItem(idx, { unit: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={l("Wajib foto", "Photo required")}
                      checked={x.photo}
                      disabled={!editable}
                      onChange={(e) => setItem(idx, { photo: e.target.checked })}
                    />
                  </td>
                  <td>
                    {editable && (
                      <button
                        type="button"
                        aria-label={l("Hapus butir", "Remove item")}
                        onClick={() =>
                          set(
                            "items",
                            f.items.filter((_, j) => j !== idx),
                          )
                        }
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable && (
          <button
            type="button"
            onClick={() =>
              set("items", [
                ...f.items,
                { label: "", kind: "pass_fail", min: "", max: "", unit: "", photo: false },
              ])
            }
          >
            {l("Tambah butir", "Add item")}
          </button>
        )}
      </section>
    </>
  );
}
