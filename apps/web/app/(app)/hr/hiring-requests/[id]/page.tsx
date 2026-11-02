"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { HIRING_STATE_LABEL, hiringStatePill, type HiringState } from "../../../../../components/hr/hiring";
import { errorText } from "../../../../../components/hr/hr-panels";
import { api } from "../../../../../lib/api";
import { formatDate, money } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { APPLICANT_STAGE_LABEL } from "../../../../../lib/resources";

const STEPS = [
  ["plan", "Man Power Planning", "Manpower plan"],
  ["request", "Usulan (FPK)", "Hiring request"],
  ["approval", "Persetujuan", "Approval"],
  ["opening", "Lowongan", "Job opening"],
  ["applicants", "Rekrutmen", "Recruitment"],
  ["offer", "Penawaran", "Offer"],
  ["contract", "Kontrak", "Contract"],
  ["active", "Karyawan aktif", "Active"],
  ["onboarding", "Onboarding", "Onboarding"],
] as const;
type Step = (typeof STEPS)[number][0];
type StepStatus = "done" | "current" | "pending" | "skipped" | "blocked";
const STEP_STATUS_LABEL: Record<StepStatus, [string, string]> = {
  done: ["Selesai", "Done"],
  current: ["Berjalan", "In progress"],
  pending: ["Belum", "Pending"],
  skipped: ["Dilewati", "Skipped"],
  blocked: ["Berhenti", "Stopped"],
};

interface Person {
  applicantId: string;
  name: string;
  stage: string;
  employeeId: string | null;
  joinDate: string | null;
  offerAccepted: boolean;
  contractId: string | null;
  contractName: string | null;
  contractState: string | null;
  active: boolean;
  checklistId: string | null;
  onboarding: "open" | "done" | null;
}
interface Detail {
  id: string;
  number: string | null;
  department: string;
  job: string;
  grade: string | null;
  kind: "new" | "replacement";
  quantity: number;
  contractType: string;
  wageMin: string | null;
  wageMax: string | null;
  targetDate: string | null;
  reason: string;
  unplanned: boolean;
  state: HiringState;
  replaces: { id: string; name: string } | null;
  plan: { id: string; name: string; state: string; lineQuantity: number } | null;
  approvalRequest: { id: string; number: string | null; state: string } | null;
  opening: { id: string; name: string; state: string; quota: number } | null;
  applicants: { total: number; byStage: Record<string, number> };
  people: Person[];
  progress: Record<Step, StepStatus>;
  canEdit: boolean;
  canManage: boolean;
}

