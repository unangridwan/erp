"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { DocumentsPanel, errorText } from "../../../../../components/hr/hr-panels";
import { useMe } from "../../../../../components/me-context";
import { OffersPanel, RefuseForm } from "../../../../../components/hr/recruitment-extras";
import { RefSelect } from "../../../../../components/ref-select";
import { api } from "../../../../../lib/api";
import { money, today } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { APPLICANT_STAGE_LABEL, can } from "../../../../../lib/resources";

interface Applicant {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: string;
  stage: string;
  expectedWage: string | null;
  notes: string | null;
  refuseReason: string | null;
  refuseReasonName: string | null;
  employeeId: string | null;
  openingName: string;
  interviews: {
    id: string;
    scheduledAt: string;
    location: string | null;
    interviewerName: string | null;
    result: string | null;
    score: number | null;
    done: boolean;
  }[];
}

interface Candidate {
  employee: { id: string; name: string; employeeNumber: string; active: boolean; pendingStart: boolean };
  contract: { id: string; name: string; state: string; dateStart: string } | null;
}

/**
 * Pelamar: tahap, wawancara (jadwal, hasil, skor), dokumen, penawaran, lalu proses kontrak setelah penawaran
 * diterima (calon karyawan aktif saat kontrak dimulai).
 */
export default function ApplicantPage() {
  return (
    <Suspense>
      <Applicant />
    </Suspense>
  );
}

