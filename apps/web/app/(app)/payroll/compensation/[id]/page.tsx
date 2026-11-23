"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { COMPENSATION_STATE_LABEL, type CompensationState } from "@erp/shared";
import { useMe } from "../../../../../components/me-context";
import { cycleStatePill } from "../../../../../components/payroll/team-compensation";
import { api } from "../../../../../lib/api";
import { formatDate, money } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";
import { ask } from "../../../../../components/feedback";
import { wageRange } from "../../../../../components/hr/grade-wage";

interface Proposal {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  department: string | null;
  rating: string | null;
  currentWage: string;
  suggestedPercent: string;
  proposedPercent: string;
  newWage: string;
  reason: string | null;
  grade: { name: string; minWage: string | null; maxWage: string | null } | null;
  gradeFlag: "below" | "above" | null;
  annualCost: string;
  newContractId: string | null;
}
interface Detail {
  id: string;
  name: string;
  effectiveDate: string;
  state: CompensationState;
  budgetKind: "percent" | "amount";
  budgetValue: string;
  proposals: Proposal[];
  budget: {
    baseline: string;
    budget: string;
    used: string;
    remaining: string;
    averagePercent: string;
    overBudget: boolean;
  };
  annualCost: string;
  approvalRequest: { id: string; number: string | null; state: string } | null;
}

