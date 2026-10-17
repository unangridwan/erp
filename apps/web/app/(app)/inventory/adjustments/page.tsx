"use client";

import { useEffect, useState } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { api, ApiError } from "../../../../lib/api";
import { money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Quant {
  productId: string;
  sku: string;
  productName: string;
  lotId: string | null;
  lotName: string | null;
  quantity: string;
}
interface Row {
  productId: string;
  label: string;
  lotId: string;
  lotName: string;
  system: string;
  counted: string;
}

/** Stock opname: hitung fisik per lokasi; selisih dibukukan ke akun Selisih Persediaan. */
export default function AdjustmentsPage() {
  const { l, locale } = useI18n();
  const locations = useOptions<{ id: string; completeName: string }>("/stock-locations?usage=internal");
  const products = useOptions<{ id: string; sku: string; name: string; productType: string }>("/products");
  const [locationId, setLocationId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!locationId && locations[0]) setLocationId(locations[0].id);
  }, [locations, locationId]);

  useEffect(() => {
    if (!locationId) return;
    api<Quant[]>(`/stock/quants?locationId=${locationId}`)
      .then((qs) =>
        setRows(
          qs.map((q) => ({
            productId: q.productId,
            label: `${q.sku} ${q.productName}`,
            lotId: q.lotId ?? "",
            lotName: q.lotName ?? "",
            system: q.quantity,
            counted: String(Number(q.quantity)),
          })),
        ),
      )
      .catch((e: Error) => setError(e.message));
  }, [locationId, version]);

  const changed = rows.filter((r) => r.counted !== "" && Number(r.counted) !== Number(r.system));

  async function apply() {
    setError(null);
    setMessage(null);
    setFieldErrors({});
    try {
      const res = await api<{ moves: number }>("/stock/adjustments", {
        method: "POST",
        body: {
          locationId,
          date,
          reason: reason || null,
          lines: changed.map((r) => ({
            productId: r.productId,
            lotId: r.lotId || undefined,
            lotName: r.lotId ? undefined : r.lotName || undefined,
            countedQty: r.counted,
          })),
        },
      });
      setMessage(l(`${res.moves} penyesuaian dibukukan.`, `${res.moves} adjustment(s) posted.`));
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
    }
  }

  return (
    <>
      <header className="toolbar">
        <h1>{l("Stock Opname", "Physical Inventory")}</h1>
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          {locations.map((x) => (
            <option key={x.id} value={x.id}>
              {x.completeName}
            </option>
          ))}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input
          placeholder={l("Alasan (mis. opname Q3)", "Reason (e.g. Q3 count)")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button type="button" className="primary" disabled={!changed.length} onClick={apply}>
          {l(`Bukukan ${changed.length} selisih`, `Apply ${changed.length} difference(s)`)}
        </button>
      </header>
      {error && <p className="error">{error}</p>}
      {message && <p className="notice">{message}</p>}
      <div className="table-wrap">
        <table className="lines">
          <thead>
            <tr>
              <th>{l("Produk", "Product")}</th>
              <th>{l("Lot / serial", "Lot / serial")}</th>
              <th className="num">{l("Sistem", "System")}</th>
              <th className="num">{l("Hitung fisik", "Counted")}</th>
              <th className="num">{l("Selisih", "Difference")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const diff = r.counted === "" ? 0 : Number(r.counted) - Number(r.system);
              return (
                <tr key={i}>
                  <td>
                    {r.label || (
                      <select
                        value={r.productId}
                        onChange={(e) =>
                          setRows((rs) =>
                            rs.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)),
                          )
                        }
                      >
                        <option value="">—</option>
                        {products
                          .filter((p) => p.productType !== "service")
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.sku} {p.name}
                            </option>
                          ))}
                      </select>
                    )}
                    {fieldErrors[`lines.${changed.indexOf(r)}.productId`] && (
                      <small className="error">{fieldErrors[`lines.${changed.indexOf(r)}.productId`]}</small>
                    )}
                  </td>
                  <td>
                    {r.label ? (
                      r.lotName
                    ) : (
                      <input
                        value={r.lotName}
                        onChange={(e) =>
                          setRows((rs) => rs.map((x, j) => (j === i ? { ...x, lotName: e.target.value } : x)))
                        }
                      />
                    )}
                  </td>
                  <td className="num">{money(r.system, locale, 4)}</td>
                  <td>
                    <input
                      className="num short"
                      inputMode="decimal"
                      value={r.counted}
                      onChange={(e) =>
                        setRows((rs) => rs.map((x, j) => (j === i ? { ...x, counted: e.target.value } : x)))
                      }
                    />
                  </td>
                  <td className={`num${diff < 0 ? " overdue" : ""}`}>{diff ? money(diff, locale, 4) : ""}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    setRows((rs) => [
                      ...rs,
                      { productId: "", label: "", lotId: "", lotName: "", system: "0", counted: "" },
                    ])
                  }
                >
                  + {l("Tambah produk yang belum ada di lokasi", "Add a product not yet in this location")}
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
