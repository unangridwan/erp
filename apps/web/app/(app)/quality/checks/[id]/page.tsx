"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { DECISION_LABEL } from "@erp/shared";
import { useCallback, useEffect, useState } from "react";
import { ask, toast } from "../../../../../components/feedback";
import { useMe } from "../../../../../components/me-context";
import { QualityBadge } from "../../../../../components/quality/quality-ui";
import { api, ApiError, apiRaw } from "../../../../../lib/api";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";
import { RelatedDocuments } from "../../../../../components/related-documents";
import { LoadFailed, useLoadError } from "../../../../../components/load-failed";

interface Result {
  label: string;
  kind: "pass_fail" | "measure";
  min?: number | null;
  max?: number | null;
  unit?: string | null;
  photo?: boolean;
  value: string | null;
  passed: boolean | null;
  note?: string | null;
}
interface Detail {
  id: string;
  name: string;
  trigger: string;
  state: string;
  decision: string | null;
  note: string | null;
  quantity: string;
  sampleQty: string;
  product: { name: string; sku: string } | null;
  partner: string | null;
  picking: string | null;
  pickingId: string | null;
  productionOrder: string | null;
  productionOrderId: string | null;
  point: { name: string; instructions: string | null } | null;
  lots: { lotId: string; quantity: string; name: string | null }[];
  location: string | null;
  destLocation: string | null;
  results: Result[];
  photos: { id: string; itemIndex: number | null; fileName: string }[];
  alerts: { id: string; name: string; state: string }[];
  evaluation: { complete: boolean; passed: boolean };
  returnPickingId: string | null;
  scrapMoveId: string | null;
}

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/** Detail pemeriksaan: isi hasil per butir (lulus/gagal atau ukur), foto, lalu putuskan. */
export default function QualityCheckPage() {
  const { id } = useParams<{ id: string }>();
  const { l, locale } = useI18n();
  const [loadError, failLoad] = useLoadError();
  const me = useMe();
  const i = locale === "id" ? 0 : 1;
  const [d, setD] = useState<Detail | null>(null);
  const [values, setValues] = useState<{ value: string; note: string }[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  const fill = useCallback((x: Detail) => {
    setD(x);
    setValues(x.results.map((r) => ({ value: r.value ?? "", note: r.note ?? "" })));
    setNote(x.note ?? "");
  }, []);
  const load = useCallback(() => {
    api<Detail>(`/quality-checks/${id}`).then(fill, failLoad);
  }, [id, fill]);
  useEffect(load, [load]);

  // Foto dimuat lewat API (butuh token), lalu ditampilkan sebagai object URL.
  useEffect(() => {
    if (!d) return;
    let alive = true;
    const urls: Record<string, string> = {};
    void Promise.all(
      d.photos.map(async (p) => {
        try {
          const res = await apiRaw(`/quality-checks/${id}/photos/${p.id}`);
          if (res.ok) urls[p.id] = URL.createObjectURL(await res.blob());
        } catch {
          /* abaikan */
        }
      }),
    ).then(() => alive && setPhotoUrls(urls));
    return () => {
      alive = false;
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    };
  }, [d, id]);

  if (!d)
    return loadError ? (
      <LoadFailed message={loadError} />
    ) : (
      <p className="muted">{l("Memuat…", "Loading…")}</p>
    );
  const editable = d.state === "pending" && can(me.permissions, "quality.write");

  async function run<T>(fn: () => Promise<T>, ok?: string) {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast.success(ok);
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) console.warn(e.fieldErrors);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const save = async () => {
    const r = await run(
      () =>
        api<Detail>(`/quality-checks/${id}/results`, {
          method: "PUT",
          body: {
            results: values.map((v) => ({ value: v.value || null, note: v.note || null })),
            note: note || null,
          },
        }),
      l("Hasil disimpan.", "Results saved."),
    );
    if (r) fill(r);
    return r;
  };

  async function upload(itemIndex: number, file: File) {
    const r = await run(
      async () =>
        api(`/quality-checks/${id}/photos`, {
          method: "POST",
          body: {
            itemIndex,
            fileName: file.name,
            contentType: file.type,
            data: await toBase64(file),
          },
        }),
      l("Foto diunggah.", "Photo uploaded."),
    );
    // Perbarui daftar foto & evaluasi tanpa menimpa isian yang belum disimpan.
    if (r) api<Detail>(`/quality-checks/${id}`).then(setD, () => undefined);
  }

  async function decide(decision: string) {
    const ok = await ask({
      title: DECISION_LABEL[decision]?.[i] ?? decision,
      message:
        decision === "accept" || decision === "conditional"
          ? l("Barang dipindahkan dari karantina ke gudang.", "Goods move from quarantine to stock.")
          : decision === "return"
            ? l(
                "Barang dikembalikan ke pemasok (transfer retur divalidasi) dan NCR dibuat.",
                "Goods are returned to the supplier (return transfer validated) and an NCR is created.",
              )
            : l(
                "Barang dibuang dan nilainya dibebankan ke selisih persediaan; NCR dibuat.",
                "Goods are scrapped and expensed to stock adjustment; an NCR is created.",
              ),
      confirmLabel: DECISION_LABEL[decision]?.[i] ?? decision,
      danger: decision === "scrap" || decision === "return",
    });
    if (!ok) return;
    if (!(await save())) return;
    const r = await run(
      () =>
        api<Detail>(`/quality-checks/${id}/decide`, {
          method: "POST",
          body: { decision, note: note || null },
        }),
      l("Keputusan disimpan.", "Decision saved."),
    );
    if (r) fill(r);
  }

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <nav className="breadcrumb">
            <Link href="/quality/checks">{l("Pemeriksaan Mutu", "Quality Checks")}</Link> / {d.name}
          </nav>
          <QualityBadge state={d.state} />
        </div>
        <div className="cp-right">
          {editable && (
            <button type="button" onClick={() => void save()} disabled={busy}>
              {l("Simpan hasil", "Save results")}
            </button>
          )}
        </div>
      </header>

      <section className="panel">
        <dl className="facts">
          <dt>{l("Produk", "Product")}</dt>
          <dd>
            {d.product?.sku} — {d.product?.name}
          </dd>
          <dt>{l("Jumlah ditahan", "Quantity held")}</dt>
          <dd>
            {Number(d.quantity)} ({l("sampel", "sample")} {Number(d.sampleQty)})
          </dd>
          {d.lots.length > 0 && (
            <>
              <dt>{l("Lot/serial", "Lot/serial")}</dt>
              <dd>{d.lots.map((x) => `${x.name} (${Number(x.quantity)})`).join(", ")}</dd>
            </>
          )}
          {d.partner && (
            <>
              <dt>{l("Pemasok", "Supplier")}</dt>
              <dd>{d.partner}</dd>
            </>
          )}
          <dt>{l("Dokumen asal", "Source document")}</dt>
          <dd>
            {d.pickingId ? (
              <Link href={`/inventory/pickings/${d.pickingId}`}>{d.picking}</Link>
            ) : d.productionOrderId ? (
              <Link href={`/manufacturing/orders/${d.productionOrderId}`}>{d.productionOrder}</Link>
            ) : (
              "—"
            )}
          </dd>
          <dt>{l("Lokasi", "Location")}</dt>
          <dd>
            {d.location} → {d.destLocation}
          </dd>
          {d.point && (
            <>
              <dt>{l("Titik kontrol", "Control point")}</dt>
              <dd>{d.point.name}</dd>
            </>
          )}
        </dl>
        {d.point?.instructions && <p className="muted">{d.point.instructions}</p>}
      </section>

      <section className="panel">
        <h2>{l("Hasil pemeriksaan", "Check results")}</h2>
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th>{l("Butir", "Item")}</th>
                <th>{l("Standar", "Standard")}</th>
                <th>{l("Hasil", "Result")}</th>
                <th>{l("Catatan", "Note")}</th>
                <th>{l("Foto", "Photo")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.results.map((r, idx) => (
                <tr key={idx}>
                  <td>{r.label}</td>
                  <td className="muted">
                    {r.kind === "measure"
                      ? `${r.min ?? "…"} – ${r.max ?? "…"} ${r.unit ?? ""}`
                      : l("Lulus/gagal", "Pass/fail")}
                    {r.photo && ` · ${l("wajib foto", "photo required")}`}
                  </td>
                  <td>
                    {r.kind === "pass_fail" ? (
                      <select
                        aria-label={r.label}
                        value={values[idx]?.value ?? ""}
                        disabled={!editable}
                        onChange={(e) =>
                          setValues(values.map((v, j) => (j === idx ? { ...v, value: e.target.value } : v)))
                        }
                      >
                        <option value="">—</option>
                        <option value="pass">{l("Lulus", "Pass")}</option>
                        <option value="fail">{l("Gagal", "Fail")}</option>
                      </select>
                    ) : (
                      <input
                        aria-label={r.label}
                        inputMode="decimal"
                        className="num short"
                        value={values[idx]?.value ?? ""}
                        disabled={!editable}
                        onChange={(e) =>
                          setValues(values.map((v, j) => (j === idx ? { ...v, value: e.target.value } : v)))
                        }
                      />
                    )}
                  </td>
                  <td>
                    <input
                      aria-label={l("Catatan", "Note")}
                      value={values[idx]?.note ?? ""}
                      disabled={!editable}
                      maxLength={500}
                      onChange={(e) =>
                        setValues(values.map((v, j) => (j === idx ? { ...v, note: e.target.value } : v)))
                      }
                    />
                  </td>
                  <td>
                    {d.photos
                      .filter((p) => p.itemIndex === idx)
                      .map((p) =>
                        photoUrls[p.id] ? (
                          <img key={p.id} src={photoUrls[p.id]} alt={p.fileName} className="qc-photo" />
                        ) : (
                          <span key={p.id} className="muted">
                            {p.fileName}
                          </span>
                        ),
                      )}
                    {editable && (
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        aria-label={l("Unggah foto", "Upload photo")}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void upload(idx, f);
                          e.target.value = "";
                        }}
                      />
                    )}
                  </td>
                  <td>
                    {r.passed === true && <span className="badge success">✓</span>}
                    {r.passed === false && <span className="badge danger">✗</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="field wide">
          <span>{l("Catatan pemeriksa", "Inspector note")}</span>
          <textarea rows={2} value={note} disabled={!editable} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p>
          {d.evaluation.complete
            ? d.evaluation.passed
              ? l("Semua butir lulus.", "All items pass.")
              : l("Ada butir yang tidak lulus.", "Some items fail.")
            : l("Belum semua butir diisi.", "Not all items are filled in.")}
        </p>
        {editable && (
          <div className="automation-row">
            <button type="button" className="primary" onClick={() => void decide("accept")} disabled={busy}>
              {DECISION_LABEL.accept![i]}
            </button>
            <button type="button" onClick={() => void decide("conditional")} disabled={busy}>
              {DECISION_LABEL.conditional![i]}
            </button>
            {d.trigger === "receipt" && (
              <button type="button" className="danger" onClick={() => void decide("return")} disabled={busy}>
                {DECISION_LABEL.return![i]}
              </button>
            )}
            <button type="button" className="danger" onClick={() => void decide("scrap")} disabled={busy}>
              {DECISION_LABEL.scrap![i]}
            </button>
          </div>
        )}
        {d.decision && (
          <p>
            {l("Keputusan", "Decision")}: <strong>{DECISION_LABEL[d.decision]?.[i]}</strong>
            {d.returnPickingId && (
              <>
                {" · "}
                <Link href={`/inventory/pickings/${d.returnPickingId}`}>
                  {l("Transfer retur", "Return transfer")}
                </Link>
              </>
            )}
            {d.scrapMoveId && (
              <>
                {" · "}
                <Link href={`/accounting/moves/${d.scrapMoveId}`}>{l("Jurnal scrap", "Scrap entry")}</Link>
              </>
            )}
          </p>
        )}
        {d.alerts.length > 0 && (
          <p>
            NCR:{" "}
            {d.alerts.map((a) => (
              <Link key={a.id} href={`/quality/alerts/${a.id}`}>
                {a.name}
              </Link>
            ))}
          </p>
        )}
      </section>
      {id && id !== "new" && <RelatedDocuments model="quality_check" id={id} />}
    </>
  );
}