/** Detail FPK & alur penambahan karyawan dari MPP sampai onboarding. */
export default function HiringRequestPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { l, tx, locale } = useI18n();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () => api<Detail>(`/hiring-requests/${id}`).then(setD, (e) => setError(errorText(e))),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (path: string, after?: (r: { id: string }) => void) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>(`/hiring-requests/${id}/${path}`, { method: "POST" });
      if (after) after(r);
      else await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!d) return <div className="stack-wide">{error ? <p className="error">{error}</p> : <p>…</p>}</div>;
  const wage =
    d.wageMin || d.wageMax
      ? `${money(d.wageMin ?? d.wageMax ?? 0, locale, 0)} – ${money(d.wageMax ?? d.wageMin ?? 0, locale, 0)}`
      : "—";
  const stepLink: Partial<Record<Step, string>> = {
    plan: d.plan ? `/hr/manpower-plans/${d.plan.id}` : undefined,
    approval: d.approvalRequest ? `/hr/approval-requests/${d.approvalRequest.id}` : undefined,
    opening: d.opening ? `/hr/recruitment?openingId=${d.opening.id}` : undefined,
    applicants: d.opening ? `/hr/recruitment?openingId=${d.opening.id}` : undefined,
  };

  return (
    <div className="stack-wide">
      <section className="panel">
        <header className="toolbar">
          <h1>
            {d.number ?? l("FPK (draft)", "Hiring request (draft)")}{" "}
            <small className="muted">
              {d.job} – {d.department}
            </small>
          </h1>
          <span className={`pill ${hiringStatePill(d.state)}`}>{l(...HIRING_STATE_LABEL[d.state])}</span>
          {d.unplanned && <span className="pill warn">{l("Di luar MPP", "Unplanned")}</span>}
          {d.canEdit && d.state === "draft" && (
            <>
              <button type="button" className="primary" disabled={busy} onClick={() => act("submit")}>
                {l("Ajukan", "Submit")}
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={async () => {
                  if (!confirm(l("Hapus FPK draft ini?", "Delete this draft?"))) return;
                  try {
                    await api(`/hiring-requests/${id}`, { method: "DELETE" });
                    router.push("/hr/hiring-requests");
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                {l("Hapus", "Delete")}
              </button>
            </>
          )}
          {d.canManage && d.state === "approved" && !d.opening && (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => act("job-opening", (o) => router.push(`/hr/recruitment?openingId=${o.id}`))}
            >
              {l("Buka lowongan", "Open job")}
            </button>
          )}
          {d.canEdit && (d.state === "in_approval" || (d.state === "approved" && !d.opening)) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => confirm(l("Batalkan FPK ini?", "Cancel this request?")) && act("cancel")}
            >
              {l("Batalkan", "Cancel")}
            </button>
          )}
          <Link href="/hr/hiring-requests">{l("Kembali", "Back")}</Link>
        </header>
        {error && <p className="error">{error}</p>}

        <ol className="hiring-steps" aria-label={l("Alur penambahan karyawan", "Hiring flow")}>
          {STEPS.map(([key, id_, en]) => {
            const status = d.progress[key];
            const href = stepLink[key];
            return (
              <li key={key} className={`hiring-step ${status}`}>
                <span className="dot" aria-hidden />
                <span className="label">{href ? <Link href={href}>{l(id_, en)}</Link> : l(id_, en)}</span>
                <small>{l(...STEP_STATUS_LABEL[status])}</small>
              </li>
            );
          })}
        </ol>

        <dl className="facts">
          <div>
            <dt>{l("Posisi", "Position")}</dt>
            <dd>
              {d.job}
              {d.grade ? ` · ${d.grade}` : ""} ·{" "}
              {d.kind === "replacement" ? l("Pengganti", "Replacement") : l("Tambahan", "New")}
              {d.replaces ? ` (${d.replaces.name})` : ""}
            </dd>
          </div>
          <div>
            <dt>{l("Jumlah", "Headcount")}</dt>
            <dd>
              {d.quantity} {l("orang", "people")} · {d.contractType.toUpperCase()}
            </dd>
          </div>
          <div>
            <dt>{l("Gaji", "Wage")}</dt>
            <dd>{wage}</dd>
          </div>
          <div>
            <dt>{l("Target mulai", "Target start")}</dt>
            <dd>{d.targetDate ? formatDate(d.targetDate, locale) : "—"}</dd>
          </div>
          <div>
            <dt>MPP</dt>
            <dd>
              {d.plan ? (
                <Link href={`/hr/manpower-plans/${d.plan.id}`}>{d.plan.name}</Link>
              ) : (
                l("Di luar rencana", "Not in plan")
              )}
            </dd>
          </div>
          <div>
            <dt>{l("Persetujuan", "Approval")}</dt>
            <dd>
              {d.approvalRequest ? (
                <Link href={`/hr/approval-requests/${d.approvalRequest.id}`}>
                  {d.approvalRequest.number ?? l("Permintaan", "Request")}
                </Link>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className="wide">
            <dt>{l("Alasan", "Reason")}</dt>
            <dd>{d.reason}</dd>
          </div>
        </dl>
      </section>

      {d.opening && (
        <section className="panel">
          <header className="toolbar">
            <h2>{l("Rekrutmen", "Recruitment")}</h2>
            <Link href={`/hr/recruitment?openingId=${d.opening.id}`}>
              {d.opening.name} · {d.opening.state === "open" ? l("dibuka", "open") : l("ditutup", "closed")}
            </Link>
          </header>
          <p className="muted">
            {d.applicants.total} {l("pelamar", "applicants")}:{" "}
            {Object.entries(d.applicants.byStage)
              .filter(([, n]) => n > 0)
              .map(([s, n]) => `${tx(APPLICANT_STAGE_LABEL[s]!)} ${n}`)
              .join(" · ") || "—"}
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{l("Kandidat", "Candidate")}</th>
                  <th>{l("Penawaran", "Offer")}</th>
                  <th>{l("Kontrak", "Contract")}</th>
                  <th>{l("Karyawan", "Employee")}</th>
                  <th>Onboarding</th>
                </tr>
              </thead>
              <tbody>
                {d.people.map((p) => (
                  <tr key={p.applicantId}>
                    <td>
                      <Link href={`/hr/recruitment/${p.applicantId}`}>{p.name}</Link>
                    </td>
                    <td>
                      {p.offerAccepted ? <span className="pill ok">{l("Diterima", "Accepted")}</span> : "—"}
                    </td>
                    <td>
                      {p.contractId ? (
                        <Link href={`/hr/contracts/${p.contractId}`}>
                          {p.contractName} ·{" "}
                          {p.contractState === "draft" ? l("draft", "draft") : l("berjalan", "running")}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {p.employeeId ? (
                        <Link href={`/employees/${p.employeeId}`}>
                          {p.active ? (
                            <span className="pill ok">{l("Aktif", "Active")}</span>
                          ) : (
                            <span className="pill warn">{l("Calon", "Pre-hire")}</span>
                          )}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {p.checklistId ? (
                        <Link href={`/hr/checklists/${p.checklistId}`}>
                          {p.onboarding === "done" ? l("Selesai", "Done") : l("Berjalan", "In progress")}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
                {!d.people.length && (
                  <tr>
                    <td colSpan={5} className="muted">
                      {l(
                        "Belum ada kandidat yang menerima penawaran.",
                        "No candidate has accepted an offer yet.",
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
