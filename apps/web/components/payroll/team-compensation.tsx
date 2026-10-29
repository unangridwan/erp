"use client";

import { useEffect, useState } from "react";
import type { CompensationState } from "@erp/shared";
import { api } from "../../lib/api";
import { formatDate, money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";

export const cycleStatePill = (s: CompensationState) =>
  s === "applied" || s === "approved" ? "ok" : s === "in_approval" ? "warn" : s === "cancel" ? "bad" : "";

interface TeamCycle {
  id: string;
  name: string;
  effectiveDate: string;
  proposals: {
    id: string;
    employeeName: string;
    employeeNumber: string;
    currentWage: string;
    newWage: string;
    rating: string | null;
    suggestedPercent: string;
    proposedPercent: string;
    reason: string | null;
  }[];
}

/** Portal atasan: isi usulan kenaikan untuk bawahan langsung selama siklus masih draft. */
export function TeamCompensation() {
  const { l, locale } = useI18n();
  const [cycles, setCycles] = useState<TeamCycle[] | null>(null);
  const [edits, setEdits] = useState<Record<string, { percent: string; reason: string }>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api<TeamCycle[]>("/me/team-compensation")
      .then(setCycles)
      .catch(() => setCycles([]));
  }, [version]);

  if (!cycles?.length) return null;

  const save = async (id: string) => {
    const e = edits[id];
    if (!e) return;
    setError(null);
    setSaved(null);
    try {
      await api(`/compensation-proposals/${id}`, {
        method: "PUT",
        body: { proposedPercent: Number(e.percent), reason: e.reason || null },
      });
      setSaved(id);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="panel stack proj-panel">
      <h2>{l("Usulan kenaikan gaji tim", "Team salary review")}</h2>
      {error && <p className="error">{error}</p>}
      {cycles.map((c) => (
        <div key={c.id} className="stack" style={{ alignSelf: "stretch" }}>
          <p>
            <strong>{c.name}</strong>{" "}
            <small className="muted">
              · {l("berlaku", "effective")} {formatDate(c.effectiveDate, locale)}
            </small>
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Karyawan", "Employee")}</th>
                  <th>{l("Predikat", "Rating")}</th>
                  <th className="num">{l("Upah sekarang", "Current wage")}</th>
                  <th className="num">{l("Saran", "Suggested")}</th>
                  <th className="num">{l("Usulan %", "Proposed %")}</th>
                  <th>{l("Alasan", "Reason")}</th>
                  <th className="num">{l("Upah baru", "New wage")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {c.proposals.map((p) => {
                  const e = edits[p.id] ?? {
                    percent: String(Number(p.proposedPercent)),
                    reason: p.reason ?? "",
                  };
                  const set = (patch: Partial<typeof e>) =>
                    setEdits((x) => ({ ...x, [p.id]: { ...e, ...patch } }));
                  return (
                    <tr key={p.id}>
                      <td>
                        {p.employeeName} <small className="muted">{p.employeeNumber}</small>
                      </td>
                      <td>{p.rating ?? "—"}</td>
                      <td className="num">{money(p.currentWage, locale)}</td>
                      <td className="num">{Number(p.suggestedPercent)}%</td>
                      <td className="num">
                        <input
                          className="num"
                          inputMode="decimal"
                          size={5}
                          aria-label={`${l("Usulan %", "Proposed %")} ${p.employeeName}`}
                          value={e.percent}
                          onChange={(ev) => set({ percent: ev.target.value })}
                        />
                      </td>
                      <td>
                        <input value={e.reason} onChange={(ev) => set({ reason: ev.target.value })} />
                      </td>
                      <td className="num">{money(p.newWage, locale)}</td>
                      <td>
                        <button type="button" onClick={() => save(p.id)} disabled={!edits[p.id]}>
                          {saved === p.id ? "✓" : l("Simpan", "Save")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
