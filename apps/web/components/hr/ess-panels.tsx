"use client";

import { FEEDBACK_COMPETENCIES } from "@erp/shared";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { formatDate, money, today } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { RefSelect } from "../ref-select";
import { errorText } from "./hr-panels";
import { ask } from "../feedback";

// ---- Sasaran ----

export interface Goal {
  id: string;
  parentId: string | null;
  employeeId: string | null;
  departmentId: string | null;
  employeeName: string | null;
  departmentName: string | null;
  title: string;
  metric: "percent" | "number" | "currency" | "boolean";
  startValue: string;
  targetValue: string;
  currentValue: string;
  unit: string | null;
  weight: string;
  dueDate: string | null;
  state: "draft" | "active" | "done" | "cancelled";
  progress: number;
  canEdit: boolean;
}

const GOAL_STATE: Record<Goal["state"], [string, string]> = {
  draft: ["Draft", "Draft"],
  active: ["Aktif", "Active"],
  done: ["Selesai", "Done"],
  cancelled: ["Dibatalkan", "Cancelled"],
};

function GoalValue({ g }: { g: Goal }) {
  const { l, locale } = useI18n();
  if (g.metric === "boolean")
    return <>{Number(g.currentValue) >= 1 ? l("Tercapai", "Achieved") : l("Belum", "Not yet")}</>;
  const fmt = (v: string) => (g.metric === "currency" ? money(v, locale) : Number(v).toLocaleString(locale));
  return (
    <>
      {fmt(g.currentValue)} / {fmt(g.targetValue)} {g.unit ?? (g.metric === "percent" ? "%" : "")}
    </>
  );
}

