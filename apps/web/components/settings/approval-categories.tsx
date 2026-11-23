"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMe } from "../me-context";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { can } from "../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../data-table";
import { useTableView } from "../../lib/use-table-view";

interface Category {
  id: string;
  code: string;
  name: string;
  prefix: string;
  managerFirst: boolean;
  approvalMode: "sequential" | "parallel";
  minApprovals: number;
  active: boolean;
  approverCount: number;
  system: boolean;
  usedBy: [string, string] | null;
}

/**
 * Kategori persetujuan (tab di Pengaturan › Aturan Persetujuan): kategori dokumen sistem (payroll, SK mutasi,
 * payment run, …) dan kategori permintaan bebas; field, penyetuju, mode, batas nominal (DoA).
 */
export function ApprovalCategories() {
  const { l } = useI18n();
  const me = useMe();
  const [rows, setRows] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Category[]>("/approval-categories").then(setRows, (e: Error) => setError(e.message));
  }, []);

  const columns = useMemo<ViewColumn<Category>[]>(
    () => [
      { key: "code", label: l("Kode", "Code"), value: (r) => r.code },
      { key: "name", label: l("Nama", "Name"), value: (r) => r.name },
      {
        key: "usedBy",
        label: l("Dipakai oleh", "Used by"),
        value: (r) => (r.usedBy ? l(r.usedBy[0], r.usedBy[1]) : l("Permintaan bebas", "Ad-hoc requests")),
      },
      {
        key: "approvalMode",
        label: l("Alur", "Flow"),
        type: "enum",
        value: (r) => r.approvalMode,
        optionLabel: (v) => (v === "parallel" ? l("Paralel", "Parallel") : l("Berurutan", "Sequential")),
      },
      {
        key: "approverCount",
        label: l("Penyetuju", "Approvers"),
        type: "number",
        value: (r) => r.approverCount,
      },
      {
        key: "active",
        label: l("Aktif", "Active"),
        type: "enum",
        value: (r) => (r.active ? "1" : "0"),
        optionLabel: (v) => (v === "1" ? l("Ya", "Yes") : l("Tidak", "No")),
      },
    ],
    [l],
  );
  const table = useTableView(rows ?? [], columns, { storageKey: "approval-categories" });

  return (
    <div>
      <header className="toolbar">
        <h2>{l("Kategori & dokumen sistem", "Categories & system documents")}</h2>
        {(can(me.permissions, "approval.manage") || can(me.permissions, "hr.manage")) && (
          <Link className="button primary" href="/settings/approval-rules/categories/new">
            {l("Kategori baru", "New category")}
          </Link>
        )}
      </header>
      <p className="muted">
        {l(
          "Dokumen seperti payroll run, SK mutasi, kenaikan gaji, payment run, dan stock opname diajukan lewat kategori sistem; kategori lain dipakai permintaan bebas. Setiap kategori menentukan field wajib dan penyetujunya. Batas nominal penyetuju membentuk matriks otorisasi: tahap hanya berlaku bila nominal mencapai batas. Tanpa penyetuju, permintaan diputuskan HR.",
          "Documents such as payroll runs, transfer decrees, salary reviews, payment runs, and stock counts are submitted through system categories; other categories serve ad-hoc requests. Each category sets required fields and approvers. Approver amount thresholds form the authority matrix: a step applies only when the amount reaches the threshold. Without approvers, HR decides.",
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <TableTools view={table} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <SortTh view={table} col="code">
                {l("Kode", "Code")}
              </SortTh>
              <SortTh view={table} col="name">
                {l("Nama", "Name")}
              </SortTh>
              <SortTh view={table} col="usedBy">
                {l("Dipakai oleh", "Used by")}
              </SortTh>
              <SortTh view={table} col="approvalMode">
                {l("Alur", "Flow")}
              </SortTh>
              <SortTh view={table} col="approverCount" className="num">
                {l("Penyetuju", "Approvers")}
              </SortTh>
              <SortTh view={table} col="active">
                {l("Aktif", "Active")}
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/settings/approval-rules/categories/${c.id}`}>{c.code}</Link>
                </td>
                <td>{c.name}</td>
                <td>
                  {c.usedBy ? (
                    <>
                      <span className="pill">{l("Sistem", "System")}</span> {l(c.usedBy[0], c.usedBy[1])}
                    </>
                  ) : (
                    <span className="muted">{l("Permintaan bebas", "Ad-hoc requests")}</span>
                  )}
                </td>
                <td>
                  {c.managerFirst && `${l("Atasan", "Manager")} → `}
                  {c.approvalMode === "parallel" ? l("paralel", "parallel") : l("berurutan", "sequential")}
                  {c.minApprovals > 0 && ` (min. ${c.minApprovals})`}
                </td>
                <td className="num">{c.approverCount || l("HR", "HR")}</td>
                <td>{c.active ? l("Ya", "Yes") : l("Tidak", "No")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePager view={table} />
    </div>
  );
}
