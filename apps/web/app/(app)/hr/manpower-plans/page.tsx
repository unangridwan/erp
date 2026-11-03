"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { errorText } from "../../../../components/hr/hr-panels";
import { PLAN_STATE_LABEL, planStatePill, type PlanState } from "../../../../components/hr/manpower-plan";
import { api } from "../../../../lib/api";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface List {
  year: number;
  showCost: boolean;
  canManage: boolean;
  rows: {
    departmentId: string;
    department: string;
    canEdit: boolean;
    plan: {
      id: string;
      name: string;
      state: PlanState;
      startHeadcount: number;
      endHeadcount: number;
      additions: number;
      replacements: number;
      annualCost: number | null;
      toFill: number;
      filled: number;
    } | null;
  }[];
  totals: {
    approved: number;
    endHeadcount: number;
    additions: number;
    annualCost: number | null;
    toFill: number;
    filled: number;
  };
}

/** Man Power Planning: MPP per departemen untuk satu tahun, status persetujuan, headcount, biaya & realisasi. */
export default function ManpowerPlansPage() {
  return (
    <Suspense>
      <ManpowerPlans />
    </Suspense>
  );
}

function ManpowerPlans() {
  const { l, locale } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const [year, setYear] = useState(Number(search.get("year")) || new Date().getFullYear() + 1);
  const [d, setD] = useState<List | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  type PlanRow = List["rows"][number];
  const columns = useMemo<ViewColumn<PlanRow>[]>(() => {
    const num = (
      key: "startHeadcount" | "endHeadcount" | "additions" | "replacements" | "filled",
      label: string,
    ) => ({
      key,
      label,
      type: "number" as const,
      value: (r: PlanRow) => r.plan?.[key] ?? null,
    });
    return [
      { key: "department", label: l("Departemen", "Department"), value: (r) => r.department },
      {
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (r) => r.plan?.state ?? "none",
        optionLabel: (v) =>
          v === "none" ? l("Belum ada MPP", "No plan yet") : l(...PLAN_STATE_LABEL[v as PlanState]),
      },
      num("startHeadcount", l("Awal", "Start")),
      num("endHeadcount", l("Akhir", "End")),
      num("additions", l("Tambahan", "New")),
      num("replacements", l("Pengganti", "Repl.")),
      num("filled", l("Realisasi", "Filled")),
      {
        key: "annualCost",
        label: l("Biaya tahunan", "Annual cost"),
        type: "number",
        value: (r) => r.plan?.annualCost ?? null,
      },
    ];
  }, [l]);
  const table = useTableView(d?.rows ?? [], columns, { storageKey: "manpower-plans" });
  useEffect(() => {
    setError(null);
    api<List>(`/manpower-plans?year=${year}`).then(setD, (e) => setError(errorText(e)));
  }, [year]);

  const create = async (departmentId: string) => {
    setBusy(departmentId);
    setError(null);
    try {
      const plan = await api<{ id: string }>("/manpower-plans", {
        method: "POST",
        body: { year, departmentId },
      });
      router.push(`/hr/manpower-plans/${plan.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  return (
    <div className="stack-wide">
      <section className="panel">
        <header className="toolbar">
          <h1>Man Power Planning</h1>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label={l("Tahun", "Year")}
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() + 2 - i).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
          <Link href="/hr/manpower-budget" className="button">
            {l("Anggaran Tenaga Kerja", "Manpower Budget")}
          </Link>
        </header>
        <p className="muted">
          {l(
            "Tiap departemen menyusun rencana posisi setahun (posisi terisi, tambahan, pengganti). Setelah disetujui, rencana mengisi Anggaran Tenaga Kerja per jabatan × bulan dan Anggaran Akuntansi “Anggaran SDM” (beban gaji & BPJS), lalu posisi baru bisa dijadikan lowongan.",
            "Each department plans its positions for the year (existing, new, replacement). Once approved, the plan fills the Manpower Budget per job × month and the accounting “HR Budget” (salary & BPJS expense); new positions can then become job openings.",
          )}
        </p>
        {error && <p className="error">{error}</p>}
        {d && (
          <ul className="grid">
            {(
              [
                [l("MPP disetujui", "Approved plans"), `${d.totals.approved} / ${d.rows.length}`],
                [l("Headcount akhir tahun", "Year-end headcount"), String(d.totals.endHeadcount)],
                [l("Posisi tambahan", "New positions"), String(d.totals.additions)],
                [l("Realisasi rekrutmen", "Hiring progress"), `${d.totals.filled} / ${d.totals.toFill}`],
                ...(d.showCost && d.totals.annualCost !== null
                  ? [[l("Biaya tahunan", "Annual cost"), money(d.totals.annualCost, locale)]]
                  : []),
              ] as [string, string][]
            ).map(([label, value]) => (
              <li key={label} className="card">
                <span>{label}</span>
                <strong>{value}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
      {d && (
        <section className="panel proj-panel">
          <TableTools view={table} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortTh view={table} col="department">
                    {l("Departemen", "Department")}
                  </SortTh>
                  <SortTh view={table} col="state">
                    {l("Status", "Status")}
                  </SortTh>
                  <SortTh view={table} col="startHeadcount" className="num">
                    {l("Awal", "Start")}
                  </SortTh>
                  <SortTh view={table} col="endHeadcount" className="num">
                    {l("Akhir", "End")}
                  </SortTh>
                  <SortTh view={table} col="additions" className="num">
                    {l("Tambahan", "New")}
                  </SortTh>
                  <SortTh view={table} col="replacements" className="num">
                    {l("Pengganti", "Repl.")}
                  </SortTh>
                  <SortTh view={table} col="filled" className="num">
                    {l("Realisasi", "Filled")}
                  </SortTh>
                  {d.showCost && (
                    <SortTh view={table} col="annualCost" className="num">
                      {l("Biaya tahunan", "Annual cost")}
                    </SortTh>
                  )}
                  <th />
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <tr key={r.departmentId}>
                    <td>{r.department}</td>
                    {r.plan ? (
                      <>
                        <td>
                          <span className={`pill ${planStatePill(r.plan.state)}`}>
                            {l(...PLAN_STATE_LABEL[r.plan.state])}
                          </span>
                        </td>
                        <td className="num">{r.plan.startHeadcount}</td>
                        <td className="num">{r.plan.endHeadcount}</td>
                        <td className="num">{r.plan.additions || "—"}</td>
                        <td className="num">{r.plan.replacements || "—"}</td>
                        <td className="num">{r.plan.toFill ? `${r.plan.filled} / ${r.plan.toFill}` : "—"}</td>
                        {d.showCost && <td className="num">{money(r.plan.annualCost ?? 0, locale)}</td>}
                        <td>
                          <Link href={`/hr/manpower-plans/${r.plan.id}`}>{l("Buka", "Open")}</Link>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="muted" colSpan={d.showCost ? 7 : 6}>
                          {l("Belum ada MPP", "No plan yet")}
                        </td>
                        <td>
                          {r.canEdit && (
                            <button
                              type="button"
                              disabled={busy !== null}
                              onClick={() => create(r.departmentId)}
                            >
                              {l("Buat MPP", "Create plan")}
                            </button>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {!table.rows.length && (
                  <tr>
                    <td colSpan={9} className="muted">
                      {d.rows.length
                        ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                        : l("Belum ada departemen.", "No departments yet.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <TablePager view={table} />
        </section>
      )}
    </div>
  );
}
