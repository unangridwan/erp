"use client";

import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

interface Request {
  id: string;
  employeeName: string;
  changes: Record<string, string | null>;
  current: Record<string, string | null>;
  note: string | null;
  state: string;
  createdAt: string;
  decisionNote: string | null;
}

const LABELS: Record<string, [string, string]> = {
  address: ["Alamat", "Address"],
  workPhone: ["Telepon", "Phone"],
  emergencyContact: ["Kontak darurat", "Emergency contact"],
  emergencyPhone: ["Telepon kontak darurat", "Emergency phone"],
  bankName: ["Bank", "Bank"],
  bankAccount: ["No rekening", "Account number"],
  bankAccountName: ["Atas nama rekening", "Account holder"],
  ptkpStatus: ["Status PTKP", "PTKP status"],
};

/** Pengajuan perubahan data pribadi dari portal: bandingkan nilai lama & baru, setujui untuk menerapkan. */
export default function ChangeRequestsPage() {
  const { l } = useI18n();
  const [state, setState] = useState("confirm");
  const [rows, setRows] = useState<Request[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Request[]>(`/employee-change-requests${state ? `?state=${state}` : ""}`).then(setRows, (e: Error) =>
      setError(e.message),
    );
  }, [state, version]);
  const decide = (id: string, decision: "approve" | "refuse") =>
    api(`/employee-change-requests/${id}/${decision}`, {
      method: "POST",
      body: { note: notes[id] || null },
    }).then(
      () => setVersion((v) => v + 1),
      (e: Error) => setError(e.message),
    );

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Perubahan Data Karyawan", "Employee Data Changes")}</h1>
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label={l("Status", "Status")}>
          <option value="confirm">{l("Menunggu", "Pending")}</option>
          <option value="approved">{l("Disetujui", "Approved")}</option>
          <option value="refused">{l("Ditolak", "Refused")}</option>
          <option value="">{l("Semua", "All")}</option>
        </select>
      </header>
      <p className="muted">
        {l(
          "Diajukan karyawan dari portal. Setelah disetujui, data karyawan langsung diperbarui (nomor rekening tetap terenkripsi).",
          "Submitted by employees from the portal. Once approved the employee record is updated (account numbers stay encrypted).",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {rows?.length === 0 && <p className="muted">{l("Tidak ada pengajuan.", "No requests.")}</p>}
      {rows?.map((r) => (
        <section key={r.id} className="card stack">
          <strong>
            {r.employeeName} <small className="muted">{new Date(r.createdAt).toLocaleString()}</small>
          </strong>
          <div className="table-scroll">
            <table className="lines">
              <thead>
                <tr>
                  <th>{l("Data", "Field")}</th>
                  <th>{l("Saat ini", "Current")}</th>
                  <th>{l("Baru", "New")}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(r.changes).map(([k, v]) => (
                  <tr key={k}>
                    <td>{LABELS[k] ? l(...LABELS[k]) : k}</td>
                    <td className="muted">{r.current[k] ?? "—"}</td>
                    <td>
                      <strong>{v ?? "—"}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.note && <p className="muted">{r.note}</p>}
          {r.state === "confirm" ? (
            <div className="inline-panel">
              <label className="field">
                <span>{l("Catatan", "Note")}</span>
                <input
                  value={notes[r.id] ?? ""}
                  onChange={(e) => setNotes((x) => ({ ...x, [r.id]: e.target.value }))}
                />
              </label>
              <button type="button" className="primary" onClick={() => decide(r.id, "approve")}>
                {l("Setujui & terapkan", "Approve & apply")}
              </button>
              <button type="button" className="danger" onClick={() => decide(r.id, "refuse")}>
                {l("Tolak", "Refuse")}
              </button>
            </div>
          ) : (
            <p className="muted">
              {r.state === "approved" ? l("Disetujui", "Approved") : l("Ditolak", "Refused")}
              {r.decisionNote ? ` — ${r.decisionNote}` : ""}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
