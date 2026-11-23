"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { errorText } from "../../../../../components/hr/hr-panels";
import { useMe } from "../../../../../components/me-context";
import { api } from "../../../../../lib/api";
import { useI18n } from "../../../../../lib/i18n";
import { APPRAISAL_STATE_LABEL, can } from "../../../../../lib/resources";

interface Appraisal {
  id: string;
  cycleId: string;
  cycleName: string;
  employeeName: string;
  employeeUserId: string | null;
  managerUserId: string | null;
  managerName: string | null;
  state: "self" | "manager" | "calibration" | "done";
  selfScore: string | null;
  managerScore: string | null;
  finalScore: string | null;
  rating: string | null;
  raisePercent: string | null;
  employeeComment: string | null;
  managerComment: string | null;
  hrComment: string | null;
  lines: {
    id: string;
    name: string;
    weight: string;
    selfScore: number | null;
    managerScore: number | null;
    comment: string | null;
  }[];
}

/** Formulir penilaian: skor 1–5 per indikator (diri/atasan), lalu kalibrasi HR (skor akhir, predikat, kenaikan). */
export default function AppraisalFormPage() {
  const { id } = useParams<{ id: string }>();
  const { l, tx } = useI18n();
  const me = useMe();
  const [a, setA] = useState<Appraisal | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [calib, setCalib] = useState({ finalScore: "", rating: "", raisePercent: "", comment: "" });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api<Appraisal>(`/appraisals/${id}`).then(
        (r) => {
          setA(r);
          setScores({});
          setComment("");
        },
        (e) => setError(errorText(e)),
      ),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!a) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;

  const hr = can(me.permissions, "hr.manage");
  // Karyawan mengisi penilaian diri; atasan (atau HR, termasuk untuk karyawan tanpa akun) mengisi penilaian atasan.
  const mode: "self" | "manager" | null =
    a.state === "self" && a.employeeUserId === me.userId
      ? "self"
      : a.employeeUserId !== me.userId &&
          ((a.state === "manager" && (a.managerUserId === me.userId || hr)) || (a.state === "self" && hr))
        ? "manager"
        : null;
  const submit = async () => {
    if (!mode) return;
    setError(null);
    try {
      setA(
        await api<Appraisal>(`/appraisals/${id}/${mode}`, {
          method: "PUT",
          body: { lines: a.lines.map((x) => ({ id: x.id, score: scores[x.id] })), comment: comment || null },
        }),
      );
    } catch (e) {
      setError(errorText(e));
    }
  };
  const calibrate = async () => {
    setError(null);
    try {
      setA(
        await api<Appraisal>(`/appraisals/${id}/calibrate`, {
          method: "POST",
          body: {
            finalScore: calib.finalScore ? Number(calib.finalScore) : null,
            rating: calib.rating || null,
            raisePercent: calib.raisePercent ? Number(calib.raisePercent) : null,
            comment: calib.comment || null,
          },
        }),
      );
    } catch (e) {
      setError(errorText(e));
    }
  };
  const n = (v: string | null) => (v ? Number(v).toFixed(2) : "—");

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>
          {a.employeeName} <small className="muted">{a.cycleName}</small>
        </h1>
        <span className={`badge state-${a.state === "done" ? "sale" : "draft"}`}>
          {tx(APPRAISAL_STATE_LABEL[a.state]!)}
        </span>
        {can(me.permissions, "hr.read") && (
          <Link href={`/hr/appraisals/${a.cycleId}`}>{l("Kembali ke siklus", "Back to cycle")}</Link>
        )}
      </header>
      <p className="muted">
        {l("Penilai", "Reviewer")}: {a.managerName ?? "HR"} · {l("skor diri", "self")} {n(a.selfScore)} ·{" "}
        {l("skor atasan", "manager")} {n(a.managerScore)}
        {a.finalScore && (
          <>
            {" "}
            · {l("akhir", "final")} <strong>{n(a.finalScore)}</strong> · {l("predikat", "rating")}{" "}
            <strong>{a.rating}</strong> · {l("usulan kenaikan", "raise")} {Number(a.raisePercent)}%
          </>
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="table-scroll">
        <table className="lines">
          <thead>
            <tr>
              <th>{l("Indikator", "Indicator")}</th>
              <th className="num">{l("Bobot", "Weight")}</th>
              <th className="num">{l("Diri", "Self")}</th>
              <th className="num">{l("Atasan", "Manager")}</th>
              {mode && <th>{l("Nilai Anda (1–5)", "Your score (1–5)")}</th>}
            </tr>
          </thead>
          <tbody>
            {a.lines.map((x) => (
              <tr key={x.id}>
                <td>
                  {x.name}
                  {x.comment && <small className="muted"> — {x.comment}</small>}
                </td>
                <td className="num">{Number(x.weight)}</td>
                <td className="num">{x.selfScore ?? "—"}</td>
                <td className="num">{x.managerScore ?? "—"}</td>
                {mode && (
                  <td>
                    <span role="radiogroup" aria-label={x.name}>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <label key={s} className="check" style={{ marginRight: 8 }}>
                          <input
                            type="radio"
                            name={`score-${x.id}`}
                            checked={scores[x.id] === s}
                            onChange={() => setScores((v) => ({ ...v, [x.id]: s }))}
                          />
                          {s}
                        </label>
                      ))}
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(a.employeeComment || a.managerComment || a.hrComment) && (
        <dl>
          {a.employeeComment && (
            <>
              <dt>{l("Catatan karyawan", "Employee note")}</dt>
              <dd>{a.employeeComment}</dd>
            </>
          )}
          {a.managerComment && (
            <>
              <dt>{l("Catatan atasan", "Manager note")}</dt>
              <dd>{a.managerComment}</dd>
            </>
          )}
          {a.hrComment && (
            <>
              <dt>{l("Catatan HR", "HR note")}</dt>
              <dd>{a.hrComment}</dd>
            </>
          )}
        </dl>
      )}
      {mode && (
        <div className="inline-panel">
          <label className="field">
            <span>{l("Catatan", "Note")}</span>
            <input value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          <button
            type="button"
            className="primary"
            disabled={a.lines.some((x) => !scores[x.id])}
            onClick={submit}
          >
            {mode === "self"
              ? l("Kirim penilaian diri", "Submit self-assessment")
              : l("Kirim penilaian atasan", "Submit review")}
          </button>
        </div>
      )}
      {a.state === "calibration" && hr && (
        <div className="inline-panel">
          <label className="field">
            <span>{l("Skor akhir (kosong = skor atasan)", "Final score (empty = manager)")}</span>
            <input
              className="num"
              inputMode="decimal"
              value={calib.finalScore}
              onChange={(e) => setCalib((c) => ({ ...c, finalScore: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>{l("Predikat", "Rating")}</span>
            <select
              value={calib.rating}
              onChange={(e) => setCalib((c) => ({ ...c, rating: e.target.value }))}
            >
              <option value="">{l("(dari skor)", "(from score)")}</option>
              {["A", "B", "C", "D", "E"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Kenaikan upah % (kosong = bawaan)", "Raise % (empty = default)")}</span>
            <input
              className="num"
              inputMode="decimal"
              value={calib.raisePercent}
              onChange={(e) => setCalib((c) => ({ ...c, raisePercent: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>{l("Catatan HR", "HR note")}</span>
            <input
              value={calib.comment}
              onChange={(e) => setCalib((c) => ({ ...c, comment: e.target.value }))}
            />
          </label>
          <button type="button" className="primary" onClick={calibrate}>
            {l("Kalibrasi & selesaikan", "Calibrate & finish")}
          </button>
        </div>
      )}
    </div>
  );
}
