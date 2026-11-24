"use client";

import { businessToday, type KpiBetter, type KpiUnit } from "@erp/shared";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RAG_LABEL } from "../../../../components/hr/ess-panels";
import { api, ApiError } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

type Rag = "green" | "amber" | "red";
interface ScGoal {
  id: string;
  parentId: string | null;
  title: string;
  owner: { kind: "company" | "department" | "employee"; name: string };
  kpi: { code: string; label: [string, string]; unit: KpiUnit } | null;
  metric: "percent" | "number" | "currency" | "boolean";
  unit: string | null;
  targetValue: number;
  currentValue: number;
  periodFrom: string | null;
  periodTo: string | null;
  dueDate: string | null;
  state: string;
  progress: number;
  expected: number;
  rag: Rag;
}
interface ScKpi {
  code: string;
  label: [string, string];
  area: [string, string];
  unit: KpiUnit;
  better: KpiBetter;
  value: number | null;
  previous: number | null;
  change: number | null;
}
interface Stats {
  count: number;
  late: number;
  atRisk: number;
  avgAge: number | null;
}
interface Scorecard {
  scope: "company" | "department" | "me";
  linked: boolean;
  title: string;
  from: string;
  to: string;
  achievement: number | null;
  rag: Record<Rag, number>;
  goals: ScGoal[];
  kpis: ScKpi[];
  flow: {
    processes?: {
      process: string;
      label: [string, string];
      wip: number;
      late: number;
      completed: number;
      cycleMedian: number | null;
      bottleneck: [string, string] | null;
    }[];
    waiting?: Stats;
    handedOver?: Stats;
    held?: Stats;
  };
}
interface DeptRow {
  id: string;
  name: string;
  members: number;
  goals: number;
  achievement: number | null;
  rag: Record<Rag, number>;
  waiting: number;
  late: number;
  onTimePct: number | null;
  avgAge: number | null;
  handedOver: number;
  handedOverLate: number;
}

