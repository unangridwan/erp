"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { errorText } from "../../../../../components/hr/hr-panels";
import { api } from "../../../../../lib/api";
import { useI18n } from "../../../../../lib/i18n";
import { APPRAISAL_STATE_LABEL } from "../../../../../lib/resources";

interface Row {
  id: string;
  employeeName: string;
  managerName: string | null;
  state: string;
  selfScore: string | null;
  managerScore: string | null;
  finalScore: string | null;
  rating: string | null;
  raisePercent: string | null;
}
interface Cycle {
  id: string;
  name: string;
  state: string;
}

/** Siklus penilaian: buka (buat formulir per karyawan), progres per tahap, tutup. */
export default function AppraisalCyclePage() {
  const { id } = useParams<{ id: string }>();
  const { l, tx } = useI18n();
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Cycle[]>("/appraisal-cycles").then(
      (cs) => setCycle(cs.find((c) => c.id === id) ?? null),
      (e) => setError(errorText(e)),
    );
    api<Row[]>(`/appraisals?cycleId=${id}`).then(setRows, (e) => setError(errorText(e)));
  }, [id]);
  useEffect(load, [load]);
  const act = (path: string, message: (r: { created?: number }) => string) => {
    setError(null);
    api<{ created?: number }>(`/appraisal-cycles/${id}/${path}`, { method: "POST", body: {} }).then(
      (r) => {
        setNotice(message(r));
        load();
      },
      (e) => setError(errorText(e)),
    );
  };
  const n = (v: string | null) => (v ? Number(v).toFixed(2) : "—");
  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{cycle?.name ?? l("Siklus penilaian", "Appraisal cycle")}</h1>
        {cycle?.state !== "closed" && (
          <button
            type="button"
            className="primary"
            onClick={() =>
              act("start", (r) => l(`${r.created} formulir dibuat.`, `${r.created} forms created.`))
            }
          >
            {cycle?.state === "open"
              ? l("Tambah karyawan baru", "Add new employees")
              : l("Buka siklus", "Open cycle")}
          </button>
        )}
        {cycle?.state === "open" && (
          <button type="button" onClick={() => act("close", () => l("Siklus ditutup.", "Cycle closed."))}>
            {l("Tutup siklus", "Close cycle")}
          </button>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="notice">{notice}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Karyawan", "Employee")}</th>
              <th>{l("Atasan penilai", "Reviewer")}</th>
              <th>{l("Tahap", "Stage")}</th>
              <th className="num">{l("Diri", "Self")}</th>
              <th className="num">{l("Atasan", "Manager")}</th>
              <th className="num">{l("Akhir", "Final")}</th>
              <th>{l("Predikat", "Rating")}</th>
              <th className="num">{l("Usulan kenaikan", "Raise")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/hr/appraisal-forms/${r.id}`}>{r.employeeName}</Link>
                </td>
                <td>{r.managerName ?? "HR"}</td>
                <td>{tx(APPRAISAL_STATE_LABEL[r.state]!)}</td>
                <td className="num">{n(r.selfScore)}</td>
                <td className="num">{n(r.managerScore)}</td>
                <td className="num">{n(r.finalScore)}</td>
                <td>
                  <strong>{r.rating ?? ""}</strong>
                </td>
                <td className="num">{r.raisePercent ? `${Number(r.raisePercent)}%` : ""}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  {l("Belum ada formulir — buka siklus untuk membuatnya.", "No forms yet — open the cycle.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
