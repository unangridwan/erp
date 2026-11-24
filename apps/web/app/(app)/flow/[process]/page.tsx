"use client";

import { recordHref, type FlowDef, type FlowStatus, type FlowSummary, type FlowWorkItem } from "@erp/shared";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { FlowDiagram, type StageView } from "../../../../components/flow/flow-diagram";
import { FlowTrace } from "../../../../components/flow/flow-trace";
import { PeriodFilter, usePeriod, type FlowPreset } from "../../../../components/flow/period";
import { HBarList } from "../../../../components/hr/charts";
import { LoadFailed, useLoadError } from "../../../../components/load-failed";
import { api } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Detail {
  process: string;
  definition: FlowDef;
  summary: Omit<FlowSummary, "stages"> & { stages: StageView[] };
  today: string;
}

const PARTNER_LABEL: Record<string, [string, string]> = {
  o2c: ["Pelanggan", "Customer"],
  p2p: ["Pemasok", "Supplier"],
  mfg: ["Produk", "Product"],
  h2p: ["Lowongan", "Opening"],
};

/** Detail satu proses: rantai input → outcome, diagram tahap, lama per tahap, konversi, pemegang, dan dokumennya. */
export default function FlowProcessPage() {
  const { process } = useParams<{ process: string }>();
  const search = useSearchParams();
  const { l, locale } = useI18n();
  const initial = search.get("from") && search.get("to");
  const [preset, setPreset] = useState<FlowPreset>(initial ? "custom" : "this_year");
  const [custom, setCustom] = useState({ from: search.get("from") ?? "", to: search.get("to") ?? "" });
  const period = usePeriod(preset, custom);
  const [department, setDepartment] = useState("");
  const [user, setUser] = useState("");
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<Detail | null>(null);
  const [error, fail] = useLoadError();
  const [stage, setStage] = useState<string | null>(null);
  const [status, setStatus] = useState<FlowStatus | "">("");
  const [list, setList] = useState<{ items: FlowWorkItem[]; total: number } | null>(null);
  const [trace, setTrace] = useState<{ model: FlowWorkItem["model"]; id: string } | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (!period.invalid) {
      p.set("from", period.from);
      p.set("to", period.to);
    }
    if (department) p.set("department", department);
    if (user) p.set("user", user);
    return p.toString();
  }, [period.from, period.to, period.invalid, department, user]);

  useEffect(() => {
    api<{ items: { id: string; name: string }[] } | { id: string; name: string }[]>(
      "/departments?limit=200",
    ).then(
      (r) => setDepartments(Array.isArray(r) ? r : r.items),
      () => setDepartments([]),
    );
  }, []);
  useEffect(() => {
    if (period.invalid) return;
    setData(null);
    api<Detail>(`/flow/${process}?${qs}`).then(setData).catch(fail);
  }, [process, qs, period.invalid, fail]);
  useEffect(() => {
    if (!stage || period.invalid) return setList(null);
    setList(null);
    api<{ items: FlowWorkItem[]; total: number }>(
      `/flow/${process}/stage/${stage}?${qs}${status ? `&status=${status}` : ""}`,
    ).then(setList, () => setList({ items: [], total: 0 }));
  }, [process, stage, status, qs, period.invalid]);

  if (error) return <LoadFailed message={error} />;
  const def = data?.definition;
  const s = data?.summary;
  const last = def?.stages[def.stages.length - 1]!.key;
  const byKey = new Map(s?.stages.map((x) => [x.key, x]) ?? []);
  const first = def ? byKey.get(def.stages[0]!.key) : undefined;
  const output = def ? byKey.get(def.outputStage) : undefined;
  const stageDef = def?.stages.find((x) => x.key === stage);
  const fmtValue = (v: number | null) => (v === null || !def?.valueLabel ? "—" : money(v, locale, 0));

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <nav className="breadcrumb">
            <Link href="/flow">{l("Alur Bisnis", "Business Flow")}</Link>
            <span>/</span>
            <h1>{def ? l(...def.label) : "…"}</h1>
          </nav>
        </div>
        <div className="cp-right flow-filters">
          <PeriodFilter preset={preset} custom={custom} onPreset={setPreset} onCustom={setCustom} />
          {departments.length > 0 && (
            <select
              aria-label={l("Departemen", "Department")}
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              <option value="">{l("Semua departemen", "All departments")}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          {s && s.owners.some((o) => o.ownerId) && (
            <select
              aria-label={l("Pemegang", "Owner")}
              value={user}
              onChange={(e) => setUser(e.target.value)}
            >
              <option value="">{l("Semua orang", "Everyone")}</option>
              {s.owners
                .filter((o) => o.ownerId)
                .map((o) => (
                  <option key={o.ownerId} value={o.ownerId!}>
                    {o.owner}
                  </option>
                ))}
            </select>
          )}
        </div>
      </header>
      {def && <p className="muted">{l(...def.description)}</p>}
      {period.invalid && (
        <p className="muted">{l("Isi rentang tanggal yang valid.", "Enter a valid date range.")}</p>
      )}
      {!data && !period.invalid && <p className="muted">{l("Memuat…", "Loading…")}</p>}
      {def && s && (
        <>
          <ol
            className="flow-chain wide"
            aria-label={l("Rantai input sampai outcome", "Input to outcome chain")}
          >
            <li>
              <span className="muted small">Input</span>
              <strong>{first?.reached ?? 0}</strong>
              <span className="small">{l(...def.chain.input)}</span>
            </li>
            <li>
              <span className="muted small">{l("Proses", "Process")}</span>
              <strong>{s.wip.count}</strong>
              <span className="small">
                {l(...def.chain.process)}
                {s.wip.late > 0 && (
                  <>
                    {" "}
                    ·{" "}
                    <span className="badge danger">
                      {s.wip.late} {l("terlambat", "late")}
                    </span>
                  </>
                )}
              </span>
            </li>
            <li>
              <span className="muted small">Output</span>
              <strong>{output?.reached ?? 0}</strong>
              <span className="small">
                {l(...def.chain.output)}
                {output?.reachedPct !== null &&
                  output?.reachedPct !== undefined &&
                  ` · ${output.reachedPct.toLocaleString(locale === "id" ? "id-ID" : "en-US")}%`}
              </span>
            </li>
            <li>
              <span className="muted small">Outcome</span>
              <strong>{s.completed.count}</strong>
              <span className="small">
                {l(...def.chain.outcome)}
                {def.valueLabel && s.completed.value > 0 && ` · ${money(s.completed.value, locale, 0)}`}
              </span>
            </li>
          </ol>
          <p className="muted small">
            {l(
              "Input/Output/Outcome dihitung dari dokumen yang dimulai dalam periode (kohort); Proses = dokumen yang sedang berjalan saat ini. Persen di panah = bagian kohort yang sampai ke tahap itu.",
              "Input/Output/Outcome count documents started in the period (cohort); Process = documents currently in progress. Arrow percentages = share of the cohort reaching that stage.",
            )}
          </p>

          <FlowDiagram
            def={def}
            summary={s as FlowSummary}
            stages={s.stages}
            selected={stage}
            onSelect={(k) => setStage(stage === k ? null : k)}
          />

          {stage && stageDef && (
            <section className="panel flow-stage-list" aria-label={l(...stageDef.label)}>
              <header className="flow-stage-head">
                <h2>
                  {l(...stageDef.label)} {list && <span className="badge">{list.total}</span>}
                </h2>
                {stage !== last && (
                  <div className="tabs" role="tablist">
                    {(
                      [
                        ["", l("Semua", "All")],
                        ["late", l("Terlambat", "Late")],
                        ["at_risk", l("Berisiko", "At risk")],
                        ["on_time", l("Tepat waktu", "On time")],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        role="tab"
                        aria-selected={status === k}
                        className={status === k ? "active" : ""}
                        onClick={() => setStatus(k)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <button type="button" className="link" onClick={() => setStage(null)}>
                  {l("Tutup", "Close")}
                </button>
              </header>
              {!list && <p className="muted">{l("Memuat…", "Loading…")}</p>}
              {list && !list.items.length && (
                <p className="muted">{l("Tidak ada dokumen.", "No documents.")}</p>
              )}
              {list && list.items.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{l("Dokumen", "Document")}</th>
                        <th>{l(...(PARTNER_LABEL[process] ?? ["Mitra", "Partner"]))}</th>
                        <th>{l("Pemegang", "Owner")}</th>
                        <th>{l("Departemen", "Department")}</th>
                        <th>{stage === last ? l("Selesai", "Completed") : l("Masuk tahap", "Since")}</th>
                        <th className="num">
                          {stage === last
                            ? l("Siklus (hari)", "Cycle (days)")
                            : l("Umur (hari)", "Age (days)")}
                        </th>
                        {stage !== last && <th>{l("Batas", "Due")}</th>}
                        {stage !== last && <th>{l("Status", "Status")}</th>}
                        {def.valueLabel && <th className="num">{l(...def.valueLabel)}</th>}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {list.items.map((w) => {
                        const href = w.href ?? recordHref(w.model, w.id);
                        return (
                          <tr key={w.id} className={w.status === "late" ? "row-late" : undefined}>
                            <td>{href ? <Link href={href}>{w.name}</Link> : w.name}</td>
                            <td>{w.partner ?? "—"}</td>
                            <td>{w.owner ?? "—"}</td>
                            <td>{w.department ?? "—"}</td>
                            <td>{formatDate(w.since.slice(0, 10), locale)}</td>
                            <td className="num">{w.ageDays}</td>
                            {stage !== last && <td>{w.due ? formatDate(w.due, locale) : "—"}</td>}
                            {stage !== last && (
                              <td>
                                <span
                                  className={`badge ${w.status === "late" ? "danger" : w.status === "at_risk" ? "warn" : "ok"}`}
                                >
                                  {w.status === "late"
                                    ? l("Terlambat", "Late")
                                    : w.status === "at_risk"
                                      ? l("Berisiko", "At risk")
                                      : l("Tepat waktu", "On time")}
                                </span>
                              </td>
                            )}
                            {def.valueLabel && <td className="num">{fmtValue(w.value)}</td>}
                            <td>
                              {!w.href && (
                                <button
                                  type="button"
                                  className="link"
                                  onClick={() => setTrace({ model: w.model, id: w.id })}
                                >
                                  {l("Jejak", "Trace")}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {list.total > list.items.length && (
                    <p className="muted small">
                      {l(
                        `Menampilkan ${list.items.length} dari ${list.total}.`,
                        `Showing ${list.items.length} of ${list.total}.`,
                      )}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          <div className="grid-2 flow-insights">
            <section className="panel">
              <h2>{l("Lama di tiap tahap (rata-rata hari)", "Time in each stage (average days)")}</h2>
              <p className="muted small">
                {l(
                  "Dokumen yang keluar dari tahap itu dalam periode. Makin panjang, makin lambat.",
                  "Documents that left the stage in the period. Longer bars are slower.",
                )}
              </p>
              <HBarList
                rows={s.stages
                  .filter((x) => x.key !== last)
                  .map((x) => ({ label: l(...x.label), value: x.avgDays ?? 0 }))}
                format={(v) => l(`${v.toLocaleString("id-ID")} hari`, `${v.toLocaleString("en-US")} days`)}
              />
            </section>
            <section className="panel">
              <h2>{l("Konversi kohort periode", "Period cohort conversion")}</h2>
              <p className="muted small">
                {l(
                  `Dari ${first?.reached ?? 0} dokumen yang dimulai di periode, berapa persen sampai ke tiap tahap.`,
                  `Of ${first?.reached ?? 0} documents started in the period, the share reaching each stage.`,
                )}
              </p>
              <HBarList
                rows={s.stages
                  .filter((x) => !def.stages.find((d) => d.key === x.key)?.optional)
                  .map((x) => ({ label: l(...x.label), value: x.reachedPct ?? 0 }))}
                format={(v) => `${v.toLocaleString(locale === "id" ? "id-ID" : "en-US")}%`}
              />
            </section>
          </div>

          <div className="grid-2 flow-insights">
            <section className="panel">
              <h2>{l("Siapa memegang pekerjaan", "Who holds the work")}</h2>
              {s.owners.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{l("Orang", "Person")}</th>
                        <th>{l("Departemen", "Department")}</th>
                        <th className="num">{l("Berjalan", "In progress")}</th>
                        <th className="num">{l("Terlambat", "Late")}</th>
                        {def.valueLabel && <th className="num">{l("Nilai", "Value")}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {s.owners.map((o, i) => (
                        <tr key={i}>
                          <td>
                            {o.ownerId ? (
                              <button type="button" className="link" onClick={() => setUser(o.ownerId!)}>
                                {o.owner}
                              </button>
                            ) : (
                              <span className="muted">{l("Tanpa pemegang", "Unassigned")}</span>
                            )}
                          </td>
                          <td>{o.department ?? "—"}</td>
                          <td className="num">{o.count}</td>
                          <td className="num">
                            {o.late ? <span className="badge danger">{o.late}</span> : 0}
                          </td>
                          {def.valueLabel && <td className="num">{money(o.value, locale, 0)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">{l("Tidak ada pekerjaan berjalan.", "No work in progress.")}</p>
              )}
            </section>
            <section className="panel">
              <h2>{l("Per departemen", "By department")}</h2>
              {s.departments.length ? (
                <HBarList
                  rows={s.departments.map((d) => ({
                    label: d.department === "—" ? l("Tanpa departemen", "No department") : d.department,
                    value: d.count,
                  }))}
                />
              ) : (
                <p className="muted">{l("Tidak ada pekerjaan berjalan.", "No work in progress.")}</p>
              )}
              <p className="muted small">
                {l(
                  "Departemen diambil dari data karyawan pemegang dokumen. Atur departemen penanggung jawab & SLA tiap tahap di Pengaturan SLA.",
                  "Departments come from the document owner's employee record. Set each stage's responsible department & SLA under SLA settings.",
                )}{" "}
                <Link href="/flow/settings">{l("Pengaturan SLA", "SLA settings")}</Link>
              </p>
            </section>
          </div>
        </>
      )}
      {trace && <FlowTrace model={trace.model} id={trace.id} onClose={() => setTrace(null)} />}
    </>
  );
}
