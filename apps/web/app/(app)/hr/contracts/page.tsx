"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { DataTable, type DataColumn } from "../../../../components/data-table";
import { RESIGN_REASON_LABEL } from "../../../../components/hr/offboarding-panel";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { CONTRACT_STATE_LABEL } from "../../../../lib/resources";
import { useContractTypes } from "../../../../lib/use-contract-types";
import { useListData } from "../../../../lib/use-list-data";

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

/**
 * Daftar kontrak kerja (semua status dimuat sekali; filter awal "Berjalan"); `?employeeId=` menampilkan semua kontrak
 * satu karyawan (riwayat masuk–keluar).
 */
function Contracts() {
  const { l, tx, locale } = useI18n();
  const employeeId = useSearchParams().get("employeeId");
  const list = useListData<Row>("/contracts", { employeeId });
  const types = useContractTypes();
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        key: "name",
        label: l("Nomor", "Reference"),
        value: (c) => c.name,
        render: (c) => <Link href={`/hr/contracts/${c.id}`}>{c.name}</Link>,
      },
      { key: "employee", label: l("Karyawan", "Employee"), value: (c) => c.employeeName },
      {
        key: "contractType",
        label: l("Jenis", "Type"),
        type: "enum",
        value: (c) => c.contractType,
        optionLabel: (v) => types.label(v),
        text: (c) => types.label(c.contractType),
      },
      {
        key: "dateStart",
        label: l("Mulai", "Start"),
        type: "date",
        value: (c) => c.dateStart,
        text: (c) => formatDate(c.dateStart, locale),
      },
      {
        key: "dateEnd",
        label: l("Berakhir", "End"),
        type: "date",
        value: (c) => c.dateEnd,
        text: (c) => formatDate(c.dateEnd, locale),
      },
      {
        key: "wage",
        label: l("Gaji pokok", "Base wage"),
        type: "number",
        className: "num",
        value: (c) => Number(c.wage),
        text: (c) => money(c.wage, locale),
      },
      {
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (c) => c.state,
        optionLabel: (v) => (CONTRACT_STATE_LABEL[v] ? tx(CONTRACT_STATE_LABEL[v]!) : v),
        text: (c) => (CONTRACT_STATE_LABEL[c.state] ? tx(CONTRACT_STATE_LABEL[c.state]!) : c.state),
        render: (c) => (
          <>
            <span className={`badge state-${c.state === "running" ? "sale" : c.state}`}>
              {CONTRACT_STATE_LABEL[c.state] ? tx(CONTRACT_STATE_LABEL[c.state]!) : c.state}
            </span>
            {c.endReason && (
              <span className="pill bad" title={l("Karyawan keluar", "Employee left")}>
                {l("Keluar", "Left")}: {l(...(RESIGN_REASON_LABEL[c.endReason] ?? ["", ""]))}
              </span>
            )}
          </>
        ),
      },
      {
        key: "endReason",
        label: l("Alasan keluar", "Leaving reason"),
        type: "enum",
        value: (c) => c.endReason,
        text: (c) => (c.endReason ? l(...(RESIGN_REASON_LABEL[c.endReason] ?? ["", ""])) : ""),
        hidden: true,
      },
    ],
    [l, tx, locale, types],
  );

  return (
    <>
      <header className="toolbar">
        <h1>{l("Kontrak Kerja", "Employment Contracts")}</h1>
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
      {list.error && <p className="error">{list.error}</p>}
      {!list.loading || list.rows.length ? (
        <DataTable
          key={employeeId ?? "all"}
          rows={list.rows}
          columns={columns}
          storageKey="contracts"
          rowKey={(c) => c.id}
          defaultSort={{ key: "dateStart", dir: "desc" }}
          initialFilters={employeeId ? undefined : { state: { kind: "enum", values: ["running"] } }}
          searchPlaceholder={l("Cari nomor, karyawan…", "Search number, employee…")}
          empty={l("Belum ada kontrak.", "No contracts yet.")}
        />
      ) : (
        <p className="muted">{l("Memuat…", "Loading…")}</p>
      )}
    </>
  );
}