type Preset = "year" | "quarter" | "month";
function range(p: Preset) {
  const t = businessToday();
  const y = Number(t.slice(0, 4));
  const m = Number(t.slice(5, 7));
  const iso = (yy: number, mm: number, dd: number) =>
    new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  if (p === "month") return { from: iso(y, m, 1), to: iso(y, m + 1, 0) };
  if (p === "quarter") {
    const q = Math.floor((m - 1) / 3) * 3 + 1;
    return { from: iso(y, q, 1), to: iso(y, q + 3, 0) };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

/**
 * Scorecard: capaian sasaran berjenjang (perusahaan → departemen → karyawan) menurut laju, KPI cakupan dibanding
 * periode lalu, dan metrik proses (beban, keterlambatan, serah terima) — berdampingan untuk rapat manajemen.
 */
export default function ScorecardPage() {
  const { l, locale } = useI18n();
  const [preset, setPreset] = useState<Preset>("year");
  const period = useMemo(() => range(preset), [preset]);
  const [scope, setScope] = useState<"company" | "department" | "me">("company");
  const [department, setDepartment] = useState("");
  const [data, setData] = useState<Scorecard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [depts, setDepts] = useState<DeptRow[] | null>(null);

  useEffect(() => {
    api<{ items: DeptRow[] }>(`/scorecard/departments?from=${period.from}&to=${period.to}`).then(
      (r) => {
        setDepts(r.items);
        setDepartment((d) => d || r.items[0]?.id || "");
      },
      () => setDepts([]),
    );
  }, [period.from, period.to]);
  useEffect(() => {
    if (scope === "department" && !department) return;
    setData(null);
    setError(null);
    const id = scope === "department" ? `&id=${department}` : "";
    api<Scorecard>(`/scorecard?scope=${scope}${id}&from=${period.from}&to=${period.to}`).then(setData, (e) =>
      setError(e instanceof ApiError ? e.message : String(e)),
    );
  }, [scope, department, period.from, period.to]);

  const n = (v: number | null, digits = 0) =>
    v === null
      ? "—"
      : v.toLocaleString(locale === "id" ? "id-ID" : "en-US", { maximumFractionDigits: digits });
  const kpiFmt = (unit: KpiUnit, v: number | null) =>
    v === null ? "—" : unit === "money" ? money(v, locale, 0) : unit === "percent" ? `${n(v, 1)}%` : n(v);
  const goalFmt = (g: ScGoal, v: number) =>
    g.metric === "currency" ? money(v, locale, 0) : g.metric === "percent" ? `${n(v, 1)}%` : n(v, 2);

  const ids = new Set(data?.goals.map((g) => g.id) ?? []);
  const roots = data?.goals.filter((g) => !g.parentId || !ids.has(g.parentId)) ?? [];
  const kids = (id: string) => data?.goals.filter((g) => g.parentId === id) ?? [];
  const goalRow = (g: ScGoal, depth: number): ReactNode => (
    <li key={g.id}>
      <div className="goal-row sc-goal" style={{ paddingLeft: depth * 18 }}>
        <div className="goal-title">
          <span
            className={`rag-dot rag-${g.rag}`}
            title={`${l(...RAG_LABEL[g.rag])} · ${l("seharusnya", "expected")} ${g.expected}%`}
            aria-label={l(...RAG_LABEL[g.rag])}
          />
          <strong>{g.title}</strong>
          <small className="muted">
            {" "}
            ·{" "}
            {g.owner.kind === "company"
              ? l("Perusahaan", "Company")
              : g.owner.kind === "department"
                ? `${l("Dept.", "Dept.")} ${g.owner.name}`
                : g.owner.name}
          </small>
          {g.kpi && <span className="badge goal-kpi">KPI: {l(...g.kpi.label)}</span>}
        </div>
        <div
          className="goal-progress"
          title={`${g.progress}% · ${l("seharusnya", "expected")} ${g.expected}%`}
        >
          <span style={{ width: `${g.progress}%` }} className={`rag-${g.rag}`} />
          {g.expected > 0 && g.expected < 100 && <i style={{ left: `${g.expected}%` }} aria-hidden="true" />}
        </div>
        <span className="goal-pct">{n(g.progress, 1)}%</span>
        <span className="goal-value muted">
          {goalFmt(g, g.currentValue)} / {goalFmt(g, g.targetValue)}
        </span>
      </div>
      {kids(g.id).length > 0 && <ul className="goal-tree">{kids(g.id).map((k) => goalRow(k, depth + 1))}</ul>}
    </li>
  );
  const stat = (label: string, s: Stats | undefined, href?: string) =>
    s && (
      <div className="sc-stat">
        <span className="muted small">{label}</span>
        <strong>{n(s.count)}</strong>
        <span className="flow-badges">
          {s.late > 0 && (
            <span className="badge danger">
              {s.late} {l("terlambat", "late")}
            </span>
          )}
          {s.atRisk > 0 && (
            <span className="badge warn">
              {s.atRisk} {l("berisiko", "at risk")}
            </span>
          )}
        </span>
        {s.avgAge !== null && (
          <span className="muted small">
            {l(`Umur rata-rata ${n(s.avgAge, 1)} hari`, `Average age ${n(s.avgAge, 1)} days`)}
          </span>
        )}
        {href && (
          <Link className="small" href={href}>
            {l("Buka papan serah terima →", "Open the handoff board →")}
          </Link>
        )}
      </div>
    );

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <nav className="breadcrumb">
            <Link href="/flow">{l("Alur Bisnis", "Business Flow")}</Link>
            <span>/</span>
            <h1>{l("Scorecard", "Scorecard")}</h1>
          </nav>
        </div>
        <div className="cp-right">
          <div className="tabs" role="tablist" aria-label={l("Periode", "Period")}>
            {(
              [
                ["year", l("Tahun ini", "This year")],
                ["quarter", l("Kuartal ini", "This quarter")],
                ["month", l("Bulan ini", "This month")],
              ] as [Preset, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={preset === k}
                className={preset === k ? "active" : ""}
                onClick={() => setPreset(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <p className="muted">
        {l(
          "Capaian sasaran dinilai menurut laju: hijau bila capaian ≥ 90% dari yang semestinya tercapai pada titik waktu ini, kuning ≥ 70%, merah di bawahnya. Garis tipis pada bilah = posisi yang semestinya. Sasaran KPI otomatis dihitung dari data transaksi.",
          "Goals are rated by pace: green when progress is ≥ 90% of where it should be by now, amber ≥ 70%, red below. The thin line on each bar marks where it should be. Automatic KPI goals are computed from transactions.",
        )}
      </p>
      <div className="sc-scope">
        <div className="tabs" role="tablist" aria-label={l("Cakupan", "Scope")}>
          {(
            [
              ["company", l("Perusahaan", "Company")],
              ["department", l("Departemen", "Department")],
              ["me", l("Saya", "Me")],
            ] as ["company" | "department" | "me", string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={scope === k}
              className={scope === k ? "active" : ""}
              onClick={() => setScope(k)}
            >
              {label}
            </button>
          ))}
        </div>
        {scope === "department" && (
          <select
            aria-label={l("Departemen", "Department")}
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            {depts?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="muted">{error}</p>}
      {!data && !error && <p className="muted">{l("Memuat…", "Loading…")}</p>}
      {data && !data.linked && (
        <p className="muted">
          {l(
            "Akun Anda belum terhubung ke data karyawan, jadi belum ada sasaran pribadi. Minta HR menautkan akun Anda di data karyawan.",
            "Your account is not linked to an employee record yet, so there are no personal goals. Ask HR to link your account on your employee record.",
          )}
        </p>
      )}
      {data && data.linked && (
        <>
          <section className="sc-summary" aria-label={l("Ringkasan", "Summary")}>
            <div className="sc-stat sc-main">
              <span className="muted small">
                {l("Capaian tertimbang", "Weighted achievement")}
                {data.title && ` · ${data.title}`}
              </span>
              <strong>{data.achievement === null ? "—" : `${n(data.achievement, 1)}%`}</strong>
              <span className="muted small">
                {formatDate(data.from, locale)} – {formatDate(data.to, locale)}
              </span>
            </div>
            {(["green", "amber", "red"] as Rag[]).map((r) => (
              <div key={r} className={`sc-stat sc-${r}`}>
                <span className="muted small">
                  <span className={`rag-dot rag-${r}`} aria-hidden="true" />
                  {l(...RAG_LABEL[r])}
                </span>
                <strong>{data.rag[r]}</strong>
                <span className="muted small">{l("sasaran", "goals")}</span>
              </div>
            ))}
          </section>

          <section className="panel handoff-panel">
            <h2>{l("Sasaran", "Goals")}</h2>
            {data.goals.length ? (
              <ul className="goal-tree">{roots.map((g) => goalRow(g, 0))}</ul>
            ) : (
              <p className="muted">
                {l(
                  "Belum ada sasaran aktif di periode ini. Buat sasaran (termasuk KPI otomatis) di SDM › Sasaran & KRA.",
                  "No active goals in this period. Create goals (including automatic KPIs) in HR › Goals & KRAs.",
                )}{" "}
                <Link href="/hr/goals">{l("Buka Sasaran →", "Open Goals →")}</Link>
              </p>
            )}
          </section>

          {data.kpis.length > 0 && (
            <section className="work-section">
              <h2>{l("KPI cakupan", "Scope KPIs")}</h2>
              <div className="kpi-grid">
                {data.kpis.map((k) => {
                  const tone =
                    k.better === "neutral" || !k.change
                      ? ""
                      : k.change > 0 === (k.better === "up")
                        ? "ok"
                        : "danger";
                  return (
                    <article key={k.code} className="kpi-card">
                      <header>
                        <span className="muted small">{l(...k.area)}</span>
                        <h3>{l(...k.label)}</h3>
                      </header>
                      <strong className="kpi-value">{kpiFmt(k.unit, k.value)}</strong>
                      <div className="kpi-compare">
                        {k.change !== null && (
                          <span className={`badge ${tone}`}>
                            {k.change > 0 ? "▲" : k.change < 0 ? "▼" : "■"} {n(Math.abs(k.change), 1)}%
                          </span>
                        )}
                        <span className="muted small">
                          {l("Periode lalu", "Last period")}: {kpiFmt(k.unit, k.previous)}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          <section className="work-section">
            <h2>{l("Proses", "Process")}</h2>
            {data.flow.processes ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{l("Proses", "Process")}</th>
                      <th className="num">{l("Berjalan", "In progress")}</th>
                      <th className="num">{l("Terlambat", "Late")}</th>
                      <th className="num">{l("Selesai di periode", "Completed")}</th>
                      <th className="num">{l("Siklus median (hari)", "Median cycle (days)")}</th>
                      <th>{l("Penghambat", "Bottleneck")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.flow.processes.map((p) => (
                      <tr key={p.process} className={p.late ? "row-late" : undefined}>
                        <td>
                          <Link href={`/flow/${p.process}`}>{l(...p.label)}</Link>
                        </td>
                        <td className="num">{n(p.wip)}</td>
                        <td className="num">{n(p.late)}</td>
                        <td className="num">{n(p.completed)}</td>
                        <td className="num">{n(p.cycleMedian, 1)}</td>
                        <td>{p.bottleneck ? l(...p.bottleneck) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="sc-summary">
                {stat(
                  l("Menunggu di departemen ini", "Waiting in this department"),
                  data.flow.waiting,
                  "/flow/handoffs",
                )}
                {stat(
                  l("Diserahkan, menunggu di departemen lain", "Handed over, waiting elsewhere"),
                  data.flow.handedOver,
                )}
                {stat(l("Dokumen yang saya pegang", "Documents I hold"), data.flow.held)}
              </div>
            )}
          </section>
        </>
      )}

      {scope === "company" && depts && depts.length > 0 && (
        <section className="panel handoff-panel">
          <h2>{l("Scorecard departemen", "Department scorecard")}</h2>
          <p className="muted small">
            {l(
              "Sasaran departemen berdampingan dengan beban & ketepatan waktu pekerjaan yang menunggu di departemen itu serta yang sudah diserahkannya. Klik baris untuk melihat detail.",
              "Department goals side by side with the load & timeliness of work waiting in the department and work it has handed over. Click a row for details.",
            )}
          </p>
          <div className="table-wrap">
            <table className="sc-depts">
              <thead>
                <tr>
                  <th>{l("Departemen", "Department")}</th>
                  <th className="num">{l("Anggota", "Members")}</th>
                  <th className="num">{l("Sasaran", "Goals")}</th>
                  <th className="num">{l("Capaian", "Achievement")}</th>
                  <th>{l("Laju", "Pace")}</th>
                  <th className="num">{l("Menunggu", "Waiting")}</th>
                  <th className="num">{l("Terlambat", "Late")}</th>
                  <th className="num">{l("Tepat waktu", "On time")}</th>
                  <th className="num">{l("Umur rata-rata", "Avg. age")}</th>
                  <th className="num">{l("Diserahkan (terlambat)", "Handed over (late)")}</th>
                </tr>
              </thead>
              <tbody>
                {depts.map((d) => (
                  <tr
                    key={d.id}
                    className={d.late ? "row-late" : undefined}
                    tabIndex={0}
                    onClick={() => {
                      setDepartment(d.id);
                      setScope("department");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setDepartment(d.id);
                        setScope("department");
                      }
                    }}
                  >
                    <td>
                      <button type="button" className="link">
                        {d.name}
                      </button>
                    </td>
                    <td className="num">{n(d.members)}</td>
                    <td className="num">{n(d.goals)}</td>
                    <td className="num">{d.achievement === null ? "—" : `${n(d.achievement, 1)}%`}</td>
                    <td>
                      {(["green", "amber", "red"] as Rag[])
                        .filter((r) => d.rag[r])
                        .map((r) => (
                          <span key={r} className="sc-rag" title={l(...RAG_LABEL[r])}>
                            <span className={`rag-dot rag-${r}`} aria-hidden="true" />
                            {d.rag[r]}
                          </span>
                        ))}
                      {!d.goals && "—"}
                    </td>
                    <td className="num">{n(d.waiting)}</td>
                    <td className="num">{n(d.late)}</td>
                    <td className="num">{d.onTimePct === null ? "—" : `${n(d.onTimePct, 1)}%`}</td>
                    <td className="num">
                      {d.avgAge === null ? "—" : l(`${n(d.avgAge, 1)} hr`, `${n(d.avgAge, 1)} d`)}
                    </td>
                    <td className="num">
                      {n(d.handedOver)} ({n(d.handedOverLate)})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