function Applicant() {
  const { id } = useParams<{ id: string }>();
  const refuseFirst = useSearchParams().get("refuse") === "1";
  const { l, tx, locale } = useI18n();
  const me = useMe();
  const [a, setA] = useState<Applicant | null>(null);
  const [interview, setInterview] = useState({
    date: today(),
    time: "10:00",
    location: "",
    interviewerId: "",
  });
  const [hire, setHire] = useState({
    joinDate: "",
    wage: "",
    contractType: "pkwtt",
    dateEnd: "",
    ptkpStatus: "TK/0",
  });
  const [accepted, setAccepted] = useState(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const row = await api<Applicant>(`/applicants/${id}`);
      setA(row);
      const offers = await api<{ state: string }[]>(`/applicants/${id}/offers`).catch(() => []);
      setAccepted(offers.some((o) => o.state === "accepted"));
      if (row.employeeId) {
        const employee = await api<Candidate["employee"]>(`/employees/${row.employeeId}`);
        const contracts = await api<{ items: NonNullable<Candidate["contract"]>[] }>(
          `/contracts?employeeId=${row.employeeId}`,
        ).then(
          (r) => r.items,
          () => [],
        );
        setCandidate({ employee, contract: contracts.find((c) => c.state !== "cancel") ?? null });
      } else setCandidate(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function call(path: string, body: object) {
    setError(null);
    try {
      const r = await api<Applicant>(`/applicants/${id}/${path}`, { method: "POST", body });
      setA(r);
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (!a) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  const closed = a.stage === "hired" || a.stage === "refused";
  const local = (iso: string) =>
    new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));

  return (
    <div className="stack-wide">
      <section className="panel">
        <header className="toolbar">
          <h1>
            {a.name} <small className="muted">{a.openingName}</small>
          </h1>
          <span
            className={`badge state-${a.stage === "hired" ? "sale" : a.stage === "refused" ? "cancel" : "draft"}`}
          >
            {tx(APPLICANT_STAGE_LABEL[a.stage]!)}
          </span>
          {!closed &&
            (["screening", "interview", "offer"] as const)
              .filter((s) => s !== a.stage)
              .map((s) => (
                <button key={s} type="button" onClick={() => call("stage", { stage: s })}>
                  {tx(APPLICANT_STAGE_LABEL[s]!)}
                </button>
              ))}
          {!closed && <RefuseForm open={refuseFirst} onRefuse={(body) => call("stage", body)} />}
          <Link href="/hr/recruitment">{l("Kembali ke kanban", "Back to kanban")}</Link>
        </header>
        {error && <p className="error">{error}</p>}
        <p className="muted">
          {[a.email, a.phone].filter(Boolean).join(" · ")}
          {a.expectedWage ? ` · ${l("harapan gaji", "expected wage")} ${money(a.expectedWage, locale)}` : ""}
        </p>
        {(a.refuseReasonName || a.refuseReason) && (
          <p className="error">
            {l("Ditolak:", "Refused:")} {[a.refuseReasonName, a.refuseReason].filter(Boolean).join(" — ")}
          </p>
        )}
        {a.employeeId && (
          <p className="notice">
            {l("Sudah menjadi karyawan:", "Now an employee:")}{" "}
            <Link href={`/employees/${a.employeeId}`}>{l("buka data karyawan", "open employee")}</Link>
          </p>
        )}
      </section>

      <section className="panel">
        <h2>{l("Wawancara", "Interviews")}</h2>
        <div className="table-scroll">
          <table>
            <tbody>
              {a.interviews.map((i) => (
                <tr key={i.id}>
                  <td>{local(i.scheduledAt)}</td>
                  <td>{i.location}</td>
                  <td>{i.interviewerName ?? "—"}</td>
                  <td>
                    {i.done ? `${"★".repeat(i.score ?? 0)} ${i.result ?? ""}` : l("terjadwal", "scheduled")}
                  </td>
                  <td>
                    {!i.done && (
                      <button
                        type="button"
                        className="link"
                        onClick={async () => {
                          const result = prompt(l("Hasil wawancara", "Interview result")) ?? "";
                          const score = Number(prompt(l("Skor 1–5", "Score 1–5")) || 0) || null;
                          setError(null);
                          await api(`/applicants/${id}/interviews/${i.id}`, {
                            method: "PUT",
                            body: {
                              scheduledAt: i.scheduledAt,
                              location: i.location,
                              result,
                              score,
                              done: true,
                            },
                          }).then(load, (e) => setError(errorText(e)));
                        }}
                      >
                        {l("Catat hasil", "Record result")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!closed && (
          <div className="inline-panel">
            <label className="field">
              <span>{l("Tanggal", "Date")}</span>
              <input
                type="date"
                value={interview.date}
                onChange={(e) => setInterview((f) => ({ ...f, date: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>{l("Jam", "Time")}</span>
              <input
                type="time"
                value={interview.time}
                onChange={(e) => setInterview((f) => ({ ...f, time: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>{l("Pewawancara", "Interviewer")}</span>
              <RefSelect
                name="interviewerId"
                resource="users"
                display="name"
                value={interview.interviewerId}
                onChange={(v) => setInterview((f) => ({ ...f, interviewerId: v }))}
              />
            </label>
            <label className="field">
              <span>{l("Lokasi / tautan", "Location / link")}</span>
              <input
                value={interview.location}
                onChange={(e) => setInterview((f) => ({ ...f, location: e.target.value }))}
              />
            </label>
            <button
              type="button"
              className="primary"
              onClick={() =>
                call("interviews", {
                  scheduledAt: new Date(`${interview.date}T${interview.time}`).toISOString(),
                  location: interview.location || null,
                  interviewerId: interview.interviewerId || null,
                })
              }
            >
              {l("Jadwalkan wawancara", "Schedule interview")}
            </button>
          </div>
        )}
      </section>

      {can(me.permissions, "hr.manage") && (
        <OffersPanel applicantId={a.id} closed={closed} onChange={() => void load()} />
      )}

      {can(me.permissions, "hr.manage") && <DocumentsPanel applicantId={a.id} />}

      {!closed && can(me.permissions, "hr.manage") && !accepted && (
        <p className="muted">
          {l(
            "Proses kontrak tersedia setelah pelamar menerima penawaran kerja.",
            "Contract processing is available once the applicant accepts a job offer.",
          )}
        </p>
      )}
      {!closed && can(me.permissions, "hr.manage") && accepted && (
        <section className="panel">
          <h2>{l("Proses kontrak", "Process contract")}</h2>
          <p className="muted">
            {l(
              "Membuat calon karyawan & kontrak draft dari penawaran yang diterima dan memindahkan dokumen pelamar. Calon menjadi karyawan aktif dan onboarding dimulai saat kontrak dimulai. Kosongkan isian untuk memakai nilai penawaran.",
              "Creates a pre-hire employee & draft contract from the accepted offer and moves the applicant's documents. The person becomes an active employee and onboarding starts when the contract starts. Leave fields empty to use the offer.",
            )}
          </p>
          <div className="inline-panel">
            <label className="field">
              <span>{l("Mulai kontrak (tanggal masuk)", "Contract start (join date)")}</span>
              <input
                type="date"
                value={hire.joinDate}
                onChange={(e) => setHire((f) => ({ ...f, joinDate: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>{l("Gaji pokok", "Base wage")}</span>
              <input
                className="num"
                inputMode="decimal"
                value={hire.wage}
                onChange={(e) => setHire((f) => ({ ...f, wage: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>{l("Jenis kontrak", "Contract type")}</span>
              <select
                value={hire.contractType}
                onChange={(e) => setHire((f) => ({ ...f, contractType: e.target.value }))}
              >
                <option value="pkwtt">PKWTT</option>
                <option value="pkwt">PKWT</option>
              </select>
            </label>
            {hire.contractType === "pkwt" && (
              <label className="field">
                <span>{l("Berakhir", "End")}</span>
                <input
                  type="date"
                  value={hire.dateEnd}
                  onChange={(e) => setHire((f) => ({ ...f, dateEnd: e.target.value }))}
                />
              </label>
            )}
            <label className="field">
              <span>PTKP</span>
              <select
                value={hire.ptkpStatus}
                onChange={(e) => setHire((f) => ({ ...f, ptkpStatus: e.target.value }))}
              >
                {["TK/0", "TK/1", "TK/2", "TK/3", "K/0", "K/1", "K/2", "K/3"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="primary"
              onClick={async () => {
                setError(null);
                try {
                  await api(`/applicants/${id}/hire`, {
                    method: "POST",
                    body: {
                      ptkpStatus: hire.ptkpStatus,
                      joinDate: hire.joinDate || undefined,
                      wage: hire.wage || undefined,
                      contractType: hire.wage ? hire.contractType : undefined,
                      dateEnd: hire.dateEnd || null,
                    },
                  });
                  void load();
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            >
              {l("Proses kontrak", "Process contract")}
            </button>
          </div>
        </section>
      )}
      {candidate && (
        <section className="panel">
          <h2>{l("Karyawan", "Employee")}</h2>
          {candidate.employee.pendingStart ? (
            <p>
              <span className="pill warn">{l("Calon karyawan", "Pre-hire")}</span>{" "}
              {l(
                "Belum aktif dan belum masuk payroll sampai kontrak dimulai.",
                "Not active and not in payroll until the contract starts.",
              )}
            </p>
          ) : (
            <p>
              <span className="pill ok">{l("Karyawan aktif", "Active employee")}</span>
            </p>
          )}
          <div className="toolbar">
            <Link href={`/employees/${candidate.employee.id}`}>
              {candidate.employee.employeeNumber} · {candidate.employee.name}
            </Link>
            {candidate.contract && (
              <Link href={`/hr/contracts/${candidate.contract.id}`}>
                {candidate.employee.pendingStart
                  ? l(`Mulai kontrak ${candidate.contract.name}`, `Start contract ${candidate.contract.name}`)
                  : l(`Kontrak ${candidate.contract.name}`, `Contract ${candidate.contract.name}`)}
              </Link>
            )}
            {!candidate.employee.pendingStart && (
              <Link href={`/hr/checklists?employeeId=${candidate.employee.id}`}>
                {l("Checklist onboarding", "Onboarding checklist")}
              </Link>
            )}
            {candidate.employee.pendingStart && can(me.permissions, "hr.manage") && (
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  if (
                    !confirm(
                      l(
                        "Batalkan calon karyawan? Kontrak draft dihapus dan pelamar kembali ke tahap penawaran.",
                        "Cancel this pre-hire? The draft contract is deleted and the applicant goes back to the offer stage.",
                      ),
                    )
                  )
                    return;
                  setError(null);
                  try {
                    await api(`/applicants/${id}/cancel-hire`, { method: "POST" });
                    void load();
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                {l("Batalkan calon", "Cancel pre-hire")}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