/** Detail siklus kenaikan gaji: anggaran, usulan per karyawan (inline), ajukan, terapkan. */
export default function CompensationCyclePage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const { l, locale } = useI18n();
  const [c, setC] = useState<Detail | null>(null);
  const [edits, setEdits] = useState<Record<string, { percent: string; reason: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const manage = can(me.permissions, "payroll.manage");

  const load = useCallback(
    () =>
      api<Detail>(`/compensation-cycles/${id}`)
        .then(setC)
        .catch((e: Error) => setError(e.message)),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, message?: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (message) setNotice(message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!c) return <p className={error ? "error" : "muted"}>{error ?? l("Memuat…", "Loading…")}</p>;
  const draft = c.state === "draft";
  const editable = draft && manage;
  const dirty = Object.keys(edits).length > 0;
  const saveAll = () =>
    act(
      async () => {
        for (const [pid, e] of Object.entries(edits))
          await api(`/compensation-proposals/${pid}`, {
            method: "PUT",
            body: { proposedPercent: Number(e.percent), reason: e.reason || null },
          });
        setEdits({});
      },
      l("Usulan tersimpan.", "Proposals saved."),
    );
  const usedPct =
    Number(c.budget.budget) > 0 ? Math.min(100, (Number(c.budget.used) / Number(c.budget.budget)) * 100) : 0;

  return (
    <>
      <header className="toolbar">
        <nav className="breadcrumb">
          <Link href="/payroll/compensation">{l("Kenaikan Gaji", "Salary Review")}</Link>
          <span>/</span>
          <h1>{c.name}</h1>
        </nav>
        <span className={`pill ${cycleStatePill(c.state)}`}>{l(...COMPENSATION_STATE_LABEL[c.state])}</span>
        {editable && (
          <>
            <button
              type="button"
              onClick={() => act(() => api(`/compensation-cycles/${id}/generate`, { method: "POST" }))}
            >
              {l("Tambah peserta baru", "Add new employees")}
            </button>
            <button
              type="button"
              className="primary"
              disabled={dirty}
              onClick={() =>
                act(
                  () => api(`/compensation-cycles/${id}/submit`, { method: "POST" }),
                  l("Diajukan untuk persetujuan.", "Submitted for approval."),
                )
              }
            >
              {l("Ajukan persetujuan", "Submit for approval")}
            </button>
          </>
        )}
        {manage && c.state === "approved" && (
          <button
            type="button"
            className="primary"
            onClick={async () =>
              (await ask(
                l(
                  `Buat kontrak upah baru berlaku ${c.effectiveDate} untuk semua usulan?`,
                  `Create new wage contracts effective ${c.effectiveDate} for all proposals?`,
                ),
              )) &&
              act(
                () => api(`/compensation-cycles/${id}/apply`, { method: "POST" }),
                l("Siklus diterapkan.", "Cycle applied."),
              )
            }
          >
            {l("Terapkan ke kontrak", "Apply to contracts")}
          </button>
        )}
        {manage && (c.state === "draft" || c.state === "in_approval" || c.state === "approved") && (
          <button
            type="button"
            className="danger"
            onClick={async () =>
              (await ask(l("Batalkan siklus ini?", "Cancel this cycle?"))) &&
              act(() => api(`/compensation-cycles/${id}/cancel`, { method: "POST" }))
            }
          >
            {l("Batalkan", "Cancel")}
          </button>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="notice">{notice}</p>}

      <section className="panel stack proj-panel">
        <div className="o-grid">
          <dl className="o-dl">
            <dt>{l("Berlaku", "Effective")}</dt>
            <dd>{formatDate(c.effectiveDate, locale)}</dd>
            <dt>{l("Total upah peserta", "Participants' wages")}</dt>
            <dd>
              {money(c.budget.baseline, locale)} / {l("bulan", "month")}
            </dd>
            <dt>{l("Anggaran", "Budget")}</dt>
            <dd>
              {money(c.budget.budget, locale)} / {l("bulan", "month")}
              {c.budgetKind === "percent" && <small className="muted"> ({Number(c.budgetValue)}%)</small>}
            </dd>
            {c.approvalRequest && (
              <>
                <dt>{l("Persetujuan", "Approval")}</dt>
                <dd>
                  <Link href={`/hr/approval-requests/${c.approvalRequest.id}`}>
                    {c.approvalRequest.number ?? "—"}
                  </Link>
                </dd>
              </>
            )}
          </dl>
          <div className="stack">
            <div className="budget-bar" aria-label={l("Pemakaian anggaran", "Budget usage")}>
              <span className={c.budget.overBudget ? "over" : ""} style={{ width: `${usedPct}%` }} />
            </div>
            <p className={c.budget.overBudget ? "error" : "muted"}>
              {l("Terpakai", "Used")} {money(c.budget.used, locale)} · {l("sisa", "remaining")}{" "}
              {money(c.budget.remaining, locale)} · {l("rata-rata", "average")}{" "}
              {Number(c.budget.averagePercent)}%
              {c.budget.overBudget && ` · ${l("melebihi anggaran", "over budget")}`}
            </p>
            <p className="muted">
              {l(
                "Tambahan biaya tahunan (upah 13 bulan + BPJS perusahaan)",
                "Annual cost increase (13 months wage + employer BPJS)",
              )}
              : <strong>{money(c.annualCost, locale)}</strong>
            </p>
          </div>
        </div>
      </section>

      <section className="panel stack proj-panel">
        <header className="toolbar">
          <h2>
            {l("Usulan", "Proposals")} <small className="muted">({c.proposals.length})</small>
          </h2>
          {editable && dirty && (
            <button type="button" className="primary" onClick={saveAll}>
              {l("Simpan usulan", "Save proposals")}
            </button>
          )}
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Karyawan", "Employee")}</th>
                <th>{l("Predikat", "Rating")}</th>
                <th className="num">{l("Upah sekarang", "Current wage")}</th>
                <th className="num">{l("Saran", "Suggested")}</th>
                <th className="num">{l("Usulan %", "Proposed %")}</th>
                <th className="num">{l("Upah baru", "New wage")}</th>
                <th>{l("Skala golongan", "Grade range")}</th>
                <th className="num">{l("Biaya / thn", "Cost / yr")}</th>
                <th>{l("Alasan", "Reason")}</th>
              </tr>
            </thead>
            <tbody>
              {c.proposals.map((p) => {
                const e = edits[p.id];
                const set = (patch: Partial<{ percent: string; reason: string }>) =>
                  setEdits((x) => ({
                    ...x,
                    [p.id]: {
                      ...(x[p.id] ?? { percent: String(Number(p.proposedPercent)), reason: p.reason ?? "" }),
                      ...patch,
                    },
                  }));
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/employees/${p.employeeId}`}>{p.employeeName}</Link>{" "}
                      <small className="muted">
                        {p.employeeNumber}
                        {p.department && ` · ${p.department}`}
                      </small>
                    </td>
                    <td>{p.rating ?? "—"}</td>
                    <td className="num">{money(p.currentWage, locale)}</td>
                    <td className="num">{Number(p.suggestedPercent)}%</td>
                    <td className="num">
                      {editable ? (
                        <input
                          className="num"
                          inputMode="decimal"
                          size={5}
                          aria-label={`${l("Usulan %", "Proposed %")} ${p.employeeName}`}
                          value={e?.percent ?? String(Number(p.proposedPercent))}
                          onChange={(ev) => set({ percent: ev.target.value })}
                        />
                      ) : (
                        `${Number(p.proposedPercent)}%`
                      )}
                    </td>
                    <td className="num">
                      {money(p.newWage, locale)}
                      {p.newContractId && " ✓"}
                    </td>
                    <td>
                      {p.grade ? (
                        <>
                          {p.grade.name}{" "}
                          {p.gradeFlag && (
                            <span className="pill warn">
                              {p.gradeFlag === "above"
                                ? l("di atas maks", "above max")
                                : l("di bawah min", "below min")}
                            </span>
                          )}
                          <br />
                          <small className="muted">
                            {wageRange(p.grade.minWage, p.grade.maxWage, (v) => money(v, locale))}
                          </small>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num">{money(p.annualCost, locale)}</td>
                    <td>
                      {editable ? (
                        <input
                          value={e?.reason ?? p.reason ?? ""}
                          onChange={(ev) => set({ reason: ev.target.value })}
                        />
                      ) : (
                        (p.reason ?? "—")
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
