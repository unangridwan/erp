"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";

export type PlanState = "draft" | "in_approval" | "approved" | "cancel";
export type Realization = "not_started" | "recruiting" | "partial" | "fulfilled";

export const PLAN_STATE_LABEL: Record<PlanState, [string, string]> = {
  draft: ["Draft", "Draft"],
  in_approval: ["Menunggu persetujuan", "In approval"],
  approved: ["Disetujui", "Approved"],
  cancel: ["Dibatalkan", "Cancelled"],
};
export const planStatePill = (s: PlanState) =>
  s === "approved" ? "ok" : s === "in_approval" ? "warn" : s === "cancel" ? "bad" : "";

export const REALIZATION_LABEL: Record<Realization, [string, string]> = {
  not_started: ["Belum diproses", "Not started"],
  recruiting: ["Rekrutmen berjalan", "Recruiting"],
  partial: ["Terisi sebagian", "Partially filled"],
  fulfilled: ["Terpenuhi", "Fulfilled"],
};
export const realizationPill = (r: Realization) =>
  r === "fulfilled" ? "ok" : r === "partial" || r === "recruiting" ? "warn" : "";

interface Row {
  departmentId: string;
  department: string;
  canEdit: boolean;
  isHead: boolean;
  plan: { id: string; name: string; state: PlanState; endHeadcount: number; additions: number } | null;
}

/** Portal kepala departemen: MPP departemen yang ia kepalai tahun ini & tahun depan. */
export function MyManpowerPlans() {
  const { l } = useI18n();
  const year = new Date().getFullYear();
  const [data, setData] = useState<{ year: number; rows: Row[] }[] | null>(null);
  useEffect(() => {
    Promise.all(
      [year, year + 1].map((y) => api<{ year: number; rows: Row[] }>(`/manpower-plans?year=${y}`)),
    ).then(setData, () => setData(null));
  }, [year]);
  const rows =
    data?.flatMap((d) => d.rows.filter((r) => r.isHead).map((r) => ({ ...r, year: d.year }))) ?? [];
  if (!rows.length) return null;
  return (
    <section className="panel">
      <h2>{l("Man Power Planning departemen saya", "My department manpower plans")}</h2>
      <ul className="plain-list">
        {rows.map((r) => (
          <li key={`${r.year}-${r.departmentId}`}>
            <strong>
              {r.department} {r.year}
            </strong>{" "}
            {r.plan ? (
              <>
                <span className={`pill ${planStatePill(r.plan.state)}`}>
                  {l(...PLAN_STATE_LABEL[r.plan.state])}
                </span>{" "}
                {l(
                  `${r.plan.endHeadcount} orang akhir tahun, +${r.plan.additions} tambahan`,
                  `${r.plan.endHeadcount} at year end, +${r.plan.additions} new`,
                )}{" "}
                <Link href={`/hr/manpower-plans/${r.plan.id}`}>{l("Buka", "Open")}</Link>
              </>
            ) : (
              <Link href={`/hr/manpower-plans?year=${r.year}`}>{l("Buat MPP", "Create plan")}</Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
