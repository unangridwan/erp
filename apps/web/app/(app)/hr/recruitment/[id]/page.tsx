"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DocumentsPanel, errorText } from "../../../../../components/hr/hr-panels";
import { useMe } from "../../../../../components/me-context";
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

/** Pelamar: tahap, wawancara (jadwal, hasil, skor), dokumen, dan terima menjadi karyawan. */
export default function ApplicantPage() {
  const { id } = useParams<{ id: string }>();
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
    joinDate: today(),
    wage: "",
    contractType: "pkwtt",
    dateEnd: "",
    ptkpStatus: "TK/0",
  });
  const [hired, setHired] = useState<{ employeeId: string; contractId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () => api<Applicant>(`/applicants/${id}`).then(setA, (e) => setError(errorText(e))),
    [id],
  );
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
          {!closed && (
            <button
              type="button"
              className="danger"
              onClick={() => {
                const reason = prompt(l("Alasan penolakan", "Refusal reason"));
                if (reason) void call("stage", { stage: "refused", refuseReason: reason });
              }}
            >
              {l("Tolak", "Refuse")}
            </button>
          )}
          <Link href="/hr/recruitment">{l("Kembali ke kanban", "Back to kanban")}</Link>
        </header>
        {error && <p className="error">{error}</p>}
        <p className="muted">
          {[a.email, a.phone].filter(Boolean).join(" · ")}
          {a.expectedWage ? ` · ${l("harapan gaji", "expected wage")} ${money(a.expectedWage, locale)}` : ""}
        </p>
        {a.refuseReason && <p className="error">{a.refuseReason}</p>}
        {a.employeeId && (
          <p className="notice">
            {l("Sudah menjadi karyawan:", "Now an employee:")}{" "}
            <Link href={`/employees/${a.employeeId}`}>{l("buka data karyawan", "open employee")}</Link>
          </p>
        )}
      </section>

      <section className="panel">
        <h2>{l("Wawancara", "Interviews")}</h2>
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

      {can(me.permissions, "hr.manage") && <DocumentsPanel applicantId={a.id} />}

      {!closed && can(me.permissions, "hr.manage") && (
        <section className="panel">
          <h2>{l("Terima menjadi karyawan", "Hire as employee")}</h2>
          <p className="muted">
            {l(
              "Membuat data karyawan & kontrak draft, memindahkan dokumen pelamar, dan memulai checklist onboarding.",
              "Creates the employee & a draft contract, moves the applicant's documents and starts onboarding.",
            )}
          </p>
          <div className="inline-panel">
            <label className="field">
              <span>{l("Tanggal masuk", "Start date")}</span>
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
              disabled={!hire.wage}
              onClick={async () => {
                setError(null);
                try {
                  setHired(
                    await api(`/applicants/${id}/hire`, {
                      method: "POST",
                      body: { ...hire, dateEnd: hire.dateEnd || null },
                    }),
                  );
                  void load();
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            >
              {l("Terima", "Hire")}
            </button>
          </div>
        </section>
      )}
      {hired && (
        <p className="notice">
          <Link href={`/hr/contracts/${hired.contractId}`}>
            {l("Buka kontrak draft", "Open draft contract")}
          </Link>
        </p>
      )}
    </div>
  );
}
