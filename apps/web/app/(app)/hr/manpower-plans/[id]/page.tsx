"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BarChart } from "../../../../../components/hr/charts";
import { errorText } from "../../../../../components/hr/hr-panels";
import {
  PLAN_STATE_LABEL,
  planStatePill,
  REALIZATION_LABEL,
  realizationPill,
  type PlanState,
  type Realization,
} from "../../../../../components/hr/manpower-plan";
import { api } from "../../../../../lib/api";
import { download } from "../../../../../lib/download";
import { money, parseNumberInput } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { ask } from "../../../../../components/feedback";

type Kind = "existing" | "new" | "replacement";
interface Line {
  id: string;
  jobId: string;
  gradeId: string | null;
  kind: Kind;
  quantity: number;
  startMonth: number;
  endMonth: number | null;
  monthlyWage: string | null;
  monthlyAllowance: string | null;
  reason: string | null;
  replacesEmployeeId: string | null;
  jobOpeningId: string | null;
  job: string | null;
  grade: string | null;
  replaces: string | null;
  opening: string | null;
  hired: number;
  applicants: number;
  realization: Realization | null;
}
interface Month {
  month: number;
  headcount: number;
  salary?: number;
  bpjsKes?: number;
  bpjsTk?: number;
  cost?: number;
}
interface Detail {
  id: string;
  name: string;
  year: number;
  department: string;
  state: PlanState;
  thrMonth: number | null;
  note: string | null;
  showCost: boolean;
  canEdit: boolean;
  canManage: boolean;
  lines: Line[];
  summary: {
    startHeadcount: number;
    endHeadcount: number;
    peakHeadcount: number;
    additions: number;
    replacements: number;
    salary: number | null;
    bpjsKes: number | null;
    bpjsTk: number | null;
    annualCost: number | null;
    months: Month[];
  };
  approvalRequest: { id: string; number: string | null; state: string } | null;
  accountingBudget: { id: string; name: string } | null;
  options: {
    jobs: { id: string; name: string; gradeId: string | null }[];
    grades: { id: string; name: string }[];
    employees: { id: string; name: string; jobId: string | null }[];
  };
  warnings: string[];
}
type Draft = {
  key: string;
  jobId: string;
  gradeId: string;
  kind: Kind;
  quantity: string;
  startMonth: string;
  endMonth: string;
  monthlyWage: string;
  monthlyAllowance: string;
  reason: string;
  replacesEmployeeId: string;
};

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KIND_LABEL: Record<Kind, [string, string]> = {
  existing: ["Posisi terisi", "Existing"],
  new: ["Tambahan", "New"],
  replacement: ["Pengganti", "Replacement"],
};
const toDraft = (l: Line): Draft => ({
  key: l.id,
  jobId: l.jobId,
  gradeId: l.gradeId ?? "",
  kind: l.kind,
  quantity: String(l.quantity),
  startMonth: String(l.startMonth),
  endMonth: l.endMonth ? String(l.endMonth) : "",
  monthlyWage: l.monthlyWage === null ? "" : String(Number(l.monthlyWage)),
  monthlyAllowance: l.monthlyAllowance === null ? "" : String(Number(l.monthlyAllowance)),
  reason: l.reason ?? "",
  replacesEmployeeId: l.replacesEmployeeId ?? "",
});

