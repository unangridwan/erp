"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { download, taxStateClass } from "../../../../lib/download";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can, TAX_DOC_STATE_LABEL } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface Slip {
  id: string;
  kind: "bppu" | "bpmp" | "bpa1";
  state: string;
  monthStart: number | null;
  monthEnd: number | null;
  counterpartName: string;
  counterpartTin: string | null;
  counterpartIdtku: string | null;
  ptkpStatus: string | null;
  taxObjectCode: string | null;
  taxBase: string;
  rate: string;
  taxAmount: string;
  documentNumber: string | null;
  withholdingDate: string;
  bupotNumber: string | null;
}

export default function WithholdingPage() {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const [kind, setKind] = useState<"bppu" | "bpmp" | "bpa1">("bppu");
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [slips, setSlips] = useState<Slip[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, month] = period.split("-").map(Number) as [number, number];
  const canWrite = can(me.permissions, "tax.write");

  const load = useCallback(() => {
    api<Slip[]>(`/withholding-slips?kind=${kind}&year=${year}&month=${month}`)
      .then((rows) => {
        setSlips(rows);
        setSelected(new Set());
      })
      .catch((e: Error) => setError(e.message));
  }, [kind, year, month]);
  useEffect(load, [load]);

  async function run(action: () => Promise<string | void>) {
    setError(null);
    setMessage(null);
    try {
      const done = await action();
      if (done) setMessage(done);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const edit = (slip: Slip, field: "taxObjectCode" | "counterpartTin", label: string) => {
    const value = window.prompt(label, slip[field] ?? "");
    if (value !== null)
      void run(() => api(`/withholding-slips/${slip.id}`, { method: "PATCH", body: { [field]: value } }));
  };

  const columns = useMemo<ViewColumn<Slip>[]>(
    () => [
      {
        key: "counterpart",
        label: kind === "bppu" ? l("Penerima penghasilan", "Income recipient") : l("Pegawai", "Employee"),
        value: (s) => s.counterpartName,
        text: (s) => `${s.counterpartName} ${s.documentNumber ?? ""} ${s.ptkpStatus ?? ""}`,
      },
      { key: "counterpartTin", label: l("NPWP/NIK", "Tax ID"), value: (s) => s.counterpartTin },
      {
        key: "taxObjectCode",
        label: l("Kode objek", "Object code"),
        type: "enum",
        value: (s) => s.taxObjectCode,
      },
      {
        key: "taxBase",
        label: kind === "bppu" ? "DPP" : l("Bruto", "Gross"),
        type: "number",
        value: (s) => Number(s.taxBase),
      },
      {
        key: "rate",
        label: kind === "bpa1" ? l("Masa", "Months") : l("Tarif %", "Rate %"),
        type: "number",
        value: (s) => (s.kind === "bpa1" ? s.monthStart : Number(s.rate)),
      },
      { key: "taxAmount", label: l("PPh", "Tax"), type: "number", value: (s) => Number(s.taxAmount) },
      { key: "withholdingDate", label: l("Tanggal", "Date"), type: "date", value: (s) => s.withholdingDate },
      {
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (s) => s.state,
        optionLabel: (v) => (TAX_DOC_STATE_LABEL[v] ? tx(TAX_DOC_STATE_LABEL[v]!) : v),
        text: (s) =>
          `${TAX_DOC_STATE_LABEL[s.state] ? tx(TAX_DOC_STATE_LABEL[s.state]!) : s.state} ${s.bupotNumber ?? ""}`,
      },
    ],
    [l, tx, kind],
  );
  const table = useTableView(slips ?? [], columns, {
    storageKey: "withholding-slips",
    defaultSort: { key: "withholdingDate", dir: "asc" },
  });
  const exportable = table.filtered.filter((s) => s.state === "draft" || s.state === "exported");

  return (
    <>
      <header className="toolbar">
        <h1>{l("Bukti Potong", "Withholding Slips")}</h1>
        <div className="tabs">
          <button className={kind === "bppu" ? "primary" : ""} onClick={() => setKind("bppu")}>
            {l("Unifikasi (PPh 23/4(2))", "Unified (art. 23/4(2))")}
          </button>
          <button className={kind === "bpmp" ? "primary" : ""} onClick={() => setKind("bpmp")}>
            {l("PPh 21 bulanan", "Monthly PPh 21")}
          </button>
          <button className={kind === "bpa1" ? "primary" : ""} onClick={() => setKind("bpa1")}>
            {l("A1 tahunan", "Annual A1")}
          </button>
        </div>
        <label className="field inline">
          <span>{l("Masa pajak", "Tax period")}</span>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </label>
      </header>
      <p className="muted">
        {kind === "bpa1"
          ? l(
              "Dibuat dari slip masa pajak terakhir (Desember atau bulan karyawan keluar): penghasilan setahun dari slip yang diposting dan PPh 21 terutang setahun. Susunan XML mengikuti template konverter BPA1 DJP (DJP tidak menerbitkan XSD); impor di e-Bupot PPh 21/26 → BP A1.",
              "Built from the final-period payslip (December or the resignation month): yearly income from posted payslips and yearly PPh 21. The XML follows DJP's BPA1 converter template (no official XSD); import in e-Bupot PPh 21/26 → BP A1.",
            )
          : kind === "bppu"
            ? l(
                "Dibuat dari tagihan pemasok yang memakai pajak PPh potong (mis. PPh 23). Isi kode objek pajak di master pajak agar terisi otomatis.",
                "Built from vendor bills with withholding taxes (e.g. art. 23). Set the tax object code on the tax to prefill it.",
              )
            : l(
                "Dibuat dari payroll yang sudah diposting (pegawai tetap, kode 21-100-01). Masa pajak terakhir (Desember/keluar) dilaporkan dengan bukti potong A1 di Coretax.",
                "Built from posted payroll (permanent employees, code 21-100-01). The final period (December/resignation) uses the A1 slip in Coretax.",
              )}
      </p>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}
      {canWrite && (
        <div className="inline-panel">
          <button
            className="primary"
            onClick={() =>
              run(async () => {
                const res = await api<{ created: number; skipped: { name: string; reason: string }[] }>(
                  "/withholding-slips/generate",
                  { method: "POST", body: { kind, year, month } },
                );
                const skipped = res.skipped.map((s) => `${s.name} (${s.reason})`).join("; ");
                return l(
                  `${res.created} bukti potong dibuat${skipped ? `. Dilewati: ${skipped}` : ""}`,
                  `${res.created} slips created${skipped ? `. Skipped: ${skipped}` : ""}`,
                );
              })
            }
          >
            {l("Buat draft dari transaksi", "Create drafts from transactions")}
          </button>
          {can(me.permissions, "tax.manage") && (
            <button
              disabled={!selected.size}
              onClick={() =>
                run(async () => {
                  await download("/withholding-slips/export", { ids: [...selected] }, `bupot-${kind}.xml`);
                  return l(
                    "XML diunduh; impor di menu e-Bupot Coretax.",
                    "XML downloaded; import it in Coretax e-Bupot.",
                  );
                })
              }
            >
              {l(`Ekspor XML (${selected.size})`, `Export XML (${selected.size})`)}
            </button>
          )}
        </div>
      )}
      {slips && (
        <TableTools
          view={table}
          placeholder={l("Cari nama, NPWP, kode objek, nomor…", "Search name, TIN, object code, number…")}
        />
      )}
      {slips && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label={l("Pilih semua", "Select all")}
                    checked={exportable.length > 0 && exportable.every((s) => selected.has(s.id))}
                    onChange={(e) =>
                      setSelected(new Set(e.target.checked ? exportable.map((s) => s.id) : []))
                    }
                  />
                </th>
                <SortTh view={table} col="counterpart">
                  {kind === "bppu" ? l("Penerima penghasilan", "Income recipient") : l("Pegawai", "Employee")}
                </SortTh>
                <SortTh view={table} col="counterpartTin">
                  {l("NPWP/NIK", "Tax ID")}
                </SortTh>
                <SortTh view={table} col="taxObjectCode">
                  {l("Kode objek", "Object code")}
                </SortTh>
                <SortTh view={table} col="taxBase" className="num">
                  {kind === "bppu" ? "DPP" : l("Bruto", "Gross")}
                </SortTh>
                <SortTh view={table} col="rate" className="num">
                  {kind === "bpa1" ? l("Masa", "Months") : l("Tarif %", "Rate %")}
                </SortTh>
                <SortTh view={table} col="taxAmount" className="num">
                  {l("PPh", "Tax")}
                </SortTh>
                <SortTh view={table} col="withholdingDate">
                  {l("Tanggal", "Date")}
                </SortTh>
                <SortTh view={table} col="state">
                  {l("Status", "Status")}
                </SortTh>
                <th />
              </tr>
            </thead>
            <tbody>
              {table.rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    {(s.state === "draft" || s.state === "exported") && (
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() =>
                          setSelected((cur) => {
                            const next = new Set(cur);
                            if (next.has(s.id)) next.delete(s.id);
                            else next.add(s.id);
                            return next;
                          })
                        }
                      />
                    )}
                  </td>
                  <td>
                    {s.counterpartName}
                    {s.documentNumber && <div className="muted small">{s.documentNumber}</div>}
                    {s.ptkpStatus && <div className="muted small">PTKP {s.ptkpStatus}</div>}
                  </td>
                  <td>{s.counterpartTin ?? <span className="error">{l("belum ada", "missing")}</span>}</td>
                  <td>{s.taxObjectCode ?? <span className="error">{l("belum ada", "missing")}</span>}</td>
                  <td className="num">{money(s.taxBase, locale)}</td>
                  <td className="num">
                    {s.kind === "bpa1" ? `${s.monthStart}–${s.monthEnd}` : Number(s.rate)}
                  </td>
                  <td className="num">{money(s.taxAmount, locale)}</td>
                  <td>{formatDate(s.withholdingDate, locale)}</td>
                  <td>
                    <span className={`badge ${taxStateClass(s.state)}`}>
                      {tx(TAX_DOC_STATE_LABEL[s.state]!)}
                    </span>
                    {s.bupotNumber && <div className="muted small">{s.bupotNumber}</div>}
                  </td>
                  <td className="actions">
                    {canWrite && s.state === "draft" && (
                      <>
                        <button
                          className="link"
                          onClick={() =>
                            edit(
                              s,
                              "taxObjectCode",
                              l("Kode objek pajak (mis. 24-104-14)", "Tax object code"),
                            )
                          }
                        >
                          {l("Kode objek", "Object code")}
                        </button>
                        {s.kind === "bppu" && (
                          <button
                            className="link"
                            onClick={() =>
                              edit(
                                s,
                                "counterpartTin",
                                l("NPWP 16 digit penerima", "Recipient 16-digit NPWP"),
                              )
                            }
                          >
                            NPWP
                          </button>
                        )}
                      </>
                    )}
                    {canWrite && (s.state === "draft" || s.state === "exported") && (
                      <button
                        className="link"
                        onClick={() => {
                          const number = window.prompt(
                            l("Nomor bukti potong dari Coretax", "Slip number from Coretax"),
                          );
                          if (number)
                            void run(() =>
                              api(`/withholding-slips/${s.id}/approve`, { method: "POST", body: { number } }),
                            );
                        }}
                      >
                        {l("Catat terbit", "Mark approved")}
                      </button>
                    )}
                    {canWrite && s.state !== "cancelled" && (
                      <button
                        className="link danger"
                        onClick={() => {
                          if (window.confirm(l("Batalkan bukti potong ini?", "Cancel this slip?")))
                            void run(() => api(`/withholding-slips/${s.id}/cancel`, { method: "POST" }));
                        }}
                      >
                        {l("Batalkan", "Cancel")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted">
                    {slips.length
                      ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                      : l("Belum ada bukti potong pada masa ini.", "No slips in this period.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {slips && <TablePager view={table} />}
    </>
  );
}