/** Pohon sasaran (perusahaan → departemen → karyawan) dengan bilah progres & check-in. */
export function GoalTree({ path, allowCreate }: { path: string; allowCreate: boolean }) {
  const { l, locale } = useI18n();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [checkin, setCheckin] = useState<{ id: string; value: string; note: string } | null>(null);
  const [form, setForm] = useState<null | {
    parentId: string;
    employeeId: string;
    title: string;
    metric: Goal["metric"];
    targetValue: string;
    unit: string;
    weight: string;
    dueDate: string;
  }>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<Goal[]>(path).then(setGoals, (e) => setError(errorText(e))), [path]);
  useEffect(() => {
    void load();
  }, [load]);
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }
  const ids = new Set(goals.map((g) => g.id));
  const roots = goals.filter((g) => !g.parentId || !ids.has(g.parentId));
  const kids = (id: string) => goals.filter((g) => g.parentId === id);
  const row = (g: Goal, depth: number): ReactNode => (
    <li key={g.id}>
      <div className="goal-row" style={{ paddingLeft: depth * 18 }}>
        <div className="goal-title">
          <strong>{g.title}</strong>
          <small className="muted">
            {" "}
            · {g.employeeName ?? g.departmentName ?? l("Perusahaan", "Company")}
            {g.dueDate ? ` · ${formatDate(g.dueDate, locale)}` : ""}
            {g.state !== "active" ? ` · ${l(...GOAL_STATE[g.state])}` : ""}
          </small>
        </div>
        <div className="goal-progress" title={`${g.progress}%`}>
          <span style={{ width: `${g.progress}%` }} />
        </div>
        <span className="goal-pct">{g.progress}%</span>
        <span className="goal-value muted">{!kids(g.id).length && <GoalValue g={g} />}</span>
        <span className="goal-actions">
          {g.canEdit && g.state === "active" && !kids(g.id).length && (
            <button
              type="button"
              className="link"
              onClick={() => setCheckin({ id: g.id, value: g.currentValue, note: "" })}
            >
              {l("Check-in", "Check in")}
            </button>
          )}
          {allowCreate && (
            <button
              type="button"
              className="link"
              onClick={() =>
                setForm({
                  parentId: g.id,
                  employeeId: g.employeeId ?? "",
                  title: "",
                  metric: "number",
                  targetValue: "",
                  unit: "",
                  weight: "1",
                  dueDate: "",
                })
              }
            >
              {l("+ Turunan", "+ Sub-goal")}
            </button>
          )}
          {g.canEdit && allowCreate && (
            <button
              type="button"
              className="link"
              onClick={async () =>
                (await ask(
                  l("Hapus sasaran ini beserta turunannya?", "Delete this goal and its sub-goals?"),
                )) && run(() => api(`/goals/${g.id}`, { method: "DELETE" }))
              }
            >
              {l("Hapus", "Delete")}
            </button>
          )}
        </span>
      </div>
      {checkin?.id === g.id && (
        <div className="inline-panel" style={{ marginLeft: depth * 18 }}>
          <label className="field">
            <span>
              {g.metric === "boolean"
                ? l("Tercapai (1 = ya)", "Achieved (1 = yes)")
                : l("Nilai terbaru", "Current value")}
            </span>
            <input
              className="num"
              inputMode="decimal"
              value={checkin.value}
              onChange={(e) => setCheckin({ ...checkin, value: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Catatan", "Note")}</span>
            <input
              maxLength={1000}
              value={checkin.note}
              onChange={(e) => setCheckin({ ...checkin, note: e.target.value })}
            />
          </label>
          <button
            type="button"
            className="primary"
            onClick={() =>
              run(async () => {
                await api(`/goals/${g.id}/checkins`, {
                  method: "POST",
                  body: { value: checkin.value, note: checkin.note || null },
                });
                setCheckin(null);
              })
            }
          >
            {l("Simpan", "Save")}
          </button>
          <button type="button" onClick={() => setCheckin(null)}>
            {l("Batal", "Cancel")}
          </button>
        </div>
      )}
      {kids(g.id).length > 0 && <ul className="goal-tree">{kids(g.id).map((k) => row(k, depth + 1))}</ul>}
    </li>
  );

  return (
    <div>
      {error && <p className="error">{error}</p>}
      {allowCreate && !form && (
        <button
          type="button"
          onClick={() =>
            setForm({
              parentId: "",
              employeeId: "",
              title: "",
              metric: "percent",
              targetValue: "100",
              unit: "",
              weight: "1",
              dueDate: "",
            })
          }
        >
          {l("Sasaran baru", "New goal")}
        </button>
      )}
      {form && (
        <form
          className="inline-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api("/goals", {
                method: "POST",
                body: {
                  parentId: form.parentId || null,
                  employeeId: form.employeeId || null,
                  title: form.title,
                  metric: form.metric,
                  targetValue: form.metric === "boolean" ? 1 : form.targetValue,
                  unit: form.unit || null,
                  weight: form.weight,
                  dueDate: form.dueDate || null,
                },
              });
              setForm(null);
            });
          }}
        >
          <label className="field">
            <span>{l("Judul sasaran", "Goal title")}</span>
            <input
              required
              maxLength={300}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Karyawan (kosong = perusahaan)", "Employee (empty = company)")}</span>
            <RefSelect
              name="employeeId"
              resource="employees"
              display="name"
              value={form.employeeId}
              onChange={(v) => setForm({ ...form, employeeId: v })}
            />
          </label>
          <label className="field">
            <span>{l("Metrik", "Metric")}</span>
            <select
              value={form.metric}
              onChange={(e) => setForm({ ...form, metric: e.target.value as Goal["metric"] })}
            >
              <option value="percent">%</option>
              <option value="number">{l("Angka", "Number")}</option>
              <option value="currency">{l("Rupiah", "Currency")}</option>
              <option value="boolean">{l("Ya/tidak", "Yes/no")}</option>
            </select>
          </label>
          {form.metric !== "boolean" && (
            <label className="field">
              <span>{l("Target", "Target")}</span>
              <input
                required
                className="num"
                inputMode="decimal"
                value={form.targetValue}
                onChange={(e) => setForm({ ...form, targetValue: e.target.value })}
              />
            </label>
          )}
          <label className="field">
            <span>{l("Satuan", "Unit")}</span>
            <input
              maxLength={30}
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Bobot", "Weight")}</span>
            <input
              className="num"
              inputMode="decimal"
              value={form.weight}
              onChange={(e) => setForm({ ...form, weight: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Tenggat", "Due date")}</span>
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </label>
          <button className="primary">{l("Simpan", "Save")}</button>
          <button type="button" onClick={() => setForm(null)}>
            {l("Batal", "Cancel")}
          </button>
        </form>
      )}
      <ul className="goal-tree">{roots.map((g) => row(g, 0))}</ul>
      {!goals.length && <p className="muted">{l("Belum ada sasaran.", "No goals yet.")}</p>}
    </div>
  );
}

