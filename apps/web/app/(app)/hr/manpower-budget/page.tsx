"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart } from "../../../../components/hr/charts";
import { errorText } from "../../../../components/hr/hr-panels";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { download } from "../../../../lib/download";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Budget {
  departmentId: string | null;
  jobId: string | null;
  month: number;
  headcount: string;
  cost: string | null;
  note: string | null;
  sourcePlanId: string | null;
}
type Variance = { diff: number; percent: number | null };
interface Report {
  year: number;
  showCost: boolean;
  rows: {
    departmentId: string | null;
    department: string;
    months: {
      month: number;
      plannedHeadcount: number;
      actualHeadcount: number | null;
      headcountVariance: Variance | null;
      plannedCost?: number;
      actualCost?: number;
    }[];
    current: { month: number; plannedHeadcount: number; actualHeadcount: number; variance: Variance };
    openVacancies: number;
    plannedCost?: number;
    actualCost?: number;
    costVariance?: Variance;
  }[];
  months: {
    month: number;
    plannedHeadcount: number;
    actualHeadcount: number | null;
    plannedCost?: number;
    actualCost?: number;
  }[];
}
type Grid = Record<string, { headcount: string[]; cost: string[] }>;

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NONE = "_";
const empty12 = () => Array.from({ length: 12 }, () => "");

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** Anggaran tenaga kerja: rencana headcount & biaya per departemen per bulan vs aktual (karyawan aktif & slip terposting). */
export default function ManpowerBudgetPage() {
  const { l, locale } = useI18n();
  const me = useMe();
  const canEdit = can(me.permissions, "hr.manage");
  const [year, setYear] = useState(new Date().getFullYear());
  const [report, setReport] = useState<Report | null>(null);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [field, setField] = useState<"headcount" | "cost">("headcount");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const labels = locale === "id" ? MONTHS_ID : MONTHS_EN;
  const nf = (v: number) => v.toLocaleString(locale === "id" ? "id-ID" : "en-US");
  const diffText = (v: Variance | null | undefined, fmt = nf) =>
    !v ? "—" : `${v.diff > 0 ? "+" : ""}${fmt(v.diff)}${v.percent === null ? "" : ` (${nf(v.percent)}%)`}`;

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      api<Report>(`/manpower-budgets/report?year=${year}`),
      api<Budget[]>(`/manpower-budgets?year=${year}`),
      api<{ items: { id: string; name: string }[] } | { id: string; name: string }[]>(
        "/departments?limit=200",
      ),
    ]).then(
      ([r, b, d]) => {
        setReport(r);
        setBudgets(b);
        setDepartments(Array.isArray(d) ? d : d.items);
      },
      (e) => setError(errorText(e)),
    );
  }, [year]);
  useEffect(() => {
    setGrid(null);
    load();
  }, [load]);

  const startEdit = () => {
    const g: Grid = {};
    for (const d of [...departments.map((x) => x.id), NONE]) g[d] = { headcount: empty12(), cost: empty12() };
    for (const b of budgets.filter((x) => !x.jobId)) {
      const row = g[b.departmentId ?? NONE];
      if (!row) continue;
      row.headcount[b.month - 1] = String(Number(b.headcount));
      row.cost[b.month - 1] = b.cost === null ? "" : String(Number(b.cost));
    }
    setGrid(g);
  };
  const setCell = (dept: string, i: number, v: string) =>
    setGrid((g) => {
      if (!g) return g;
      const row = { ...g[dept]!, [field]: g[dept]![field].map((x, j) => (j === i ? v : x)) };
      return { ...g, [dept]: row };
    });
  const fillRight = (dept: string) =>
    setGrid((g) => {
      if (!g) return g;
      const first = g[dept]![field][0] ?? "";
      return { ...g, [dept]: { ...g[dept]!, [field]: g[dept]![field].map(() => first) } };
    });

  const save = async () => {
    if (!grid) return;
    setBusy(true);
    setError(null);
    try {
      // Baris per jabatan (dari impor) dipertahankan; editor mengatur baris per departemen.
      const lines = [
        ...budgets.filter((b) => b.jobId).map((b) => ({ ...b, cost: b.cost ?? "0" })),
        ...Object.entries(grid).flatMap(([dept, row]) =>
          row.headcount.flatMap((hc, i) =>
            hc || row.cost[i]
              ? [
                  {
                    departmentId: dept === NONE ? null : dept,
                    month: i + 1,
                    headcount: hc || "0",
                    cost: row.cost[i] || "0",
                  },
                ]
              : [],
          ),
        ),
      ];
      await api(`/manpower-budgets?year=${year}`, { method: "PUT", body: { lines } });
      setGrid(null);
      setNotice(l("Anggaran disimpan.", "Budget saved."));
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const body = /\.xlsx$/i.test(f.name) ? { xlsx: await toBase64(f) } : { csv: await f.text() };
      const r = await api<{ imported: number }>(`/manpower-budgets/import?year=${year}`, {
        method: "POST",
        body,
      });
      setNotice(l(`${r.imported} baris anggaran diimpor.`, `${r.imported} budget lines imported.`));
      setGrid(null);
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  const deptName = (id: string) =>
    id === NONE ? l("Tanpa departemen", "No department") : (departments.find((d) => d.id === id)?.name ?? id);
  const totals = report?.months;

  return (
    <div className="stack-wide">
      <section className="panel">
        <header className="toolbar">
          <h1>{l("Anggaran Tenaga Kerja", "Manpower Budget")}</h1>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label={l("Tahun", "Year")}
          >
            {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() + 1 - i).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() =>
              download(
                `/manpower-budgets/report?year=${year}&format=xlsx`,
                undefined,
                `anggaran-${year}.xlsx`,
              ).catch((e: Error) => setError(e.message))
            }
          >
            {l("Ekspor Excel", "Export Excel")}
          </button>
          {canEdit && !grid && (
            <>
              <button type="button" onClick={startEdit} disabled={!report}>
                {l("Ubah anggaran", "Edit budget")}
              </button>
              <button
                type="button"
                onClick={() =>
                  download(
                    `/manpower-budgets/template?year=${year}`,
                    undefined,
                    `anggaran-${year}.xlsx`,
                  ).catch((e: Error) => setError(e.message))
                }
              >
                {l("Template", "Template")}
              </button>
              <button type="button" disabled={busy} onClick={() => file.current?.click()}>
                {l("Impor…", "Import…")}
              </button>
              <input
                ref={file}
                type="file"
                hidden
                accept=".xlsx,.csv"
                onChange={(e) => void upload(e.target.files?.[0])}
              />
            </>
          )}
        </header>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="muted">{notice}</p>}
        {budgets.some((b) => b.sourcePlanId) && (
          <p className="muted">
            <span className="pill ok">{l("Dari MPP", "From MPP")}</span>{" "}
            {l(
              "Departemen dengan Man Power Planning yang disetujui diisi otomatis dari MPP; perubahan untuk departemen itu sebaiknya lewat revisi MPP.",
              "Departments with an approved manpower plan are filled from the plan; change them by revising the plan.",
            )}{" "}
            <Link href={`/hr/manpower-plans?year=${year}`}>Man Power Planning</Link>
          </p>
        )}
        {report && totals && (
          <ul className="grid">
            {(() => {
              const cur = [...totals].reverse().find((m) => m.actualHeadcount !== null);
              const planned = report.rows.reduce((s, r) => s + (r.plannedCost ?? 0), 0);
              const actual = report.rows.reduce((s, r) => s + (r.actualCost ?? 0), 0);
              const vacancies = report.rows.reduce((s, r) => s + r.openVacancies, 0);
              return [
                [
                  l("Rencana headcount (bulan ini)", "Planned headcount (this month)"),
                  nf(cur?.plannedHeadcount ?? 0),
                ],
                [l("Aktual headcount", "Actual headcount"), nf(cur?.actualHeadcount ?? 0)],
                [l("Lowongan terbuka", "Open vacancies"), nf(vacancies)],
                ...(report.showCost
                  ? [
                      [l("Rencana biaya setahun", "Planned annual cost"), money(planned, locale)],
                      [l("Aktual biaya s.d. kini", "Actual cost to date"), money(actual, locale)],
                    ]
                  : []),
              ].map(([label, value]) => (
                <li key={label} className="card">
                  <span>{label}</span>
                  <strong>{value}</strong>
                </li>
              ));
            })()}
          </ul>
        )}
      </section>

      {grid && (
        <section className="panel proj-panel">
          <header className="toolbar">
            <h2>{l(`Ubah anggaran ${year}`, `Edit ${year} budget`)}</h2>
            <div className="segmented" role="group">
              <button
                type="button"
                aria-pressed={field === "headcount"}
                onClick={() => setField("headcount")}
              >
                Headcount
              </button>
              {report?.showCost && (
                <button type="button" aria-pressed={field === "cost"} onClick={() => setField("cost")}>
                  {l("Biaya (Rp)", "Cost (Rp)")}
                </button>
              )}
            </div>
            <button type="button" className="primary" disabled={busy} onClick={save}>
              {l("Simpan", "Save")}
            </button>
            <button type="button" onClick={() => setGrid(null)}>
              {l("Batal", "Cancel")}
            </button>
          </header>
          <p className="muted">
            {l(
              "Headcount = rencana jumlah karyawan di akhir bulan; biaya = gaji + BPJS perusahaan bulan itu. ⇥ menyalin bulan Januari ke semua bulan.",
              "Headcount = planned employees at month end; cost = pay + employer BPJS for the month. ⇥ copies January to every month.",
            )}
          </p>
          <div className="table-wrap">
            <table className="budget-grid">
              <thead>
                <tr>
                  <th>{l("Departemen", "Department")}</th>
                  {labels.map((m) => (
                    <th key={m} className="num">
                      {m}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {Object.keys(grid).map((dept) => (
                  <tr key={dept}>
                    <td>{deptName(dept)}</td>
                    {grid[dept]![field].map((v, i) => (
                      <td key={i}>
                        <input
                          inputMode="decimal"
                          aria-label={`${deptName(dept)} ${labels[i]}`}
                          value={v}
                          onChange={(e) => setCell(dept, i, e.target.value.replace(/[^\d.]/g, ""))}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        type="button"
                        className="link"
                        title={l("Salin Januari ke semua bulan", "Copy January to all months")}
                        onClick={() => fillRight(dept)}
                      >
                        ⇥
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {report && totals && !grid && (
        <>
          <div className="grid-2">
            <section className="panel">
              <h2>{l("Headcount: rencana vs aktual", "Headcount: plan vs actual")}</h2>
              <BarChart
                ariaLabel={l(
                  "Headcount rencana dan aktual per bulan",
                  "Planned and actual headcount by month",
                )}
                labels={labels}
                empty={l("Belum ada anggaran maupun karyawan.", "No budget or employees yet.")}
                series={[
                  {
                    key: "plan",
                    label: l("Rencana", "Plan"),
                    slot: 1,
                    values: totals.map((m) => m.plannedHeadcount),
                  },
                  {
                    key: "actual",
                    label: l("Aktual", "Actual"),
                    slot: 2,
                    values: totals.map((m) => m.actualHeadcount ?? 0),
                  },
                ]}
              />
            </section>
            {report.showCost && (
              <section className="panel">
                <h2>{l("Biaya: rencana vs aktual", "Cost: plan vs actual")}</h2>
                <BarChart
                  ariaLabel={l("Biaya rencana dan aktual per bulan", "Planned and actual cost by month")}
                  labels={labels}
                  empty={l(
                    "Belum ada anggaran biaya maupun payroll terposting.",
                    "No cost budget or posted payroll yet.",
                  )}
                  format={(v) =>
                    new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US", {
                      notation: "compact",
                      maximumFractionDigits: 1,
                    }).format(v)
                  }
                  series={[
                    {
                      key: "plan",
                      label: l("Rencana", "Plan"),
                      slot: 1,
                      values: totals.map((m) => m.plannedCost ?? 0),
                    },
                    {
                      key: "actual",
                      label: l("Aktual", "Actual"),
                      slot: 2,
                      values: totals.map((m) => m.actualCost ?? 0),
                    },
                  ]}
                />
              </section>
            )}
          </div>
          <section className="panel proj-panel">
            <h2>{l("Per departemen", "By department")}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{l("Departemen", "Department")}</th>
                    <th className="num">{l("Rencana HC", "Plan HC")}</th>
                    <th className="num">{l("Aktual HC", "Actual HC")}</th>
                    <th className="num">{l("Selisih", "Variance")}</th>
                    <th className="num">{l("Lowongan", "Vacancies")}</th>
                    {report.showCost && (
                      <>
                        <th className="num">{l("Rencana biaya", "Plan cost")}</th>
                        <th className="num">{l("Aktual biaya", "Actual cost")}</th>
                        <th className="num">{l("Selisih biaya", "Cost variance")}</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.department}>
                      <td>{r.department}</td>
                      <td className="num">{nf(r.current.plannedHeadcount)}</td>
                      <td className="num">{nf(r.current.actualHeadcount)}</td>
                      <td className="num">
                        <span
                          className={`pill ${r.current.variance.diff === 0 ? "ok" : r.current.variance.diff > 0 ? "bad" : "warn"}`}
                        >
                          {diffText(r.current.variance)}
                        </span>
                      </td>
                      <td className="num">{r.openVacancies || "—"}</td>
                      {report.showCost && (
                        <>
                          <td className="num">{money(r.plannedCost ?? 0, locale)}</td>
                          <td className="num">{money(r.actualCost ?? 0, locale)}</td>
                          <td className="num">{diffText(r.costVariance, (v) => money(v, locale))}</td>
                        </>
                      )}
                    </tr>
                  ))}
                  {!report.rows.length && (
                    <tr>
                      <td colSpan={report.showCost ? 8 : 5} className="muted">
                        {l(
                          "Belum ada anggaran. Klik “Ubah anggaran” atau impor dari Excel.",
                          "No budget yet. Click “Edit budget” or import from Excel.",
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="muted">
              {l(
                "Headcount = rencana & aktual di akhir bulan terakhir yang sudah berjalan. Biaya setahun: aktual dari slip payroll terposting (gaji + BPJS perusahaan).",
                "Headcount = plan & actual at the end of the latest elapsed month. Annual cost: actual from posted payslips (pay + employer BPJS).",
              )}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
