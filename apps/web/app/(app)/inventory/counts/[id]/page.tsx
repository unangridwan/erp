"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useOptions, type ProductOption } from "../../../../../components/accounting/use-options";
import { download } from "../../../../../components/accounting/download";
import { ask, toast } from "../../../../../components/feedback";
import { COUNT_STATE, countPill } from "../../../../../components/inventory/count-state";
import { ScanBox } from "../../../../../components/inventory/scan-box";
import { useMe } from "../../../../../components/me-context";
import { api, ApiError } from "../../../../../lib/api";
import { formatDate, money } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";

interface Line {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  tracking: string;
  locationId: string;
  locationName: string;
  lotName: string | null;
  newLot: boolean;
  systemQty: string;
  countedQty: string | null;
  unitCost: string;
  varianceQty: string;
  varianceValue: string;
}
interface Count {
  id: string;
  name: string;
  date: string;
  state: string;
  warehouseName: string;
  locationName: string;
  categoryName: string | null;
  approval: { id: string; number: string | null; state: string } | null;
  summary: {
    lines: number;
    counted: number;
    uncounted: number;
    withVariance: number;
    gainValue: string;
    lossValue: string;
    netValue: string;
    absValue: string;
  };
  lines: Line[];
}

const n = (v: string | null) => (v == null ? "" : String(Number(v)));

