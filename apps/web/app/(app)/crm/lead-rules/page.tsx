"use client";

import { CONDITION_OP_LABEL, LEAD_RULE_FIELDS, scoreGrade, type AutomationCondition } from "@erp/shared";
import { useEffect, useState } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { LeadConditions } from "../../../../components/crm/lead-conditions";
import { ask, toast } from "../../../../components/feedback";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface ScoringRule {
  id: string;
  name: string;
  conditions: AutomationCondition[];
  points: number;
  active: boolean;
}
interface AssignmentRule {
  id: string;
  name: string;
  sequence: number;
  conditions: AutomationCondition[];
  userIds: string[];
  teamId: string | null;
  active: boolean;
}

/** Aturan skor lead dan aturan penugasan lead otomatis. */
export default function LeadRulesPage() {
  const me = useMe();
  const { l } = useI18n();
  const editable = can(me.permissions, "crm.manage");
  const users = useOptions<{ id: string; name: string }>("/users/options");
  const teams = useOptions<{ id: string; name: string }>("/sales-teams");
  const [scoring, setScoring] = useState<ScoringRule[]>([]);
  const [assignment, setAssignment] = useState<AssignmentRule[]>([]);
  const [score, setScore] = useState<Partial<ScoringRule> | null>(null);
  const [assign, setAssign] = useState<Partial<AssignmentRule> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api<{ items: ScoringRule[] }>("/crm/scoring-rules?limit=200")
      .then((d) => setScoring(d.items))
      .catch((e: Error) => setError(e.message));
    api<{ items: AssignmentRule[] }>("/crm/assignment-rules?limit=200")
      .then((d) => setAssignment(d.items))
      .catch((e: Error) => setError(e.message));
  }, [version]);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(
        e instanceof ApiError && Object.keys(e.fieldErrors).length
          ? Object.values(e.fieldErrors).join("; ")
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  }
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? "";
  const condText = (c: AutomationCondition[]) =>
    c.length
      ? c
          .map((x) => {
            const field = LEAD_RULE_FIELDS.find((f) => f.key === x.field);
            const op = CONDITION_OP_LABEL[x.op];
            return [field ? l(...field.label) : x.field, op ? l(...op) : x.op, x.value]
              .filter(Boolean)
              .join(" ");
          })
          .join(l(" dan ", " and "))
      : l("(semua lead)", "(all leads)");
  const remove = (path: string, name: string) =>
    run(async () => {
      if (!(await ask(l(`Hapus aturan "${name}"?`, `Delete rule "${name}"?`)))) return;
      await api(path, { method: "DELETE" });
    });

  return (
    <>
      <header className="toolbar">
        <h1>{l("Skor & Penugasan Lead", "Lead Scoring & Assignment")}</h1>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="panel">
        <header className="toolbar">
          <h2>{l("Aturan skor", "Scoring rules")}</h2>
          {editable && (
            <>
              <button onClick={() => setScore({ name: "", conditions: [], points: 10, active: true })}>
                {l("Aturan baru", "New rule")}
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    const r = await api<{ leads: number; changed: number }>("/crm/scoring-recompute", {
                      method: "POST",
                      body: {},
                    });
                    toast.success(
                      l(
                        `${r.leads} lead dihitung ulang, ${r.changed} berubah`,
                        `${r.leads} leads rescored, ${r.changed} changed`,
                      ),
                    );
                  })
                }
              >
                {l("Hitung ulang semua", "Recompute all")}
              </button>
            </>
          )}
        </header>
        <p className="muted">
          {l(
            `Skor lead 0–100 = jumlah poin aturan yang cocok, dihitung saat lead dibuat atau diubah. Grade: A ≥ 75, B ≥ 50, C ≥ 25, D di bawahnya (mis. skor 60 = ${scoreGrade(60)}).`,
            `Lead score 0–100 = sum of points of matching rules, computed when a lead is created or changed. Grade: A ≥ 75, B ≥ 50, C ≥ 25, D below (e.g. score 60 = ${scoreGrade(60)}).`,
          )}
        </p>
        {score && (
          <div className="stack inline-panel">
            <label className="field">
              <span>{l("Nama aturan", "Rule name")}</span>
              <input
                value={score.name ?? ""}
                onChange={(e) => setScore({ ...score, name: e.target.value })}
              />
            </label>
            <LeadConditions
              value={score.conditions ?? []}
              onChange={(conditions) => setScore({ ...score, conditions })}
            />
            <label className="field">
              <span>{l("Poin (−100 s.d. 100)", "Points (−100 to 100)")}</span>
              <input
                className="num"
                inputMode="numeric"
                style={{ width: 90 }}
                value={String(score.points ?? 0)}
                onChange={(e) => setScore({ ...score, points: Number(e.target.value) || 0 })}
              />
            </label>
            <div className="filters">
              <button
                className="primary"
                onClick={() =>
                  run(async () => {
                    const body = {
                      name: score.name,
                      conditions: score.conditions,
                      points: score.points,
                      active: score.active ?? true,
                    };
                    if (score.id) await api(`/crm/scoring-rules/${score.id}`, { method: "PATCH", body });
                    else await api("/crm/scoring-rules", { method: "POST", body });
                    setScore(null);
                  })
                }
              >
                {l("Simpan", "Save")}
              </button>
              <button className="link" onClick={() => setScore(null)}>
                {l("Batal", "Cancel")}
              </button>
            </div>
          </div>
        )}
        {scoring.length === 0 ? (
          <p className="muted">{l("Belum ada aturan skor.", "No scoring rules yet.")}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{l("Aturan", "Rule")}</th>
                  <th>{l("Syarat", "Conditions")}</th>
                  <th className="num">{l("Poin", "Points")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {scoring.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.name}
                      {!r.active && <span className="badge state-cancel">{l("Nonaktif", "Inactive")}</span>}
                    </td>
                    <td>{condText(r.conditions)}</td>
                    <td className="num">{r.points > 0 ? `+${r.points}` : r.points}</td>
                    <td>
                      {editable && (
                        <>
                          <button className="link" onClick={() => setScore(r)}>
                            {l("Ubah", "Edit")}
                          </button>{" "}
                          <button
                            className="link"
                            onClick={() => remove(`/crm/scoring-rules/${r.id}`, r.name)}
                          >
                            {l("Hapus", "Delete")}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <header className="toolbar">
          <h2>{l("Aturan penugasan", "Assignment rules")}</h2>
          {editable && (
            <>
              <button
                onClick={() =>
                  setAssign({ name: "", sequence: 10, conditions: [], userIds: [], active: true })
                }
              >
                {l("Aturan baru", "New rule")}
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    const r = await api<{ unassigned: number; assigned: number }>("/crm/assignment-apply", {
                      method: "POST",
                      body: {},
                    });
                    toast.success(
                      l(
                        `${r.assigned} dari ${r.unassigned} lead tanpa penanggung jawab ditugaskan`,
                        `${r.assigned} of ${r.unassigned} unassigned leads assigned`,
                      ),
                    );
                  })
                }
              >
                {l("Terapkan ke lead tanpa penanggung jawab", "Apply to unassigned leads")}
              </button>
            </>
          )}
        </header>
        <p className="muted">
          {l(
            "Berlaku untuk lead tanpa penanggung jawab (formulir web, impor, atau dibuat tanpa penugasan). Aturan pertama yang cocok dipakai; penerimanya bergiliran menurut beban lead terbuka. Bila tidak ada yang cocok, anggota wilayah lead yang menerima.",
            "Applies to leads without an owner (web forms, imports, or created unassigned). The first matching rule wins; recipients rotate by open-lead load. If none match, the lead's territory members receive it.",
          )}
        </p>
        {assign && (
          <div className="stack inline-panel">
            <div className="filters">
              <label className="field">
                <span>{l("Nama aturan", "Rule name")}</span>
                <input
                  value={assign.name ?? ""}
                  onChange={(e) => setAssign({ ...assign, name: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{l("Urutan", "Sequence")}</span>
                <input
                  className="num"
                  inputMode="numeric"
                  style={{ width: 80 }}
                  value={String(assign.sequence ?? 10)}
                  onChange={(e) => setAssign({ ...assign, sequence: Number(e.target.value) || 0 })}
                />
              </label>
              <label className="field">
                <span>{l("Tim (opsional)", "Team (optional)")}</span>
                <select
                  value={assign.teamId ?? ""}
                  onChange={(e) => setAssign({ ...assign, teamId: e.target.value || null })}
                >
                  <option value="">—</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <LeadConditions
              value={assign.conditions ?? []}
              onChange={(conditions) => setAssign({ ...assign, conditions })}
              emptyText={l("Tanpa syarat: berlaku untuk semua lead.", "No conditions: applies to all leads.")}
            />
            <fieldset className="field">
              <legend>{l("Penerima (bergiliran)", "Recipients (round-robin)")}</legend>
              <div className="filters">
                {users.map((u) => (
                  <label key={u.id}>
                    <input
                      type="checkbox"
                      checked={(assign.userIds ?? []).includes(u.id)}
                      onChange={(e) =>
                        setAssign({
                          ...assign,
                          userIds: e.target.checked
                            ? [...(assign.userIds ?? []), u.id]
                            : (assign.userIds ?? []).filter((x) => x !== u.id),
                        })
                      }
                    />{" "}
                    {u.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="filters">
              <button
                className="primary"
                onClick={() =>
                  run(async () => {
                    const body = {
                      name: assign.name,
                      sequence: assign.sequence,
                      conditions: assign.conditions,
                      userIds: assign.userIds,
                      teamId: assign.teamId ?? null,
                      active: assign.active ?? true,
                    };
                    if (assign.id) await api(`/crm/assignment-rules/${assign.id}`, { method: "PATCH", body });
                    else await api("/crm/assignment-rules", { method: "POST", body });
                    setAssign(null);
                  })
                }
              >
                {l("Simpan", "Save")}
              </button>
              <button className="link" onClick={() => setAssign(null)}>
                {l("Batal", "Cancel")}
              </button>
            </div>
          </div>
        )}
        {assignment.length === 0 ? (
          <p className="muted">{l("Belum ada aturan penugasan.", "No assignment rules yet.")}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>{l("Aturan", "Rule")}</th>
                  <th>{l("Syarat", "Conditions")}</th>
                  <th>{l("Penerima", "Recipients")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...assignment]
                  .sort((a, b) => a.sequence - b.sequence)
                  .map((r) => (
                    <tr key={r.id}>
                      <td className="num">{r.sequence}</td>
                      <td>
                        {r.name}
                        {!r.active && <span className="badge state-cancel">{l("Nonaktif", "Inactive")}</span>}
                      </td>
                      <td>{condText(r.conditions)}</td>
                      <td>{r.userIds.map(userName).filter(Boolean).join(", ")}</td>
                      <td>
                        {editable && (
                          <>
                            <button className="link" onClick={() => setAssign(r)}>
                              {l("Ubah", "Edit")}
                            </button>{" "}
                            <button
                              className="link"
                              onClick={() => remove(`/crm/assignment-rules/${r.id}`, r.name)}
                            >
                              {l("Hapus", "Delete")}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