// ---- Who's Off ----

export function WhosOffPanel() {
  const { l, locale } = useI18n();
  const [from, setFrom] = useState(today());
  const [data, setData] = useState<{
    items: {
      id: string;
      employeeName: string;
      departmentName: string | null;
      dateFrom: string;
      dateTo: string;
      leaveType: string | null;
      halfDay: string | null;
    }[];
  } | null>(null);
  useEffect(() => {
    api<typeof data>(`/me/whos-off?from=${from}`).then(setData, () => setData({ items: [] }));
  }, [from]);
  return (
    <section className="panel">
      <header className="toolbar">
        <h2>{l("Siapa yang cuti (2 minggu)", "Who's off (2 weeks)")}</h2>
        <input
          type="date"
          aria-label={l("Mulai", "From")}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </header>
      <ul className="whos-off">
        {data?.items.map((i) => (
          <li key={i.id}>
            <strong>{i.employeeName}</strong>
            <small className="muted"> {i.departmentName ?? ""}</small>
            <span>
              {formatDate(i.dateFrom, locale)}
              {i.dateTo !== i.dateFrom ? ` – ${formatDate(i.dateTo, locale)}` : ""}
              {i.halfDay ? ` (${l("½ hari", "½ day")})` : ""}
              {i.leaveType ? ` · ${i.leaveType}` : ""}
            </span>
          </li>
        ))}
        {data && !data.items.length && (
          <li className="muted">{l("Tidak ada yang cuti.", "Nobody is off.")}</li>
        )}
      </ul>
    </section>
  );
}

// ---- Pengumuman (portal) ----

interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
  readAt: string | null;
}

