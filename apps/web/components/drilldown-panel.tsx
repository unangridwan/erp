"use client";

import { recordHref, RECORD_MODELS, isRecordModel } from "@erp/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatDate, money } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { Modal } from "./feedback";

/** Permintaan rincian: endpoint drilldown + filter yang sama dengan angka yang diklik. */
export interface DrilldownRequest {
  title: string;
  /** Default `/reports/drilldown`. */
  path?: string;
  params: Record<string, string | number | boolean | undefined | null>;
  /** Kolom angka: debit/kredit (default) atau sisa (umur piutang/utang). */
  mode?: "debit-credit" | "residual";
}

interface Line {
  id: string;
  moveId: string;
  date: string;
  dueDate: string | null;
  moveName: string | null;
  ref: string | null;
  accountId: string;
  accountCode: string;
  accountName: string;
  partnerId: string | null;
  partner: string | null;
  label: string | null;
  debit: string;
  credit: string;
  balance: string;
  residual: string;
  source: { model: string; id: string | null; name: string | null } | null;
}
interface Result {
  lines: Line[];
  totals: { count: number; debit: string; credit: string; balance: string; residual: string };
}

const PAGE = 100;

/** Membangun query string tanpa nilai kosong. */
export const drillQuery = (params: DrilldownRequest["params"]) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  return q;
};

/**
 * Panel samping berisi item jurnal penyusun sebuah angka laporan. Tiap baris membuka entri jurnal & dokumen
 * sumbernya; laporan tetap di tempat.
 */