function CountForm() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const { l, locale } = useI18n();
  const [doc, setDoc] = useState<Count | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "uncounted" | "variance">("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState<{ productId: string; lotName: string; countedQty: string } | null>(null);
  const products = useOptions<ProductOption & { productType?: string; tracking?: string }>("/products");
  const write = can(me.permissions, "inventory.write");
  const manage = can(me.permissions, "inventory.manage");
  const counting = doc?.state === "counting";

  const load = useCallback(() => {
    api<Count>(`/stock-counts/${id}`)
      .then((c) => {
        setDoc(c);
        setEdits({});
      })
      .catch((e: Error) => toast.error(e.message));
  }, [id]);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const dirty = Object.keys(edits).length > 0;
  const saveEdits = async () => {
    if (!dirty) return;
    const lines = Object.entries(edits).map(([lineId, v]) => ({
      id: lineId,
      countedQty: v === "" ? null : v,
    }));
    setDoc(await api<Count>(`/stock-counts/${id}/lines`, { method: "PUT", body: { lines } }));
    setEdits({});
  };
  const action = (path: string, message: string | null, done: string, body?: object) =>
    run(async () => {
      if (message && !(await ask({ message, danger: path === "cancel" }))) return;
      await saveEdits();
      setDoc(await api<Count>(`/stock-counts/${id}/${path}`, { method: "POST", body: body ?? {} }));
      toast.success(done);
    });
  const submit = () =>
    run(async () => {
      await saveEdits();
      const current = await api<Count>(`/stock-counts/${id}`);
      let uncountedAsZero = false;
      if (current.summary.uncounted > 0) {
        uncountedAsZero = await ask({
          message: l(
            `${current.summary.uncounted} baris belum dihitung. Anggap jumlahnya 0 (barang tidak ditemukan) dan ajukan?`,
            `${current.summary.uncounted} lines are uncounted. Treat them as 0 (not found) and submit?`,
          ),
          danger: true,
        });
        if (!uncountedAsZero) return;
      }
      const res = await api<Count>(`/stock-counts/${id}/submit`, {
        method: "POST",
        body: { uncountedAsZero },
      });
      setDoc(res);
      toast.success(
        res.state === "approved"
          ? l("Tidak ada selisih; siap diposting", "No variances; ready to post")
          : l("Selisih diajukan untuk persetujuan", "Variances submitted for approval"),
      );
    });
  const scan = async (code: string) => {
    const res = await api<{
      product: { sku: string; name: string };
      lot: { name: string } | null;
      countedQty: string;
    }>(`/stock-counts/${id}/scan`, { method: "POST", body: { code } }).catch((e: unknown) => {
      throw e instanceof ApiError ? new Error(Object.values(e.fieldErrors)[0] ?? e.message) : e;
    });
    load();
    return `${res.product.sku} ${res.product.name}${res.lot ? ` · ${res.lot.name}` : ""}: ${n(res.countedQty)}`;
  };
  const importFile = (file: File) =>
    run(async () => {
      const buf = await file.arrayBuffer();
      const isXlsx = file.name.toLowerCase().endsWith(".xlsx");
      const body = isXlsx
        ? { xlsx: btoa(String.fromCharCode(...new Uint8Array(buf))) }
        : { csv: new TextDecoder().decode(buf) };
      const res = await api<{ updated: number; errors: { row: number; message: string }[]; count: Count }>(
        `/stock-counts/${id}/import`,
        { method: "POST", body },
      );
      setDoc(res.count);
      setEdits({});
      if (res.errors.length)
        toast.error(
          l(
            `${res.updated} baris diperbarui, ${res.errors.length} gagal: `,
            `${res.updated} lines updated, ${res.errors.length} failed: `,
          ) +
            res.errors
              .slice(0, 3)
              .map((e) => `#${e.row} ${e.message}`)
              .join("; "),
        );
      else toast.success(l(`${res.updated} baris diperbarui`, `${res.updated} lines updated`));
    });
  const addLine = () =>
    run(async () => {
      if (!add) return;
      await api(`/stock-counts/${id}/lines`, {
        method: "POST",
        body: { productId: add.productId, lotName: add.lotName || null, countedQty: add.countedQty || "0" },
      });
      setAdd(null);
      load();
    });

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (doc?.lines ?? []).filter((x) => {
      const counted = edits[x.id] !== undefined ? edits[x.id] !== "" : x.countedQty != null;
      if (filter === "uncounted" && counted) return false;
      if (filter === "variance" && Number(x.varianceQty) === 0) return false;
      if (!term) return true;
      return `${x.sku} ${x.productName} ${x.lotName ?? ""} ${x.locationName}`.toLowerCase().includes(term);
    });
  }, [doc, edits, filter, q]);

  if (!doc) return <p className="muted">{l("Memuat…", "Loading…")}</p>;
  const m = (v: string) => money(v, locale);

  return (
    <div className="stack-wide">
      <header className="toolbar">
        <h1>
          <Link href="/inventory/counts">{l("Stock Opname", "Physical Inventory")}</Link> / {doc.name}
        </h1>
        <span className={`pill ${countPill(doc.state)}`}>
          {l(...(COUNT_STATE[doc.state] ?? [doc.state, doc.state]))}
        </span>
        {manage && doc.state === "draft" && (
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              action(
                "start",
                l(
                  "Mulai hitung? Stok sistem saat ini akan dijadikan pembanding.",
                  "Start counting? Current system stock becomes the baseline.",
                ),
                l("Hitung dimulai", "Counting started"),
              )
            }
          >
            {l("Mulai hitung", "Start counting")}
          </button>
        )}
        {write && counting && dirty && (
          <button className="primary" disabled={busy} aria-busy={busy} onClick={() => run(saveEdits)}>
            {l("Simpan hitungan", "Save counts")}
          </button>
        )}
        {manage && counting && (
          <button className={dirty ? "" : "primary"} disabled={busy} onClick={submit}>
            {l("Ajukan selisih", "Submit variances")}
          </button>
        )}
        {manage && doc.state === "approved" && (
          <>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                action(
                  "post",
                  l(
                    "Posting penyesuaian stok sesuai hasil hitung?",
                    "Post stock adjustments from the counts?",
                  ),
                  l("Penyesuaian diposting", "Adjustments posted"),
                )
              }
            >
              {l("Posting penyesuaian", "Post adjustments")}
            </button>
            <button
              disabled={busy}
              onClick={() => action("recount", null, l("Kembali ke hitung", "Back to counting"))}
            >
              {l("Hitung ulang", "Recount")}
            </button>
          </>
        )}
        {(doc.state === "counting" || doc.state === "approved" || doc.state === "done") && (
          <button
            disabled={busy}
            onClick={() =>
              run(() => download(`/stock-counts/${id}/sheet`, `${doc.name.replaceAll("/", "-")}.xlsx`))
            }
          >
            {l("Unduh lembar hitung", "Download count sheet")}
          </button>
        )}
        {manage && ["draft", "counting", "in_approval", "approved"].includes(doc.state) && (
          <button
            disabled={busy}
            onClick={() =>
              action(
                "cancel",
                l("Batalkan sesi opname ini?", "Cancel this count session?"),
                l("Dibatalkan", "Cancelled"),
              )
            }
          >
            {l("Batalkan", "Cancel")}
          </button>
        )}
      </header>

      <p className="muted">
        {doc.locationName} · {formatDate(doc.date, locale)}
        {doc.categoryName && ` · ${l("cycle count", "cycle count")}: ${doc.categoryName}`}
        {doc.approval && (
          <>
            {" · "}
            {l("Persetujuan", "Approval")}:{" "}
            <Link href={`/hr/approval-requests/${doc.approval.id}`}>{doc.approval.number ?? "—"}</Link>
          </>
        )}
      </p>

      {doc.state !== "draft" && (
        <div className="cards">
          <div className="card">
            <small className="muted">{l("Dihitung", "Counted")}</small>
            <strong>
              {doc.summary.counted}/{doc.summary.lines}
            </strong>
          </div>
          <div className="card">
            <small className="muted">{l("Baris berselisih", "Lines with variance")}</small>
            <strong>{doc.summary.withVariance}</strong>
          </div>
          <div className="card">
            <small className="muted">{l("Lebih / kurang", "Gain / loss")}</small>
            <strong>
              +{m(doc.summary.gainValue)} / −{m(doc.summary.lossValue)}
            </strong>
          </div>
          <div className="card">
            <small className="muted">{l("Selisih bersih", "Net variance")}</small>
            <strong className={Number(doc.summary.netValue) < 0 ? "overdue" : ""}>
              {m(doc.summary.netValue)}
            </strong>
          </div>
        </div>
      )}

      {doc.state === "draft" && (
        <p className="notice">
          {l(
            "Klik Mulai hitung saat gudang siap dihitung. Stok sistem pada saat itu menjadi pembanding selisih.",
            "Click Start counting when the warehouse is ready. System stock at that moment becomes the variance baseline.",
          )}
        </p>
      )}

      {write && counting && (
        <div className="panel">
          <div className="toolbar">
            <ScanBox onScan={scan} label={l("Scan barcode / SKU / serial", "Scan barcode / SKU / serial")} />
            <label className="button">
              {l("Impor hasil (Excel/CSV)", "Import counts (Excel/CSV)")}
              <input
                type="file"
                accept=".xlsx,.csv"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) importFile(file);
                }}
              />
            </label>
            {!add && (
              <button onClick={() => setAdd({ productId: "", lotName: "", countedQty: "" })}>
                {l("Tambah temuan", "Add found item")}
              </button>
            )}
          </div>
          {add && (
            <div className="fields">
              <label className="field">
                <span>{l("Produk", "Product")}</span>
                <select value={add.productId} onChange={(e) => setAdd({ ...add, productId: e.target.value })}>
                  <option value="">—</option>
                  {products
                    .filter((p) => !p.isVariantTemplate && (p.productType ?? "storable") === "storable")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>{l("Lot / serial", "Lot / serial")}</span>
                <input value={add.lotName} onChange={(e) => setAdd({ ...add, lotName: e.target.value })} />
              </label>
              <label className="field">
                <span>{l("Jumlah", "Quantity")}</span>
                <input
                  inputMode="decimal"
                  value={add.countedQty}
                  onChange={(e) => setAdd({ ...add, countedQty: e.target.value })}
                />
              </label>
              <div className="toolbar">
                <button className="primary" disabled={busy || !add.productId} onClick={addLine}>
                  {l("Tambah", "Add")}
                </button>
                <button onClick={() => setAdd(null)}>{l("Batal", "Cancel")}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {doc.state !== "draft" && (
        <>
          <div className="toolbar">
            <input
              type="search"
              placeholder={l("Cari produk, lot, lokasi…", "Search product, lot, location…")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={l("Cari", "Search")}
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              aria-label={l("Tampilkan", "Show")}
            >
              <option value="all">{l("Semua baris", "All lines")}</option>
              <option value="uncounted">{l("Belum dihitung", "Uncounted")}</option>
              <option value="variance">{l("Berselisih", "With variance")}</option>
            </select>
            <small className="muted">
              {shown.length}/{doc.lines.length}
            </small>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Lokasi", "Location")}</th>
                  <th>{l("Produk", "Product")}</th>
                  <th>{l("Lot / serial", "Lot / serial")}</th>
                  <th className="num">{l("Sistem", "System")}</th>
                  <th className="num">{l("Hitung", "Counted")}</th>
                  <th className="num">{l("Selisih", "Variance")}</th>
                  <th className="num">{l("Nilai selisih", "Variance value")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      {l("Tidak ada baris.", "No lines.")}
                    </td>
                  </tr>
                )}
                {shown.map((x) => (
                  <tr key={x.id}>
                    <td>{x.locationName}</td>
                    <td>
                      {x.sku} {x.productName}
                    </td>
                    <td>
                      {x.lotName ?? "—"}
                      {x.newLot && <small className="badge">{l("baru", "new")}</small>}
                    </td>
                    <td className="num">{money(x.systemQty, locale, 4)}</td>
                    <td className="num">
                      {write && counting ? (
                        <input
                          className="num short"
                          inputMode="decimal"
                          aria-label={l(`Hitung ${x.sku}`, `Count ${x.sku}`)}
                          value={edits[x.id] ?? n(x.countedQty)}
                          placeholder="—"
                          onChange={(e) => setEdits({ ...edits, [x.id]: e.target.value })}
                        />
                      ) : x.countedQty == null ? (
                        "—"
                      ) : (
                        money(x.countedQty, locale, 4)
                      )}
                    </td>
                    <td className={`num${Number(x.varianceQty) < 0 ? " overdue" : ""}`}>
                      {Number(x.varianceQty) === 0 ? "" : money(x.varianceQty, locale, 4)}
                    </td>
                    <td className={`num${Number(x.varianceValue) < 0 ? " overdue" : ""}`}>
                      {Number(x.varianceValue) === 0 ? "" : m(x.varianceValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function StockCountPage() {
  return (
    <Suspense>
      <CountForm />
    </Suspense>
  );
}
