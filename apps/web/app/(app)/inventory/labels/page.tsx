"use client";

import { useMemo, useState } from "react";
import { useOptions, type ProductOption } from "../../../../components/accounting/use-options";
import { toast } from "../../../../components/feedback";
import { openPdf } from "../../../../components/hr/contract-document";
import { useI18n } from "../../../../lib/i18n";

interface Lot {
  id: string;
  name: string;
  sku: string;
  productName: string;
  onHand: string;
}

/** Cetak label barcode Code 128 (A4, 3 × 8) untuk produk (barcode/SKU) dan nomor lot/serial. */
export default function BarcodeLabelsPage() {
  const { l } = useI18n();
  const products = useOptions<ProductOption & { barcode?: string | null }>("/products").filter(
    (p) => !p.isVariantTemplate,
  );
  const lots = useOptions<Lot>("/stock/lots?available=true");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<{ products: string[]; lots: string[] }>({ products: [], lots: [] });
  const [copies, setCopies] = useState("1");
  const term = q.trim().toLowerCase();
  const shownProducts = useMemo(
    () =>
      products.filter((p) => !term || `${p.sku} ${p.name} ${p.barcode ?? ""}`.toLowerCase().includes(term)),
    [products, term],
  );
  const shownLots = useMemo(
    () => lots.filter((x) => !term || `${x.name} ${x.sku} ${x.productName}`.toLowerCase().includes(term)),
    [lots, term],
  );
  const toggle = (kind: "products" | "lots", id: string) =>
    setPicked((p) => ({
      ...p,
      [kind]: p[kind].includes(id) ? p[kind].filter((x) => x !== id) : [...p[kind], id],
    }));
  const total = (picked.products.length + picked.lots.length) * (Number(copies) || 1);
  const print = () =>
    openPdf(
      `/barcode/labels?productIds=${picked.products.join(",")}&lotIds=${picked.lots.join(",")}&copies=${Number(copies) || 1}`,
      "label-barcode.pdf",
    ).catch((e: Error) => toast.error(e.message));

  return (
    <div className="stack-wide">
      <header className="toolbar">
        <h1>{l("Label Barcode", "Barcode Labels")}</h1>
        <label className="field inline">
          <span>{l("Salinan", "Copies")}</span>
          <input
            className="num short"
            inputMode="numeric"
            value={copies}
            onChange={(e) => setCopies(e.target.value)}
          />
        </label>
        <button className="primary" disabled={!total} onClick={print}>
          {l(`Cetak ${total} label`, `Print ${total} labels`)}
        </button>
      </header>
      <p className="muted">
        {l(
          "Label produk memakai barcode produk (atau SKU bila kosong); label lot/serial memakai nomor lot. Barcode Code 128 bisa dibaca pemindai biasa dan dipakai di scan transfer & stock opname.",
          "Product labels use the product barcode (or SKU if empty); lot/serial labels use the lot number. Code 128 barcodes work with standard scanners and in transfer & stock count scanning.",
        )}
      </p>
      <input
        type="search"
        placeholder={l("Cari produk, SKU, lot…", "Search product, SKU, lot…")}
        aria-label={l("Cari", "Search")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="grid-2">
        <div className="panel">
          <h2>{l("Produk", "Products")}</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {shownProducts.slice(0, 200).map((p) => (
                  <tr key={p.id}>
                    <td>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={picked.products.includes(p.id)}
                          onChange={() => toggle("products", p.id)}
                        />{" "}
                        {p.sku} {p.name}
                      </label>
                    </td>
                    <td>
                      <small className="muted">{p.barcode || p.sku}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <h2>{l("Lot / serial tersedia", "Available lots / serials")}</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {shownLots.length === 0 && (
                  <tr>
                    <td className="muted">{l("Tidak ada lot tersedia.", "No available lots.")}</td>
                  </tr>
                )}
                {shownLots.slice(0, 200).map((x) => (
                  <tr key={x.id}>
                    <td>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={picked.lots.includes(x.id)}
                          onChange={() => toggle("lots", x.id)}
                        />{" "}
                        {x.name}
                      </label>
                    </td>
                    <td>
                      <small className="muted">
                        {x.sku} {x.productName}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