export function DrilldownPanel({
  request,
  onClose,
}: {
  request: DrilldownRequest | null;
  onClose: () => void;
}) {
  const { l, locale } = useI18n();
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const path = request?.path ?? "/reports/drilldown";
  const residual = request?.mode === "residual";

  useEffect(() => {
    setData(null);
    setError(null);
    if (!request) return;
    const q = drillQuery({ ...request.params, limit: PAGE, offset: 0 });
    api<Result>(`${path}?${q}`).then(setData, (e: Error) => setError(e.message));
  }, [request, path]);

  const more = async () => {
    if (!request || !data) return;
    setLoadingMore(true);
    try {
      const q = drillQuery({ ...request.params, limit: PAGE, offset: data.lines.length });
      const next = await api<Result>(`${path}?${q}`);
      setData({ ...data, lines: [...data.lines, ...next.lines] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const m = (v: string) => money(v, locale);
  // Satu akun dari laporan keuangan → tautan ke tab Buku Besar dengan filter yang sama.
  const p = request?.params ?? {};
  const ledgerHref =
    !request?.path && p.accountId && !p.openOnly
      ? `/accounting/reports?${drillQuery({
          tab: "general-ledger",
          accountId: p.accountId,
          dateFrom: p.basis === "range" ? p.dateFrom : undefined,
          dateTo: p.dateTo,
          companyIds: p.companyIds,
          branchId: p.branchId,
          businessUnitId: p.businessUnitId,
          costCenterId: p.costCenterId,
          profitCenterId: p.profitCenterId,
        })}`
      : null;
  const exportCsv = () => {
    if (!data) return;
    const head = residual
      ? ["date", "due_date", "entry", "source", "account", "partner", "label", "residual"]
      : ["date", "entry", "source", "account", "partner", "label", "debit", "credit"];
    const rows = data.lines.map((x) =>
      residual
        ? [
            x.date,
            x.dueDate ?? "",
            x.moveName ?? "",
            x.source?.name ?? "",
            x.accountCode,
            x.partner ?? "",
            x.label ?? "",
            x.residual,
          ]
        : [
            x.date,
            x.moveName ?? "",
            x.source?.name ?? "",
            x.accountCode,
            x.partner ?? "",
            x.label ?? "",
            x.debit,
            x.credit,
          ],
    );
    const csv = [head, ...rows]
      .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "drilldown.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const sourceLink = (s: Line["source"]) => {
    if (!s || !isRecordModel(s.model)) return null;
    const href = recordHref(s.model, s.id);
    const def = RECORD_MODELS[s.model];
    const text = s.name ?? l(...def.label);
    return href ? (
      <Link href={href} title={l(...def.label)}>
        {text}
      </Link>
    ) : (
      text
    );
  };

  return (
    <Modal open={!!request} title={request?.title ?? ""} onClose={onClose} side>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="muted">{l("Memuat…", "Loading…")}</p>}
      {data && (
        <>
          <div className="drill-summary">
            <span>
              {data.totals.count} {l("item jurnal", "journal items")}
            </span>
            {residual ? (
              <strong>{m(data.totals.residual)}</strong>
            ) : (
              <span>
                {l("Debit", "Debit")} <strong>{m(data.totals.debit)}</strong> · {l("Kredit", "Credit")}{" "}
                <strong>{m(data.totals.credit)}</strong> · {l("Saldo", "Balance")}{" "}
                <strong>{m(data.totals.balance)}</strong>
              </span>
            )}
            <span className="drill-actions">
              {ledgerHref && (
                <Link href={ledgerHref} onClick={onClose}>
                  {l("Buka di Buku Besar", "Open in General Ledger")}
                </Link>
              )}{" "}
              <button type="button" onClick={exportCsv} disabled={!data.lines.length}>
                CSV
              </button>
            </span>
          </div>
          <div className="table-scroll">
            <table className="drill-table">
              <thead>
                <tr>
                  <th>{l("Tanggal", "Date")}</th>
                  <th>{l("Entri", "Entry")}</th>
                  <th>{l("Dokumen sumber", "Source document")}</th>
                  <th>{l("Akun", "Account")}</th>
                  <th>{l("Partner", "Partner")}</th>
                  <th>{l("Keterangan", "Label")}</th>
                  {residual ? (
                    <>
                      <th>{l("Jatuh tempo", "Due")}</th>
                      <th className="num">{l("Sisa", "Residual")}</th>
                    </>
                  ) : (
                    <>
                      <th className="num">{l("Debit", "Debit")}</th>
                      <th className="num">{l("Kredit", "Credit")}</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.lines.map((x) => (
                  <tr key={x.id}>
                    <td>{formatDate(x.date, locale)}</td>
                    <td>
                      <Link href={`/accounting/moves/${x.moveId}`}>{x.moveName ?? "(draft)"}</Link>
                    </td>
                    <td>{sourceLink(x.source)}</td>
                    <td title={x.accountName}>{x.accountCode}</td>
                    <td>{x.partnerId ? <Link href={`/partners/${x.partnerId}`}>{x.partner}</Link> : null}</td>
                    <td>{x.label ?? x.ref}</td>
                    {residual ? (
                      <>
                        <td>{formatDate(x.dueDate ?? x.date, locale)}</td>
                        <td className="num">{m(x.residual)}</td>
                      </>
                    ) : (
                      <>
                        <td className="num">{Number(x.debit) ? m(x.debit) : ""}</td>
                        <td className="num">{Number(x.credit) ? m(x.credit) : ""}</td>
                      </>
                    )}
                  </tr>
                ))}
                {data.lines.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted">
                      {l("Tidak ada item.", "No items.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {data.lines.length < data.totals.count && (
            <button type="button" onClick={more} disabled={loadingMore}>
              {l("Muat lagi", "Load more")} ({data.lines.length}/{data.totals.count})
            </button>
          )}
        </>
      )}
    </Modal>
  );
}

/** Angka laporan yang bisa diklik untuk membuka drilldown. */
export function DrillAmount({
  value,
  onDrill,
  className,
}: {
  value: string;
  onDrill?: () => void;
  className?: string;
}) {
  if (!onDrill) return <span className={className}>{value}</span>;
  return (
    <button type="button" className={`link drill ${className ?? ""}`} onClick={onDrill}>
      {value}
    </button>
  );
}

/** Permintaan rincian baris dataset BI (`POST /reports/drill`). */
export interface DatasetDrillRequest {
  title: string;
  body: {
    reportId?: string;
    dataset?: string;
    config?: unknown;
    /** Nilai kelompok yang diklik (kolom `groupBy`) atau kunci tersembunyi `_xxxId`. */
    match: Record<string, string>;
    filters?: Record<string, string>;
  };
}
interface DrillResult {
  columns: { key: string; header: string; numeric?: boolean }[];
  rows: Record<string, unknown>[];
  total: number;
  totals: Record<string, number>;
}

/** Nilai kelompok baris hasil laporan (untuk `match`). */
export const groupMatch = (row: Record<string, unknown>, groupBy: string[]) =>
  Object.fromEntries(groupBy.map((k) => [k, String(row[k] ?? "")]));

/** Tautan dokumen sumber sebuah baris hasil laporan (`_model`/`_id`). */
export const rowHref = (row: Record<string, unknown>) =>
  typeof row._model === "string" && typeof row._id === "string" ? recordHref(row._model, row._id) : null;

/** Panel samping berisi baris data penyusun satu angka/kelompok laporan BI atau laporan modul. */
export function DatasetDrillPanel({
  request,
  onClose,
}: {
  request: DatasetDrillRequest | null;
  onClose: () => void;
}) {
  const { l, locale } = useI18n();
  const [data, setData] = useState<DrillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    setError(null);
    if (!request) return;
    api<DrillResult>("/reports/drill", { method: "POST", body: request.body }).then(setData, (e: Error) =>
      setError(e.message),
    );
  }, [request]);
  const fmt = (v: unknown, numeric?: boolean) =>
    v === null || v === undefined || v === ""
      ? ""
      : numeric && !Number.isNaN(Number(v))
        ? money(Number(v), locale)
        : String(v);
  return (
    <Modal open={!!request} title={request?.title ?? ""} onClose={onClose} side>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="muted">{l("Memuat…", "Loading…")}</p>}
      {data && (
        <>
          <div className="drill-summary">
            <span>
              {data.total} {l("baris data", "data rows")}
              {data.rows.length < data.total && ` · ${l("tampil", "showing")} ${data.rows.length}`}
            </span>
          </div>
          <div className="table-scroll">
            <table className="drill-table">
              <thead>
                <tr>
                  {data.columns.map((c) => (
                    <th key={c.key} className={c.numeric ? "num" : ""}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => {
                  const href = rowHref(r);
                  return (
                    <tr key={i}>
                      {data.columns.map((c, j) => (
                        <td key={c.key} className={c.numeric ? "num" : ""}>
                          {j === 0 && href ? (
                            <Link href={href}>{fmt(r[c.key], c.numeric) || "—"}</Link>
                          ) : (
                            fmt(r[c.key], c.numeric)
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={data.columns.length || 1} className="muted">
                      {l("Tidak ada data.", "No data.")}
                    </td>
                  </tr>
                )}
              </tbody>
              {Object.keys(data.totals).length > 0 && (
                <tfoot>
                  <tr>
                    {data.columns.map((c, i) => (
                      <th key={c.key} className={c.numeric ? "num" : ""}>
                        {c.key in data.totals
                          ? fmt(data.totals[c.key], true)
                          : i === 0
                            ? l("Total", "Total")
                            : ""}
                      </th>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
