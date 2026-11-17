"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { toast } from "../../../../components/feedback";
import { COUNT_STATE, countPill } from "../../../../components/inventory/count-state";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { CountTabs } from "../../../../components/inventory/count-tabs";

interface Row {
  id: string;
  name: string;
  date: string;
  state: string;
  warehouseName: string;
  locationName: string;
  summary: { lines: number; counted: number; withVariance: number; netValue: string; absValue: string };
}

/** Sesi stock opname: daftar + buat sesi baru (gudang/lokasi, opsional kategori untuk cycle count). */
export default function StockCountsPage() {
  const me = useMe();
  const router = useRouter();
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [form, setForm] = useState<{
    warehouseId: string;
    locationId: string;
    categoryId: string;
    date: string;
  } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const warehouses = useOptions<{ id: string; code: string; name: string }>("/warehouses");
  const locations = useOptions<{
    id: string;
    completeName: string;
    usage: string;
    warehouseId: string | null;
  }>("/stock-locations");
  const categories = useOptions<{ id: string; name: string }>("/product-categories");
  const manage = can(me.permissions, "inventory.manage");

  useEffect(() => {
    api<Row[]>("/stock-counts")
      .then(setRows)
      .catch((e: Error) => toast.error(e.message));
  }, []);

  const create = async () => {
    if (!form) return;
    setErrors({});
    try {
      const created = await api<{ id: string }>("/stock-counts", {
        method: "POST",
        body: {
          warehouseId: form.warehouseId,
          locationId: form.locationId || null,
          categoryId: form.categoryId || null,
          date: form.date,
        },
      });
      router.push(`/inventory/counts/${created.id}`);
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <header className="toolbar">
        <h1>{l("Stock Opname & Penyesuaian", "Physical Inventory & Adjustments")}</h1>
        {manage && !form && (
          <button
            className="primary"
            onClick={() =>
              setForm({ warehouseId: warehouses[0]?.id ?? "", locationId: "", categoryId: "", date: today() })
            }
          >
            {l("Sesi baru", "New session")}
          </button>
        )}
      </header>
      <CountTabs />
      <p className="muted">
        {l(
          "Hitung fisik per gudang/lokasi (penuh) atau per kategori (cycle count): stok sistem diambil saat hitung dimulai, hasil hitung diisi manual, scan barcode, atau impor Excel; selisih diajukan untuk disetujui lalu diposting sebagai penyesuaian.",
          "Physical counts per warehouse/location (full) or per category (cycle count): system stock is captured when counting starts, counts are entered manually, by barcode scan, or Excel import; variances are submitted for approval and then posted as adjustments.",
        )}
      </p>
      {form && (
        <div className="panel">
          <div className="fields">
            <label className="field">
              <span>{l("Gudang *", "Warehouse *")}</span>
              <select
                value={form.warehouseId}
                onChange={(e) => setForm({ ...form, warehouseId: e.target.value, locationId: "" })}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
              {errors.warehouseId && <small className="error">{errors.warehouseId}</small>}
            </label>
            <label className="field">
              <span>{l("Lokasi", "Location")}</span>
              <select
                value={form.locationId}
                onChange={(e) => setForm({ ...form, locationId: e.target.value })}
              >
                <option value="">{l("Seluruh stok gudang", "Whole warehouse stock")}</option>
                {locations
                  .filter((x) => x.usage === "internal" && x.warehouseId === form.warehouseId)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.completeName}
                    </option>
                  ))}
              </select>
              {errors.locationId && <small className="error">{errors.locationId}</small>}
            </label>
            <label className="field">
              <span>{l("Kategori (cycle count)", "Category (cycle count)")}</span>
              <select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                <option value="">{l("Semua produk (opname penuh)", "All products (full count)")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Tanggal *", "Date *")}</span>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </label>
          </div>
          <div className="toolbar">
            <button className="primary" onClick={create}>
              {l("Buat sesi", "Create session")}
            </button>
            <button onClick={() => setForm(null)}>{l("Batal", "Cancel")}</button>
          </div>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Nomor", "Number")}</th>
              <th>{l("Tanggal", "Date")}</th>
              <th>{l("Gudang / lokasi", "Warehouse / location")}</th>
              <th className="num">{l("Dihitung", "Counted")}</th>
              <th className="num">{l("Berselisih", "Variances")}</th>
              <th className="num">{l("Selisih bersih", "Net variance")}</th>
              <th>{l("Status", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {l("Belum ada sesi stock opname.", "No count sessions yet.")}
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/inventory/counts/${r.id}`}>{r.name}</Link>
                </td>
                <td>{formatDate(r.date, locale)}</td>
                <td>{r.locationName}</td>
                <td className="num">
                  {r.summary.counted}/{r.summary.lines}
                </td>
                <td className="num">{r.summary.withVariance}</td>
                <td className={`num${Number(r.summary.netValue) < 0 ? " overdue" : ""}`}>
                  {money(r.summary.netValue, locale)}
                </td>
                <td>
                  <span className={`pill ${countPill(r.state)}`}>
                    {l(...(COUNT_STATE[r.state] ?? [r.state, r.state]))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
