"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../../../components/hr/hr-panels";
import { api } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { APPLICANT_STAGE_LABEL } from "../../../../lib/resources";

const STAGES = ["new", "screening", "interview", "offer", "hired", "refused"];

interface Opening {
  id: string;
  name: string;
  quota: number;
  state: string;
}
interface Applicant {
  id: string;
  name: string;
  email: string | null;
  stage: string;
  source: string;
  expectedWage: string | null;
  openingName: string;
  nextInterview: string | null;
}

/** Rekrutmen: kanban pelamar per tahap untuk lowongan terpilih. */
export default function RecruitmentPage() {
  const { l, tx, locale } = useI18n();
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [openingId, setOpeningId] = useState("");
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [form, setForm] = useState({ name: "", email: "", phone: "", source: "jobportal" });
  const [version, setVersion] = useState(0);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: Opening[] }>("/job-openings?limit=200").then(
      (r) => {
        setOpenings(r.items);
        setOpeningId((cur) => cur || (r.items.find((o) => o.state === "open") ?? r.items[0])?.id || "");
      },
      (e) => setError(errorText(e)),
    );
  }, []);
  useEffect(() => {
    api<Applicant[]>(`/applicants${openingId ? `?openingId=${openingId}` : ""}`).then(setApplicants, (e) =>
      setError(errorText(e)),
    );
  }, [openingId, version]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    api("/applicants", {
      method: "POST",
      body: {
        openingId,
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        source: form.source,
      },
    }).then(
      () => {
        setForm((f) => ({ ...f, name: "", email: "", phone: "" }));
        setVersion((v) => v + 1);
      },
      (err) => setError(errorText(err)),
    );
  };
  const move = (id: string, stage: string) => {
    const refuseReason = stage === "refused" ? prompt(l("Alasan penolakan", "Refusal reason")) : null;
    if (stage === "refused" && !refuseReason) return;
    api(`/applicants/${id}/stage`, { method: "POST", body: { stage, refuseReason } }).then(
      () => setVersion((v) => v + 1),
      (err) => setError(errorText(err)),
    );
  };
  const opening = openings.find((o) => o.id === openingId);

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Rekrutmen", "Recruitment")}</h1>
        <select
          value={openingId}
          onChange={(e) => setOpeningId(e.target.value)}
          aria-label={l("Lowongan", "Job opening")}
        >
          {openings.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} {o.state === "closed" ? l("(ditutup)", "(closed)") : ""}
            </option>
          ))}
        </select>
        <Link href="/job-openings">{l("Kelola lowongan", "Manage openings")}</Link>
      </header>
      {error && <p className="error">{error}</p>}
      {openings.length === 0 && (
        <p className="muted">
          {l("Buat lowongan dulu di menu Lowongan.", "Create a job opening first.")}{" "}
          <Link href="/job-openings/new">{l("Lowongan baru", "New opening")}</Link>
        </p>
      )}
      {opening?.state === "open" && (
        <form className="inline-panel" onSubmit={add}>
          <label className="field">
            <span>{l("Nama pelamar *", "Applicant name *")}</span>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>{l("Telepon", "Phone")}</span>
            <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </label>
          <label className="field">
            <span>{l("Sumber", "Source")}</span>
            <select value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}>
              <option value="jobportal">{l("Portal lowongan", "Job portal")}</option>
              <option value="referral">{l("Referensi", "Referral")}</option>
              <option value="website">Website</option>
              <option value="walkin">{l("Datang langsung", "Walk-in")}</option>
              <option value="other">{l("Lainnya", "Other")}</option>
            </select>
          </label>
          <button className="primary">{l("Tambah pelamar", "Add applicant")}</button>
        </form>
      )}
      <div className="kanban">
        {STAGES.map((stage) => {
          const list = applicants.filter((a) => a.stage === stage);
          return (
            <section
              key={stage}
              className={`kanban-col${over === stage ? " drop" : ""}`}
              onDragOver={(e) => {
                if (!dragging || stage === "hired") return;
                e.preventDefault();
                setOver(stage);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const a = applicants.find((x) => x.id === dragging);
                if (a && a.stage !== stage && a.stage !== "hired") move(a.id, stage);
                setDragging(null);
              }}
            >
              <header>
                <strong>{tx(APPLICANT_STAGE_LABEL[stage]!)}</strong>
                <small>{list.length}</small>
              </header>
              {list.map((a) => (
                <article
                  key={a.id}
                  className="kanban-card"
                  draggable={a.stage !== "hired"}
                  onDragStart={() => setDragging(a.id)}
                  onDragEnd={() => setDragging(null)}
                >
                  <Link href={`/hr/recruitment/${a.id}`}>{a.name}</Link>
                  {a.email && <small className="muted">{a.email}</small>}
                  {a.expectedWage && (
                    <small>
                      {l("Harapan gaji", "Expected wage")} {money(a.expectedWage, locale)}
                    </small>
                  )}
                  {a.nextInterview && (
                    <small>
                      {l("Wawancara", "Interview")} {formatDate(a.nextInterview.slice(0, 10), locale)}
                    </small>
                  )}
                  {stage !== "hired" && stage !== "refused" && (
                    <select
                      aria-label={l("Pindah tahap", "Move stage")}
                      value=""
                      onChange={(e) => e.target.value && move(a.id, e.target.value)}
                    >
                      <option value="">{l("Pindah ke…", "Move to…")}</option>
                      {STAGES.filter((s) => s !== stage && s !== "hired").map((s) => (
                        <option key={s} value={s}>
                          {tx(APPLICANT_STAGE_LABEL[s]!)}
                        </option>
                      ))}
                    </select>
                  )}
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
