"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DataTable, type DataColumn } from "../../../../components/data-table";
import { Skeleton } from "../../../../components/feedback";
import { errorText } from "../../../../components/hr/hr-panels";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

interface Row {
  id: string;
  createdAt: string;
  fields: string[];
  purpose: string;
  recordCount: number;
  employeeId: string | null;
  employeeName: string | null;
  userName: string | null;
  userEmail: string | null;
}

/** Log akses data pribadi (UU PDP): siapa membuka NIK, NPWP, rekening, atau gaji karyawan, kapan, dan untuk apa. */
export default function PrivacyLogPage() {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Row[]>("/personal-data-access-logs").then(setRows, (e) => setError(errorText(e)));
  }, []);
  const FIELD: Record<string, string> = {
    nik: "NIK",
    npwp: "NPWP",
    bankAccount: l("Rekening", "Bank account"),
    kkNo: l("No. KK", "Family card"),
    salary: l("Gaji", "Salary"),
  };
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  const columns: DataColumn<Row>[] = [
    {
      key: "at",
      label: l("Waktu", "Time"),
      type: "date",
      value: (r) => r.createdAt,
      text: (r) => when(r.createdAt),
    },
    { key: "user", label: l("Pengguna", "User"), value: (r) => r.userName ?? r.userEmail ?? "—" },
    {
      key: "employee",
      label: l("Karyawan", "Employee"),
      value: (r) => r.employeeName ?? l(`${r.recordCount} data`, `${r.recordCount} records`),
      render: (r) =>
        r.employeeId ? (
          <Link href={`/employees/${r.employeeId}`}>{r.employeeName}</Link>
        ) : (
          <span className="muted">
            {l(`${r.recordCount} data (massal)`, `${r.recordCount} records (bulk)`)}
          </span>
        ),
    },
    { key: "fields", label: l("Data", "Data"), value: (r) => r.fields.map((f) => FIELD[f] ?? f).join(", ") },
    { key: "purpose", label: l("Keperluan", "Purpose"), value: (r) => r.purpose },
  ];
  return (
    <>
      <header className="toolbar">
        <h1>{l("Log Akses Data Pribadi", "Personal Data Access Log")}</h1>
      </header>
      <p className="muted">
        {l(
          "Dicatat otomatis (UU PDP): membuka data karyawan dengan NIK/NPWP/rekening, melihat slip gaji karyawan lain, dan ekspor kolom data pribadi. Akses karyawan atas datanya sendiri tidak dicatat.",
          "Recorded automatically: opening employee records with ID/tax/bank data, viewing another employee's payslip, and exporting personal-data columns. Employees viewing their own data are not logged.",
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {rows === null ? (
        <Skeleton rows={5} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          storageKey="hr-privacy-log"
          rowKey={(r) => r.id}
          defaultSort={{ key: "at", dir: "desc" }}
          searchPlaceholder={l("Cari pengguna, karyawan, keperluan…", "Search user, employee, purpose…")}
          empty={l("Belum ada akses data pribadi yang tercatat.", "No personal data access recorded yet.")}
        />
      )}
    </>
  );
}
