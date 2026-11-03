"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { RESIGN_REASON_LABEL } from "../../../../components/hr/offboarding-panel";
import { api } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { CONTRACT_STATE_LABEL } from "../../../../lib/resources";

interface Row {
  id: string;
  name: string;
  employeeName: string;
  contractType: string;
  dateStart: string;
  dateEnd: string | null;
  wage: string;
  state: string;
  endReason: string | null;
}

export default function ContractsPage() {
  return (
    <Suspense>
      <Contracts />
    </Suspense>
  );
}

/** Daftar kontrak kerja; `?employeeId=` menampilkan semua kontrak satu karyawan (riwayat masuk–keluar). */
function Contracts() {
  const { l, tx, locale } = useI18n();
  const employeeId = useSearchParams().get("employeeId");
  const [state, setState] = useState(employeeId ? "" : "running");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams();
    if (state) q.set("state", state);
    if (employeeId) q.set("employeeId", employeeId);
    api<{ items: Row[] }>(`/contracts?${q}`)
      .then((d) => setRows(d.items))
      .catch((e: Error) => setError(e.message));
  }, [state, employeeId]);

  return (
    <>
      <header className="toolbar">
        <h1>{l("Kontrak Kerja", "Employment Contracts")}</h1>
        <select value={state} onChange={(e) => setState(e.target.value)}>
          <option value="running">{l("Berjalan", "Running")}</option>
          <option value="draft">Draft</option>
          <option value="closed">{l("Berakhir", "Expired")}</option>
          <option value="">{l("Semua", "All")}</option>
        </select>
        <Link className="button primary" href="/employees/new">
          {l("Karyawan baru + kontrak", "New employee + contract")}
        </Link>
      </header>
      <p className="muted">
        {l(
          "Tanggal masuk karyawan = tanggal mulai kontrak pertama (dibuat bersama data karyawan baru); tanggal keluar diisi lewat Akhiri kontrak → karyawan keluar. Perpanjangan/kontrak baru dibuat dari tab Penggajian karyawan. Dokumen kontrak ada di halaman kontrak; templatnya di Konfigurasi › Template Kontrak.",
          "An employee's join date = the first contract's start date (created with the new employee); the leaving date is set with End contract → employee leaves. Renewals are created from the employee's Payroll tab. The contract document is on the contract page; templates are under Configuration › Contract Templates.",
        )}
      </p>
      {employeeId && (
        <p>
          <span className="pill">{l("Difilter per karyawan", "Filtered by employee")}</span>{" "}
          <Link href={`/employees/${employeeId}`}>{l("Buka karyawan", "Open employee")}</Link> ·{" "}
          <Link href="/hr/contracts">{l("Tampilkan semua", "Show all")}</Link>
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Nomor", "Reference")}</th>
                <th>{l("Karyawan", "Employee")}</th>
                <th>{l("Jenis", "Type")}</th>
                <th>{l("Mulai", "Start")}</th>
                <th>{l("Berakhir", "End")}</th>
                <th className="num">{l("Gaji pokok", "Base wage")}</th>
                <th>{l("Status", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/hr/contracts/${c.id}`}>{c.name}</Link>
                  </td>
                  <td>{c.employeeName}</td>
                  <td>{c.contractType.toUpperCase()}</td>
                  <td>{formatDate(c.dateStart, locale)}</td>
                  <td>{formatDate(c.dateEnd, locale)}</td>
                  <td className="num">{money(c.wage, locale)}</td>
                  <td>
                    <span className={`badge state-${c.state === "running" ? "sale" : c.state}`}>
                      {tx(CONTRACT_STATE_LABEL[c.state]!)}
                    </span>
                    {c.endReason && (
                      <span className="pill bad" title={l("Karyawan keluar", "Employee left")}>
                        {l("Keluar", "Left")}: {l(...(RESIGN_REASON_LABEL[c.endReason] ?? ["", ""]))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    {l("Belum ada kontrak.", "No contracts yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