/** Detail Man Power Planning: posisi per jabatan, biaya per bulan, persetujuan, lowongan & realisasi. */
export default function ManpowerPlanPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { l, locale } = useI18n();
  const [d, setD] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [thrMonth, setThrMonth] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const months = locale === "id" ? MONTHS_ID : MONTHS_EN;
  const editable = !!d && d.state === "draft" && d.canEdit;

  const show = useCallback((x: Detail) => {
    setD(x);
    setDraft(x.lines.map(toDraft));
    setThrMonth(x.thrMonth ? String(x.thrMonth) : "");
    setNote(x.note ?? "");
  }, []);
  useEffect(() => {
    api<Detail>(`/manpower-plans/${id}`).then(show, (e) => setError(errorText(e)));
  }, [id, show]);

  const act = async (path: string, message: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      show(await api<Detail>(path, { method: body ? "PUT" : "POST", body }));
      setNotice(message);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    act(`/manpower-plans/${id}`, l("MPP disimpan.", "Plan saved."), {
      thrMonth: thrMonth ? Number(thrMonth) : null,
      note: note || null,
      lines: (draft ?? []).map((x) => ({
        jobId: x.jobId,
        gradeId: x.gradeId || null,
        kind: x.kind,
        quantity: Number(x.quantity || 0),
        startMonth: Number(x.startMonth || 1),
        endMonth: x.endMonth ? Number(x.endMonth) : null,
        ...(d?.showCost
          ? {
              monthlyWage: parseNumberInput(x.monthlyWage, locale) || 0,
              monthlyAllowance: parseNumberInput(x.monthlyAllowance, locale) || 0,
            }
          : {}),
        reason: x.reason || null,
        replacesEmployeeId: x.kind === "replacement" ? x.replacesEmployeeId || null : null,
      })),
    });
  const set = (key: string, patch: Partial<Draft>) =>
    setDraft((rows) => rows?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? rows);
  const add = (kind: Kind) =>
    setDraft((rows) => [
      ...(rows ?? []),
      {
        key: `new-${Date.now()}`,
        jobId: d?.options.jobs[0]?.id ?? "",
        gradeId: "",
        kind,
        quantity: "1",
        startMonth: "1",
        endMonth: "",
        monthlyWage: "",
        monthlyAllowance: "",
        reason: "",
        replacesEmployeeId: "",
      },
    ]);
  const remove = async () => {
    if (!(await ask(l("Hapus MPP draft ini?", "Delete this draft plan?")))) return;
    try {
      await api(`/manpower-plans/${id}`, { method: "DELETE" });
      router.push(`/hr/manpower-plans?year=${d?.year ?? ""}`);
    } catch (e) {
      setError(errorText(e));
    }
  };
  // Posisi tambahan/pengganti diajukan lewat FPK (sisa kuota baris); lowongan dibuka setelah FPK disetujui.
  const requestHiring = async (lineId: string) => {
    setBusy(true);
    setError(null);
    try {
      const fpk = await api<{ id: string }>(`/manpower-plan-lines/${lineId}/hiring-request`, {
        method: "POST",
        body: {},
      });
      router.push(`/hr/hiring-requests/${fpk.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  if (!d)
    return (
      <div className="stack-wide">
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <p>…</p>
        )}
      </div>
    );
  const s = d.summary;
  const compact = (v: number) =>
    new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);

  return (
    <div className="stack-wide">
      <section className="panel">
        <header className="toolbar">
          <h1>
            <Link href={`/hr/manpower-plans?year=${d.year}`}>Man Power Planning</Link> / {d.name}
          </h1>
          <span className={`pill ${planStatePill(d.state)}`}>{l(...PLAN_STATE_LABEL[d.state])}</span>
          {editable && (
            <>
              <button type="button" className="primary" disabled={busy} onClick={save}>
                {l("Simpan", "Save")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => act(`/manpower-plans/${id}/submit`, l("MPP diajukan.", "Plan submitted."))}
              >
                {l("Ajukan persetujuan", "Submit for approval")}
              </button>
              <button type="button" className="danger" disabled={busy} onClick={remove}>
                {l("Hapus", "Delete")}
              </button>
            </>
          )}
          {d.canEdit && d.state === "approved" && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                act(
                  `/manpower-plans/${id}/revise`,
                  l("MPP kembali draft untuk revisi.", "Plan reopened for revision."),
                )
              }
            >
              {l("Revisi", "Revise")}
            </button>
          )}
          {d.canEdit && (d.state === "in_approval" || (d.state === "approved" && d.canManage)) && (
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={async () =>
                (await ask(
                  l(
                    "Batalkan MPP ini? Anggarannya akan dicabut.",
                    "Cancel this plan? Its budget will be removed.",
                  ),
                )) && act(`/manpower-plans/${id}/cancel`, l("MPP dibatalkan.", "Plan cancelled."))
              }
            >
              {l("Batalkan", "Cancel")}
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              download(`/manpower-plans/${id}/export`, undefined, "mpp.xlsx").catch((e: Error) =>
                setError(e.message),
              )
            }
          >
            {l("Ekspor Excel", "Export Excel")}
          </button>
        </header>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="muted">{notice}</p>}
        {d.warnings.map((w) => (
          <p key={w} className="error">
            {w}
          </p>
        ))}
        <p className="muted">
          {d.department} · {d.year}
          {d.approvalRequest && (
            <>
              {" · "}
              <Link href={`/hr/approval-requests/${d.approvalRequest.id}`}>
                {l("Permintaan persetujuan", "Approval request")} {d.approvalRequest.number}
              </Link>
            </>
          )}
          {d.state === "approved" && (
            <>
              {" · "}
              <Link href={`/hr/manpower-budget`}>{l("Anggaran Tenaga Kerja", "Manpower Budget")}</Link>
              {d.accountingBudget && (
                <>
                  {" · "}
                  <Link href={`/accounting/budgets/${d.accountingBudget.id}`}>{d.accountingBudget.name}</Link>
                </>
              )}
            </>
          )}
        </p>
        <ul className="grid">
          {(
            [
              [l("Headcount awal", "Start headcount"), String(s.startHeadcount)],
              [l("Headcount akhir", "End headcount"), String(s.endHeadcount)],
              [l("Tambahan", "New positions"), String(s.additions)],
              [l("Pengganti", "Replacements"), String(s.replacements)],
              ...(d.showCost && s.annualCost !== null
                ? [
                    [l("Biaya tahunan", "Annual cost"), money(s.annualCost, locale)],
                    [l("Gaji + tunjangan + THR", "Pay + allowances + THR"), money(s.salary ?? 0, locale)],
                    [
                      l("BPJS perusahaan", "Employer BPJS"),
                      money((s.bpjsKes ?? 0) + (s.bpjsTk ?? 0), locale),
                    ],
                  ]
                : []),
            ] as [string, string][]
          ).map(([label, value]) => (
            <li key={label} className="card">
              <span>{label}</span>
              <strong>{value}</strong>
            </li>
          ))}
        </ul>
        {editable && (
          <div className="fields">
            <label className="field">
              <span>{l("Bulan THR dianggarkan", "THR month")}</span>
              <select value={thrMonth} onChange={(e) => setThrMonth(e.target.value)}>
                <option value="">{l("Tidak dianggarkan", "Not budgeted")}</option>
                {months.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Catatan", "Note")}</span>
              <input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
        )}
      </section>

      <section className="panel proj-panel">
        <header className="toolbar">
          <h2>{l("Posisi", "Positions")}</h2>
          {editable && (
            <>
              <button type="button" onClick={() => add("new")}>
                + {l("Posisi tambahan", "New position")}
              </button>
              <button type="button" onClick={() => add("replacement")}>
                + {l("Pengganti", "Replacement")}
              </button>
              <button type="button" onClick={() => add("existing")}>
                + {l("Posisi terisi", "Existing")}
              </button>
            </>
          )}
        </header>
        <div className="table-wrap">
          <table className={editable ? "mpp-lines" : undefined}>
            <thead>
              <tr>
                <th>{l("Jabatan", "Job")}</th>
                <th>{l("Golongan", "Grade")}</th>
                <th>{l("Jenis", "Type")}</th>
                <th className="num">{l("Jumlah", "Qty")}</th>
                <th>{l("Mulai", "From")}</th>
                <th>{l("Sampai", "Until")}</th>
                {d.showCost && <th className="num">{l("Upah/bulan", "Wage/mo")}</th>}
                {d.showCost && <th className="num">{l("Tunjangan", "Allowance")}</th>}
                <th>{l("Alasan / diganti", "Reason / replaces")}</th>
                {!editable && <th>{l("Realisasi", "Progress")}</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {editable && draft
                ? draft.map((x) => (
                    <tr key={x.key}>
                      <td>
                        <select
                          aria-label={l("Jabatan", "Job")}
                          value={x.jobId}
                          onChange={(e) => set(x.key, { jobId: e.target.value })}
                        >
                          {d.options.jobs.map((j) => (
                            <option key={j.id} value={j.id}>
                              {j.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          aria-label={l("Golongan", "Grade")}
                          value={x.gradeId}
                          onChange={(e) => set(x.key, { gradeId: e.target.value })}
                        >
                          <option value="">—</option>
                          {d.options.grades.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          aria-label={l("Jenis", "Type")}
                          value={x.kind}
                          onChange={(e) => set(x.key, { kind: e.target.value as Kind })}
                        >
                          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                            <option key={k} value={k}>
                              {l(...KIND_LABEL[k])}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          aria-label={l("Jumlah", "Qty")}
                          inputMode="numeric"
                          className="num-input"
                          value={x.quantity}
                          onChange={(e) => set(x.key, { quantity: e.target.value.replace(/\D/g, "") })}
                        />
                      </td>
                      <td>
                        <select
                          aria-label={l("Mulai", "From")}
                          value={x.startMonth}
                          onChange={(e) => set(x.key, { startMonth: e.target.value })}
                        >
                          {months.map((m, i) => (
                            <option key={m} value={i + 1}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          aria-label={l("Sampai", "Until")}
                          value={x.endMonth}
                          onChange={(e) => set(x.key, { endMonth: e.target.value })}
                        >
                          <option value="">—</option>
                          {months.map((m, i) => (
                            <option key={m} value={i + 1}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </td>
                      {d.showCost && (
                        <td>
                          <input
                            aria-label={l("Upah/bulan", "Wage/mo")}
                            inputMode="decimal"
                            className="num-input"
                            value={x.monthlyWage}
                            onChange={(e) =>
                              set(x.key, { monthlyWage: e.target.value.replace(/[^\d.,]/g, "") })
                            }
                          />
                        </td>
                      )}
                      {d.showCost && (
                        <td>
                          <input
                            aria-label={l("Tunjangan", "Allowance")}
                            inputMode="decimal"
                            className="num-input"
                            value={x.monthlyAllowance}
                            onChange={(e) =>
                              set(x.key, { monthlyAllowance: e.target.value.replace(/[^\d.,]/g, "") })
                            }
                          />
                        </td>
                      )}
                      <td>
                        {x.kind === "replacement" && (
                          <select
                            aria-label={l("Karyawan yang diganti", "Replaced employee")}
                            value={x.replacesEmployeeId}
                            onChange={(e) => set(x.key, { replacesEmployeeId: e.target.value })}
                          >
                            <option value="">{l("— karyawan diganti —", "— replaced employee —")}</option>
                            {d.options.employees.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                          </select>
                        )}
                        <input
                          aria-label={l("Alasan", "Reason")}
                          placeholder={l("Alasan", "Reason")}
                          maxLength={300}
                          value={x.reason}
                          onChange={(e) => set(x.key, { reason: e.target.value })}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="link danger"
                          aria-label={l("Hapus baris", "Remove line")}
                          onClick={() => setDraft((rows) => rows?.filter((r) => r.key !== x.key) ?? rows)}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))
                : d.lines.map((x) => (
                    <tr key={x.id}>
                      <td>{x.job}</td>
                      <td>{x.grade ?? "—"}</td>
                      <td>{l(...KIND_LABEL[x.kind])}</td>
                      <td className="num">{x.quantity}</td>
                      <td>{months[x.startMonth - 1]}</td>
                      <td>{x.endMonth ? months[x.endMonth - 1] : "—"}</td>
                      {d.showCost && <td className="num">{money(x.monthlyWage ?? 0, locale)}</td>}
                      {d.showCost && <td className="num">{money(x.monthlyAllowance ?? 0, locale)}</td>}
                      <td>
                        {x.replaces && <div>{l(`Mengganti ${x.replaces}`, `Replaces ${x.replaces}`)}</div>}
                        <span className="muted">{x.reason}</span>
                      </td>
                      <td>
                        {x.realization && (
                          <>
                            <span className={`pill ${realizationPill(x.realization)}`}>
                              {l(...REALIZATION_LABEL[x.realization])}
                            </span>{" "}
                            {x.jobOpeningId && (
                              <span className="muted">
                                {x.hired}/{x.quantity} · {x.applicants} {l("pelamar", "applicants")}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="actions">
                        {x.realization && d.state === "approved" && (
                          <>
                            <Link href={`/hr/hiring-requests?lineId=${x.id}`}>FPK</Link>
                            {x.jobOpeningId && (
                              <>
                                {" · "}
                                <Link href={`/hr/recruitment?openingId=${x.jobOpeningId}`}>
                                  {l("Rekrutmen", "Recruitment")}
                                </Link>
                              </>
                            )}
                            {d.canEdit && x.realization !== "fulfilled" && (
                              <button type="button" disabled={busy} onClick={() => requestHiring(x.id)}>
                                {l("Ajukan FPK", "Request hire")}
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
              {!(editable ? draft?.length : d.lines.length) && (
                <tr>
                  <td colSpan={11} className="muted">
                    {l("Belum ada posisi.", "No positions yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editable && (
          <p className="muted">
            {l(
              "Posisi terisi = karyawan yang sudah ada (diisi otomatis dari data karyawan). Tambahan menambah headcount mulai bulan yang dipilih; pengganti mengisi posisi karyawan keluar tanpa menambah headcount. Simpan sebelum mengajukan.",
              "Existing = current employees (prefilled). New adds headcount from the chosen month; replacement fills a leaver's seat without adding headcount. Save before submitting.",
            )}
          </p>
        )}
      </section>

      <div className="grid-2">
        <section className="panel">
          <h2>{l("Headcount per bulan", "Headcount by month")}</h2>
          <BarChart
            ariaLabel={l("Rencana headcount per bulan", "Planned headcount by month")}
            labels={months}
            series={[{ key: "hc", label: "Headcount", slot: 1, values: s.months.map((m) => m.headcount) }]}
          />
        </section>
        {d.showCost && (
          <section className="panel">
            <h2>{l("Biaya per bulan", "Cost by month")}</h2>
            <BarChart
              ariaLabel={l("Rencana biaya per bulan", "Planned cost by month")}
              labels={months}
              format={compact}
              series={[
                {
                  key: "salary",
                  label: l("Gaji + tunjangan + THR", "Pay + allowances + THR"),
                  slot: 1,
                  values: s.months.map((m) => m.salary ?? 0),
                },
                {
                  key: "bpjs",
                  label: l("BPJS perusahaan", "Employer BPJS"),
                  slot: 2,
                  values: s.months.map((m) => (m.bpjsKes ?? 0) + (m.bpjsTk ?? 0)),
                },
              ]}
            />
          </section>
        )}
      </div>
    </div>
  );
}