export function AnnouncementsFeed() {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Announcement[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => api<Announcement[]>("/me/announcements").then(setRows, () => setRows([]));
  useEffect(() => {
    void load();
  }, []);
  if (!rows.length) return null;
  return (
    <section className="panel">
      <h2>{l("Pengumuman", "Announcements")}</h2>
      <ul className="announcements">
        {rows.map((a) => (
          <li key={a.id} className={a.readAt ? "" : "unread"}>
            <button
              type="button"
              className="link"
              onClick={() => {
                setOpen(open === a.id ? null : a.id);
                if (!a.readAt) void api(`/me/announcements/${a.id}/read`, { method: "POST" }).then(load);
              }}
            >
              {a.pinned ? "📌 " : ""}
              {a.title}
            </button>
            <small className="muted"> {formatDate(a.publishedAt.slice(0, 10), locale)}</small>
            {open === a.id && <p className="announcement-body">{a.body}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- Feedback 360 ----

interface FeedbackRequest {
  id: string;
  subjectName: string;
  relation: string;
  state: "pending" | "submitted" | "declined";
  dueDate: string | null;
}

const RELATION: Record<string, [string, string]> = {
  peer: ["Rekan kerja", "Peer"],
  subordinate: ["Bawahan", "Direct report"],
  manager: ["Atasan", "Manager"],
  self: ["Diri sendiri", "Self"],
  other: ["Lainnya", "Other"],
};

/** Permintaan feedback yang perlu saya isi (portal). */
export function FeedbackInbox() {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<FeedbackRequest[]>([]);
  const [form, setForm] = useState<{
    id: string;
    scores: Record<string, number>;
    strengths: string;
    improvements: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<FeedbackRequest[]>("/me/feedback-requests").then(setRows, () => setRows([]));
  useEffect(() => {
    void load();
  }, []);
  const pending = rows.filter((r) => r.state === "pending");
  if (!pending.length) return null;
  return (
    <section className="panel">
      <h2>{l("Permintaan feedback", "Feedback requests")}</h2>
      {error && <p className="error">{error}</p>}
      <ul className="plain-list">
        {pending.map((r) => (
          <li key={r.id}>
            <strong>{r.subjectName}</strong>{" "}
            <small className="muted">({l(...(RELATION[r.relation] ?? RELATION.other!))})</small>
            {r.dueDate ? (
              <small className="muted">
                {" "}
                · {l("tenggat", "due")} {formatDate(r.dueDate, locale)}
              </small>
            ) : null}{" "}
            <button
              type="button"
              className="link"
              onClick={() => setForm({ id: r.id, scores: {}, strengths: "", improvements: "" })}
            >
              {l("Isi", "Answer")}
            </button>{" "}
            <button
              type="button"
              className="link"
              onClick={() =>
                api(`/feedback-requests/${r.id}/decline`, { method: "POST" }).then(load, (e) =>
                  setError(errorText(e)),
                )
              }
            >
              {l("Tolak", "Decline")}
            </button>
            {form?.id === r.id && (
              <div className="inline-panel feedback-form">
                {FEEDBACK_COMPETENCIES.map((c) => (
                  <label key={c.key} className="field">
                    <span>{l(c.label[0], c.label[1])}</span>
                    <select
                      value={form.scores[c.key] ?? ""}
                      onChange={(e) => {
                        const scores = { ...form.scores };
                        if (e.target.value) scores[c.key] = Number(e.target.value);
                        else delete scores[c.key];
                        setForm({ ...form, scores });
                      }}
                    >
                      <option value="">—</option>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <label className="field wide">
                  <span>{l("Kekuatan", "Strengths")}</span>
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={form.strengths}
                    onChange={(e) => setForm({ ...form, strengths: e.target.value })}
                  />
                </label>
                <label className="field wide">
                  <span>{l("Saran perbaikan", "Suggestions")}</span>
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={form.improvements}
                    onChange={(e) => setForm({ ...form, improvements: e.target.value })}
                  />
                </label>
                <p className="muted wide">
                  {l("Jawaban Anda ditampilkan secara anonim.", "Your answers are shown anonymously.")}
                </p>
                <button
                  type="button"
                  className="primary"
                  disabled={!Object.keys(form.scores).length}
                  onClick={() =>
                    api(`/feedback-requests/${r.id}`, {
                      method: "PUT",
                      body: {
                        scores: form.scores,
                        strengths: form.strengths || null,
                        improvements: form.improvements || null,
                      },
                    }).then(
                      () => {
                        setForm(null);
                        void load();
                      },
                      (e) => setError(errorText(e)),
                    )
                  }
                >
                  {l("Kirim feedback", "Send feedback")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface Summary {
  responses: number;
  pending: number;
  competencies: { key: string; average: number | null; byRelation: Record<string, number | null> }[];
  relations: { relation: string; count: number }[];
  strengths: string[];
  improvements: string[];
}

/** Feedback 360 di halaman karyawan: minta feedback & ringkasan anonim. */
export function FeedbackPanel({ employeeId }: { employeeId: string }) {
  const { l } = useI18n();
  const [s, setS] = useState<Summary | null>(null);
  const [reviewer, setReviewer] = useState("");
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [relation, setRelation] = useState("peer");
  const [dueDate, setDueDate] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () => api<Summary>(`/employees/${employeeId}/feedback-summary`).then(setS, (e) => setError(errorText(e))),
    [employeeId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="panel">
      <h2>{l("Feedback 360", "360 feedback")}</h2>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      <div className="inline-panel">
        <label className="field">
          <span>{l("Penilai", "Reviewer")}</span>
          <RefSelect
            name="reviewer"
            resource="users"
            display="name"
            value={reviewer}
            onChange={(v) => {
              if (v && !reviewers.includes(v)) setReviewers([...reviewers, v]);
              setReviewer("");
            }}
          />
        </label>
        <label className="field">
          <span>{l("Relasi", "Relation")}</span>
          <select value={relation} onChange={(e) => setRelation(e.target.value)}>
            {Object.entries(RELATION).map(([k, v]) => (
              <option key={k} value={k}>
                {l(...v)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{l("Tenggat", "Due date")}</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <button
          type="button"
          className="primary"
          disabled={!reviewers.length}
          onClick={() =>
            api<{ created: number }>("/feedback-requests", {
              method: "POST",
              body: {
                subjectEmployeeId: employeeId,
                reviewerUserIds: reviewers,
                relation,
                dueDate: dueDate || null,
              },
            }).then(
              (r) => {
                setNotice(
                  l(`${r.created} permintaan feedback dikirim.`, `${r.created} feedback requests sent.`),
                );
                setReviewers([]);
                void load();
              },
              (e) => setError(errorText(e)),
            )
          }
        >
          {l(`Minta feedback (${reviewers.length})`, `Request feedback (${reviewers.length})`)}
        </button>
      </div>
      {s && (
        <>
          <p className="muted">
            {l(
              `${s.responses} jawaban · ${s.pending} menunggu`,
              `${s.responses} responses · ${s.pending} pending`,
            )}
          </p>
          {s.responses > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{l("Kompetensi", "Competency")}</th>
                    <th className="num">{l("Rata-rata", "Average")}</th>
                    {s.relations.map((r) => (
                      <th key={r.relation} className="num">
                        {l(...(RELATION[r.relation] ?? RELATION.other!))} ({r.count})
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.competencies.map((c) => {
                    const def = FEEDBACK_COMPETENCIES.find((x) => x.key === c.key)!;
                    return (
                      <tr key={c.key}>
                        <td>{l(def.label[0], def.label[1])}</td>
                        <td className="num">{c.average ?? "—"}</td>
                        {s.relations.map((r) => (
                          <td key={r.relation} className="num">
                            {c.byRelation[r.relation] ?? "—"}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {s.strengths.length > 0 && (
            <>
              <h3>{l("Kekuatan", "Strengths")}</h3>
              <ul>
                {s.strengths.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </>
          )}
          {s.improvements.length > 0 && (
            <>
              <h3>{l("Saran perbaikan", "Suggestions")}</h3>
              <ul>
                {s.improvements.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

// ---- Catatan atasan ----

interface Note {
  id: string;
  body: string;
  visibility: "private" | "hr";
  authorName: string | null;
  createdAt: string;
  mine: boolean;
}

export function NotesPanel({ employeeId }: { employeeId: string }) {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Note[] | null>(null);
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () => api<Note[]>(`/employees/${employeeId}/notes`).then(setRows, () => setRows(null)),
    [employeeId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!rows) return null;
  return (
    <section className="panel">
      <h2>{l("Catatan atasan / HR", "Manager & HR notes")}</h2>
      <p className="muted">{l("Tidak pernah terlihat oleh karyawan.", "Never visible to the employee.")}</p>
      {error && <p className="error">{error}</p>}
      <ul className="notes">
        {rows.map((n) => (
          <li key={n.id}>
            <p>{n.body}</p>
            <small className="muted">
              {n.authorName} · {formatDate(n.createdAt.slice(0, 10), locale)} ·{" "}
              {n.visibility === "hr" ? l("terlihat HR", "visible to HR") : l("privat", "private")}
              {n.mine && (
                <>
                  {" "}
                  ·{" "}
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      api(`/employee-notes/${n.id}`, { method: "DELETE" }).then(load, (e) =>
                        setError(errorText(e)),
                      )
                    }
                  >
                    {l("Hapus", "Delete")}
                  </button>
                </>
              )}
            </small>
          </li>
        ))}
      </ul>
      <div className="inline-panel">
        <label className="field wide">
          <span>{l("Catatan baru", "New note")}</span>
          <textarea rows={2} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <label className="field">
          <span>{l("Visibilitas", "Visibility")}</span>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            <option value="private">{l("Hanya saya", "Only me")}</option>
            <option value="hr">{l("Saya & HR", "Me & HR")}</option>
          </select>
        </label>
        <button
          type="button"
          className="primary"
          disabled={!body.trim()}
          onClick={() =>
            api(`/employees/${employeeId}/notes`, { method: "POST", body: { body, visibility } }).then(
              () => {
                setBody("");
                void load();
              },
              (e) => setError(errorText(e)),
            )
          }
        >
          {l("Simpan catatan", "Save note")}
        </button>
      </div>
    </section>
  );
}
