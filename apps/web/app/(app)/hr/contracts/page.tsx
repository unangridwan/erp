"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
}

export default function ContractsPage() {
  const { l, tx, locale } = useI18n();
  const [state, setState] = useState("running");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: Row[] }>(`/contracts${state ? `?state=${state}` : ""}`)
      .then((d) => setRows(d.items))
      .catch((e: Error) => setError(e.message));
  }, [state]);

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
        <Link className="button primary" href="/hr/contracts/new">
          {l("Baru", "New")}
        </Link>
      </header>
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
