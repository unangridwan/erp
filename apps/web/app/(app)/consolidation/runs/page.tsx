"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface Run {
  id: string;
  name: string;
  rootName: string;
  dateFrom: string;
  dateTo: string;
  currencyCode: string;
  state: "draft" | "final";
  warnings: string[];
}

export default function ConsolidationRunsPage() {
  const me = useMe();
  const router = useRouter();
  const { l, locale } = useI18n();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [rootCompanyId, setRoot] = useState(me.activeCompanyId);
  const [dateTo, setDateTo] = useState(today());
  const [dateFrom, setDateFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const columns = useMemo<ViewColumn<Run>[]>(
    () => [
      { key: "name", label: l("Proses", "Run"), value: (r) => r.name },
      { key: "root", label: l("Induk", "Parent"), type: "enum", value: (r) => r.rootName },
      { key: "dateTo", label: l("Periode", "Period"), type: "date", value: (r) => r.dateTo },
      { key: "currency", label: l("Mata uang", "Currency"), type: "enum", value: (r) => r.currencyCode },
      {
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (r) => r.state,
        optionLabel: (v) => (v === "final" ? l("Final", "Final") : l("Draft", "Draft")),
      },
      {
        key: "warnings",
        label: l("Peringatan", "Warnings"),
        type: "enum",
        value: (r) => (r.warnings.length ? "1" : "0"),
        optionLabel: (v) =>
          v === "1" ? l("Ada peringatan", "Has warnings") : l("Tanpa peringatan", "No warnings"),
        hidden: true,
      },
    ],
    [l],
  );
  const table = useTableView(runs ?? [], columns, {
    storageKey: "consolidation-runs",
    defaultSort: { key: "dateTo", dir: "desc" },
  });

  useEffect(() => {
    api<Run[]>("/consolidation/runs")
      .then(setRuns)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails([]);
    setBusy(true);
    try {
      const run = await api<{ id: string }>("/consolidation/runs", {
        method: "POST",
        body: { rootCompanyId, dateTo, dateFrom: dateFrom || null },
      });
      router.push(`/consolidation/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      const body = (err as { body?: { errors?: { path: string; message: string }[] } }).body;
      setDetails((body?.errors ?? []).map((x) => `${x.path}: ${x.message}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="toolbar">
        <h1>{l("Proses Konsolidasi", "Consolidation Runs")}</h1>
      </header>
      <p className="muted">
        {l(
          "Konsolidasi menggabungkan laporan perusahaan induk dan entitas anak sesuai struktur Kepemilikan: translasi kurs, eliminasi investasi & transaksi antar perusahaan, KNP, dan metode ekuitas untuk asosiasi. Pastikan bagan akun grup & pemetaan akun sudah dibuat (Konfigurasi → Pemetaan Akun).",
          "Consolidation combines the parent and subsidiaries per the Ownership structure: currency translation, investment & intercompany eliminations, NCI, and the equity method for associates. Set up the group chart & account mapping first (Configuration → Account Mapping).",
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {details.length > 0 && (
        <ul className="error small">
          {details.slice(0, 20).map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      {can(me.permissions, "consolidation.manage") && (
        <form className="inline-panel" onSubmit={create}>
          <label className="field">
            <span>
              {l(
                "Perusahaan induk (pilih sub-holding untuk konsolidasi sub-grup)",
                "Parent company (pick a sub-holding for a sub-group consolidation)",
              )}
            </span>
            <select value={rootCompanyId} onChange={(e) => setRoot(e.target.value)}>
              {me.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Per tanggal", "As of")}</span>
            <input type="date" required value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <label className="field">
            <span>
              {l("Laba rugi sejak (kosong = awal tahun fiskal)", "P&L from (empty = fiscal year start)")}
            </span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? l("Menghitung…", "Computing…") : l("Buat & hitung konsolidasi", "Create & compute")}
          </button>
        </form>
      )}
      {runs && <TableTools view={table} />}
      {runs && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh view={table} col="name">
                  {l("Proses", "Run")}
                </SortTh>
                <SortTh view={table} col="root">
                  {l("Induk", "Parent")}
                </SortTh>
                <SortTh view={table} col="dateTo">
                  {l("Periode", "Period")}
                </SortTh>
                <SortTh view={table} col="currency">
                  {l("Mata uang", "Currency")}
                </SortTh>
                <SortTh view={table} col="state">
                  {l("Status", "Status")}
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/consolidation/runs/${r.id}`}>{r.name}</Link>
                    {r.warnings.length > 0 && (
                      <span className="badge state-sent"> {r.warnings.length} ⚠</span>
                    )}
                  </td>
                  <td>{r.rootName}</td>
                  <td>
                    {formatDate(r.dateFrom, locale)} – {formatDate(r.dateTo, locale)}
                  </td>
                  <td>{r.currencyCode}</td>
                  <td>
                    <span className={`badge ${r.state === "final" ? "state-posted" : "state-draft"}`}>
                      {r.state === "final" ? l("Final", "Final") : l("Draft", "Draft")}
                    </span>
                  </td>
                </tr>
              ))}
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {runs.length
                      ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                      : l("Belum ada proses konsolidasi.", "No consolidation runs yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {runs && <TablePager view={table} />}
    </>
  );
}
