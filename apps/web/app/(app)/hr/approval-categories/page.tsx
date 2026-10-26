"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

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
}

/** Kategori persetujuan: field, penyetuju, mode, batas nominal (DoA). */
export default function ApprovalCategoriesPage() {
  const { l } = useI18n();
  const me = useMe();
  const [rows, setRows] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Category[]>("/approval-categories").then(setRows, (e: Error) => setError(e.message));
  }, []);

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Kategori Persetujuan", "Approval Categories")}</h1>
        {can(me.permissions, "hr.manage") && (
          <Link className="button primary" href="/hr/approval-categories/new">
            {l("Kategori baru", "New category")}
          </Link>
        )}
      </header>
      <p className="muted">
        {l(
          "Setiap kategori menentukan field yang wajib diisi dan penyetujunya. Batas nominal penyetuju membentuk matriks otorisasi: tahap hanya berlaku bila nominal permintaan mencapai batas. Tanpa penyetuju, permintaan diputuskan HR.",
          "Each category sets the required fields and approvers. Approver amount thresholds form the authority matrix: a step applies only when the request amount reaches the threshold. Without approvers, HR decides.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Kode", "Code")}</th>
              <th>{l("Nama", "Name")}</th>
              <th>{l("Prefix nomor", "Number prefix")}</th>
              <th>{l("Alur", "Flow")}</th>
              <th className="num">{l("Penyetuju", "Approvers")}</th>
              <th>{l("Aktif", "Active")}</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/hr/approval-categories/${c.id}`}>{c.code}</Link>
                </td>
                <td>{c.name}</td>
                <td>{c.prefix}</td>
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
    </div>
  );
}
