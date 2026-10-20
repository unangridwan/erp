"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { api, ApiError } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

interface Pending {
  model: "leave_request" | "overtime" | "expense_claim";
  id: string;
  employeeName: string;
  summary: string;
  step: number;
  levels: number;
  mine: boolean;
}
interface Status {
  waitingFor: string | null;
  history: {
    step: number;
    decision: string;
    note: string | null;
    createdAt: string;
    userName: string | null;
  }[];
}

/** Kotak persetujuan: cuti & lembur yang menunggu keputusan user ini (atasan per tahap, atau HR). */
export default function ApprovalsPage() {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Pending[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, Status>>({});
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Pending[]>("/approvals/pending")
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [version]);

  async function decide(r: Pending, decision: "approve" | "refuse") {
    setError(null);
    const path =
      r.model === "leave_request"
        ? `/leaves/${r.id}/${decision}`
        : r.model === "expense_claim"
          ? `/expense-claims/${r.id}/${decision}`
          : `/approvals/overtime/${r.id}/${decision}`;
    try {
      await api(path, { method: "POST", body: { note: notes[r.id] || null } });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  async function toggleHistory(r: Pending) {
    if (history[r.id]) {
      setHistory(({ [r.id]: _, ...rest }) => rest);
      return;
    }
    const s = await api<Status>(`/approvals/${r.model}/${r.id}`);
    setHistory((h) => ({ ...h, [r.id]: s }));
  }
  const time = (v: string) =>
    new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(v));

  return (
    <>
      <header className="toolbar">
        <h1>{l("Persetujuan", "Approvals")}</h1>
      </header>
      <p className="muted">
        {l(
          "Tahap 1 disetujui atasan langsung, tahap 2 atasan dari atasan, tahap 3 HR. Jumlah tahap diatur di Pengaturan Payroll.",
          "Step 1 is approved by the direct manager, step 2 by the manager's manager, step 3 by HR. The number of steps is set in Payroll Settings.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Jenis", "Type")}</th>
                <th>{l("Karyawan", "Employee")}</th>
                <th>{l("Pengajuan", "Request")}</th>
                <th>{l("Tahap", "Step")}</th>
                <th>{l("Catatan", "Note")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td>
                      {r.model === "leave_request" ? (
                        l("Cuti", "Time off")
                      ) : r.model === "expense_claim" ? (
                        <Link href={`/hr/expenses/${r.id}`}>{l("Klaim biaya", "Expense claim")}</Link>
                      ) : (
                        l("Lembur", "Overtime")
                      )}
                    </td>
                    <td>{r.employeeName}</td>
                    <td>{r.summary}</td>
                    <td>
                      {r.step}/{r.levels}{" "}
                      {!r.mine && <span className="badge state-draft">{l("sebagai HR", "as HR")}</span>}
                    </td>
                    <td>
                      <input
                        aria-label={l("Catatan", "Note")}
                        value={notes[r.id] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                      />
                    </td>
                    <td>
                      <button type="button" className="link" onClick={() => decide(r, "approve")}>
                        {l("Setujui", "Approve")}
                      </button>{" "}
                      <button type="button" className="link" onClick={() => decide(r, "refuse")}>
                        {l("Tolak", "Refuse")}
                      </button>{" "}
                      <button type="button" className="link" onClick={() => toggleHistory(r)}>
                        {l("Riwayat", "History")}
                      </button>
                    </td>
                  </tr>
                  {history[r.id] && (
                    <tr>
                      <td colSpan={6} className="muted">
                        {history[r.id]!.history.length === 0
                          ? l("Belum ada keputusan.", "No decisions yet.")
                          : history[r.id]!.history.map((h) => (
                              <div key={h.createdAt}>
                                {l("Tahap", "Step")} {h.step}: {h.userName ?? "—"} —{" "}
                                {h.decision === "approved"
                                  ? l("disetujui", "approved")
                                  : l("ditolak", "refused")}{" "}
                                ({time(h.createdAt)}){h.note ? ` — ${h.note}` : ""}
                              </div>
                            ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {l("Tidak ada pengajuan yang menunggu Anda.", "Nothing is waiting for you.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
