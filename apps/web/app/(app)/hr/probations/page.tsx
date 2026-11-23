"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DataTable, type DataColumn } from "../../../../components/data-table";
import { errorText } from "../../../../components/hr/hr-panels";
import { Skeleton } from "../../../../components/feedback";
import { api } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Row {
  contractId: string;
  contractName: string;
  dateStart: string;
  probationMonths: number;
  probationEnd: string;
  probationResult: "passed" | "failed" | null;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  daysLeft: number;
}

/** Masa percobaan karyawan PKWTT: yang masih berjalan (urut tanggal berakhir) atau seluruh riwayat. */
export default function ProbationsPage() {
  const { l, locale } = useI18n();
  const [all, setAll] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRows(null);
    api<Row[]>(`/hr/probations${all ? "?state=all" : ""}`).then(setRows, (e) => setError(errorText(e)));
  }, [all]);
  const RESULT = { passed: l("Lulus", "Passed"), failed: l("Tidak lulus", "Failed") };
  const columns: DataColumn<Row>[] = [
    {
      key: "employee",
      label: l("Karyawan", "Employee"),
      value: (r) => r.employeeName,
      render: (r) => (
        <>
          <Link href={`/employees/${r.employeeId}`}>{r.employeeName}</Link>{" "}
          <small className="muted">{r.employeeNumber}</small>
        </>
      ),
    },
    {
      key: "contract",
      label: l("Kontrak", "Contract"),
      value: (r) => r.contractName,
      render: (r) => <Link href={`/hr/contracts/${r.contractId}`}>{r.contractName}</Link>,
    },
    {
      key: "months",
      label: l("Lama", "Length"),
      type: "number",
      value: (r) => r.probationMonths,
      text: (r) => `${r.probationMonths} ${l("bln", "mo")}`,
    },
    {
      key: "end",
      label: l("Berakhir", "Ends"),
      type: "date",
      value: (r) => r.probationEnd,
      text: (r) => formatDate(r.probationEnd, locale),
    },
    {
      key: "status",
      label: l("Status", "Status"),
      value: (r) => (r.probationResult ? RESULT[r.probationResult] : l("Berjalan", "Running")),
      render: (r) =>
        r.probationResult ? (
          <span className={`pill${r.probationResult === "passed" ? " ok" : " bad"}`}>
            {RESULT[r.probationResult]}
          </span>
        ) : (
          <span className={`pill${r.daysLeft <= 14 ? " warn" : ""}`}>
            {r.daysLeft >= 0
              ? l(`${r.daysLeft} hari lagi`, `${r.daysLeft} days left`)
              : l("Lewat — evaluasi", "Overdue")}
          </span>
        ),
    },
  ];
  return (
    <>
      <header className="toolbar">
        <h1>{l("Masa Percobaan", "Probations")}</h1>
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          {l("Tampilkan riwayat", "Show history")}
        </label>
      </header>
      <p className="muted">
        {l(
          "Masa percobaan diatur saat membuat kontrak PKWTT (maks. 3 bulan). Buka kontrak untuk mencatat lulus/tidak lulus dan mencetak surat pengangkatan.",
          "Probation is set when creating a permanent contract (max. 3 months). Open the contract to record pass/fail and print the appointment letter.",
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {rows === null ? (
        <Skeleton rows={4} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          storageKey="hr-probations"
          rowKey={(r) => r.contractId}
          rowHref={(r) => `/hr/contracts/${r.contractId}`}
          defaultSort={{ key: "end", dir: "asc" }}
          searchPlaceholder={l("Cari karyawan…", "Search employee…")}
          empty={l("Tidak ada masa percobaan yang berjalan.", "No probations in progress.")}
        />
      )}
    </>
  );
}
