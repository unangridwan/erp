"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Plan {
  id: string;
  name: string;
  leaveTypeName: string;
  frequency: "monthly" | "yearly";
  daysPerPeriod: string;
  startAfterMonths: number;
  carryOver: "none" | "all" | "limited";
  carryOverMax: string | null;
  carryOverExpiryMonths: number | null;
  active: boolean;
  employeeCount: number;
}

/** Rencana akrual cuti: jatah otomatis per bulan/tahun dan aturan sisa akhir tahun. */
export default function LeavePlansPage() {
  const { l } = useI18n();
  const me = useMe();
  const [rows, setRows] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Plan[]>("/leave-accrual-plans").then(setRows, (e: Error) => setError(e.message));
  }, []);
  const carry = (p: Plan) =>
    p.carryOver === "none"
      ? l("hangus", "lost")
      : `${p.carryOver === "all" ? l("semua", "all") : l(`maks. ${Number(p.carryOverMax)} hari`, `max ${Number(p.carryOverMax)} days`)}${
          p.carryOverExpiryMonths
            ? l(`, berlaku ${p.carryOverExpiryMonths} bln`, `, valid ${p.carryOverExpiryMonths} mo`)
            : ""
        }`;

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Rencana Akrual Cuti", "Time Off Accrual Plans")}</h1>
        {can(me.permissions, "hr.manage") && (
          <Link className="button primary" href="/hr/leave-plans/new">
            {l("Rencana baru", "New plan")}
          </Link>
        )}
      </header>
      <p className="muted">
        {l(
          "Jatah cuti bertambah otomatis (dijalankan tiap jam, aman diulang). Contoh UU 13/2003 jo. UU 6/2023: 12 hari per tahun setelah 12 bulan bekerja terus-menerus.",
          "Allocations grow automatically (runs hourly, safe to repeat). Indonesian law example: 12 days per year after 12 months of continuous service.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Nama", "Name")}</th>
              <th>{l("Jenis cuti", "Type")}</th>
              <th>{l("Akrual", "Accrual")}</th>
              <th>{l("Mulai setelah", "Starts after")}</th>
              <th>{l("Sisa akhir tahun", "Year-end balance")}</th>
              <th className="num">{l("Karyawan", "Employees")}</th>
              <th>{l("Aktif", "Active")}</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/hr/leave-plans/${p.id}`}>{p.name}</Link>
                </td>
                <td>{p.leaveTypeName}</td>
                <td>
                  {Number(p.daysPerPeriod)} {l("hari", "days")} /{" "}
                  {p.frequency === "yearly" ? l("tahun", "year") : l("bulan", "month")}
                </td>
                <td>
                  {p.startAfterMonths
                    ? l(`${p.startAfterMonths} bulan`, `${p.startAfterMonths} months`)
                    : "—"}
                </td>
                <td>{carry(p)}</td>
                <td className="num">{p.employeeCount}</td>
                <td>{p.active ? l("Ya", "Yes") : l("Tidak", "No")}</td>
              </tr>
            ))}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {l("Belum ada rencana akrual.", "No accrual plans yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
