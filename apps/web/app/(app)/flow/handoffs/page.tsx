"use client";

import { FLOW_DEFS, FLOW_PROCESSES, recordHref, type FlowProcess, type FlowStatus } from "@erp/shared";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, toast } from "../../../../components/feedback";
import { LoadFailed, useLoadError } from "../../../../components/load-failed";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Item {
  id: string;
  model: string;
  name: string;
  partner: string | null;
  process: FlowProcess;
  processLabel: [string, string];
  stage: string;
  stageLabel: [string, string];
  waiting: [string, string];
  since: string;
  ageDays: number;
  due: string | null;
  slaDays: number | null;
  status: FlowStatus;
  value: number | null;
  owner: string | null;
  href: string | null;
  toDepartmentId: string | null;
  toDepartment: string | null;
  fromStage: string | null;
  fromStageLabel: [string, string] | null;
  fromDepartmentId: string | null;
  fromDepartment: string | null;
  lastReminder: { at: string; by: string | null } | null;
  canRemind: boolean;
}

interface Board {
  today: string;
  myDepartmentId: string | null;
  departments: { id: string; name: string }[];
  stats: {
    departmentId: string | null;
    department: string | null;
    incoming: { count: number; late: number; atRisk: number; avgAge: number | null };
    outgoing: { count: number; late: number };
  }[];
  links: {
    from: string | null;
    to: string | null;
    fromName: string | null;
    toName: string | null;
    count: number;
    late: number;
    avgAge: number | null;
  }[];
  total: number;
  items: Item[];
}

/**
 * Papan serah terima antar departemen: pekerjaan yang sedang menunggu di tiap departemen, dari departemen mana
 * diserahkan, sejak kapan & sisa/lewat SLA, serta tombol pengingat yang tercatat di riwayat dokumen.
 */
export default function HandoffBoardPage() {
  const { l, locale } = useI18n();
  const me = useMe();
  const processes = FLOW_PROCESSES.filter((p) => can(me.permissions, FLOW_DEFS[p].permission));
  const [process, setProcess] = useState<FlowProcess | "">("");
  const [department, setDepartment] = useState<string>("");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [status, setStatus] = useState<FlowStatus | "">("");
  const [board, setBoard] = useState<Board | null>(null);
  const [tick, setTick] = useState(0);
  const [error, fail] = useLoadError();
  const [remind, setRemind] = useState<Item | null>(null);
  const defaulted = useRef(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (process) p.set("process", process);
    if (department) {
      p.set("department", department);
      p.set("direction", direction);
    }
    if (status) p.set("status", status);
    return p.toString();
  }, [process, department, direction, status]);

  useEffect(() => {
    setBoard(null);
    api<Board>(`/flow/handoffs?${qs}`)
      .then((b) => {
        // Pertama kali dibuka: langsung ke antrean departemen sendiri.
        if (!defaulted.current) {
          defaulted.current = true;
          if (b.myDepartmentId) return setDepartment(b.myDepartmentId);
        }
        setBoard(b);
      })
      .catch(fail);
  }, [qs, tick, fail]);

  if (error) return <LoadFailed message={error} />;
  const deptName = (id: string | null) =>
    id === null
      ? l("Belum ditetapkan", "Not assigned")
      : (board?.departments.find((d) => d.id === id)?.name ?? "—");
  const selected = department === "none" ? null : department || undefined;
  const n = (v: number | null) => (v === null ? "—" : v.toLocaleString(locale === "id" ? "id-ID" : "en-US"));

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <nav className="breadcrumb">
            <Link href="/flow">{l("Alur Bisnis", "Business Flow")}</Link>
            <span>/</span>
            <h1>{l("Serah Terima", "Handoffs")}</h1>
          </nav>
        </div>
        <div className="cp-right handoff-filters">
          <select
            aria-label={l("Proses", "Process")}
            value={process}
            onChange={(e) => setProcess(e.target.value as FlowProcess | "")}
          >
            <option value="">{l("Semua proses", "All processes")}</option>
            {processes.map((p) => (
              <option key={p} value={p}>
                {l(...FLOW_DEFS[p].label)}
              </option>
            ))}
          </select>
          <select
            aria-label={l("Departemen", "Department")}
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">{l("Semua departemen", "All departments")}</option>
            {board?.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.id === board.myDepartmentId ? l(" (departemen saya)", " (my department)") : ""}
              </option>
            ))}
            <option value="none">{l("Belum ditetapkan", "Not assigned")}</option>
          </select>
          <select
            aria-label={l("Status", "Status")}
            value={status}
            onChange={(e) => setStatus(e.target.value as FlowStatus | "")}
          >
            <option value="">{l("Semua status", "All statuses")}</option>
            <option value="late">{l("Terlambat", "Late")}</option>
            <option value="at_risk">{l("Berisiko", "At risk")}</option>
            <option value="on_time">{l("Tepat waktu", "On time")}</option>
          </select>
        </div>
      </header>
      <p className="muted">
        {l(
          "Pekerjaan yang sedang menunggu di tiap departemen, dari departemen mana diserahkan, dan apakah masih dalam batas waktu. Departemen penanggung jawab tiap tahap diatur di Pengaturan SLA (bila belum, dicocokkan dari nama departemen).",
          "Work waiting in each department, which department handed it over, and whether it is still on time. Each stage's responsible department is set in SLA settings (otherwise it is matched by department name).",
        )}
      </p>

      {!board && <p className="muted">{l("Memuat…", "Loading…")}</p>}
      {board && (
        <>
          <section className="handoff-depts" aria-label={l("Beban per departemen", "Load per department")}>
            {board.stats.map((s) => {
              const key = s.departmentId ?? "none";
              return (
                <button
                  key={key}
                  type="button"
                  className={`handoff-dept${department === key ? " selected" : ""}${s.incoming.late ? " late" : ""}`}
                  aria-pressed={department === key}
                  onClick={() => {
                    setDepartment(department === key ? "" : key);
                    setDirection("in");
                  }}
                >
                  <span className="handoff-dept-name">
                    {s.department ?? deptName(s.departmentId)}
                    {s.departmentId && s.departmentId === board.myDepartmentId && (
                      <span className="badge">{l("Saya", "Mine")}</span>
                    )}
                  </span>
                  <strong>{n(s.incoming.count)}</strong>
                  <span className="muted small">{l("menunggu di sini", "waiting here")}</span>
                  <span className="flow-badges">
                    {s.incoming.late > 0 && (
                      <span className="badge danger">
                        {s.incoming.late} {l("terlambat", "late")}
                      </span>
                    )}
                    {s.incoming.atRisk > 0 && (
                      <span className="badge warn">
                        {s.incoming.atRisk} {l("berisiko", "at risk")}
                      </span>
                    )}
                  </span>
                  <span className="muted small">
                    {[
                      s.incoming.avgAge !== null &&
                        l(
                          `Umur rata-rata ${n(s.incoming.avgAge)} hari`,
                          `Average age ${n(s.incoming.avgAge)} days`,
                        ),
                      s.outgoing.count > 0 &&
                        l(
                          `Diserahkan ${s.outgoing.count} (${s.outgoing.late} terlambat di tujuan)`,
                          `Handed over ${s.outgoing.count} (${s.outgoing.late} late downstream)`,
                        ),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              );
            })}
          </section>

          {board.links.length > 0 && (
            <section className="panel handoff-panel">
              <h2>{l("Hubungan antar departemen", "Between departments")}</h2>
              <p className="muted small">
                {l(
                  "Pekerjaan yang diserahkan satu departemen dan sedang menunggu di departemen berikutnya.",
                  "Work handed over by one department and now waiting in the next one.",
                )}
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{l("Dari", "From")}</th>
                      <th>{l("Ke", "To")}</th>
                      <th className="num">{l("Dokumen", "Documents")}</th>
                      <th className="num">{l("Terlambat", "Late")}</th>
                      <th className="num">{l("Umur rata-rata (hari)", "Average age (days)")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.links.map((k) => (
                      <tr key={`${k.from}>${k.to}`} className={k.late ? "row-late" : undefined}>
                        <td>{k.fromName ?? deptName(k.from)}</td>
                        <td>{k.toName ?? deptName(k.to)}</td>
                        <td className="num">{n(k.count)}</td>
                        <td className="num">{n(k.late)}</td>
                        <td className="num">{n(k.avgAge)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="panel handoff-panel">
            <div className="panel-head">
              <h2>
                {selected === undefined && department !== "none"
                  ? l("Semua pekerjaan yang menunggu", "All waiting work")
                  : direction === "in"
                    ? l(
                        `Menunggu di ${deptName(selected ?? null)}`,
                        `Waiting in ${deptName(selected ?? null)}`,
                      )
                    : l(
                        `Diserahkan ${deptName(selected ?? null)} ke departemen lain`,
                        `Handed over by ${deptName(selected ?? null)}`,
                      )}
              </h2>
              {department && department !== "none" && (
                <div className="tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={direction === "in"}
                    className={direction === "in" ? "active" : ""}
                    onClick={() => setDirection("in")}
                  >
                    {l("Masuk", "Incoming")}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={direction === "out"}
                    className={direction === "out" ? "active" : ""}
                    onClick={() => setDirection("out")}
                  >
                    {l("Diserahkan", "Handed over")}
                  </button>
                </div>
              )}
            </div>
            {!board.items.length ? (
              <p className="muted">{l("Tidak ada pekerjaan yang menunggu.", "Nothing is waiting.")}</p>
            ) : (
              <div className="table-wrap">
                <table className="handoff-table">
                  <thead>
                    <tr>
                      <th>{l("Dokumen", "Document")}</th>
                      <th>{l("Menunggu", "Waiting for")}</th>
                      <th>{l("Dari", "From")}</th>
                      <th>{l("Di / pemegang", "At / holder")}</th>
                      <th className="num">{l("Umur (hari)", "Age (days)")}</th>
                      <th>{l("Batas", "Due")}</th>
                      <th>{l("Status", "Status")}</th>
                      <th>{l("Pengingat", "Reminder")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.items.map((h) => {
                      const href = h.href ?? recordHref(h.model, h.id);
                      return (
                        <tr
                          key={`${h.process}:${h.id}`}
                          className={h.status === "late" ? "row-late" : undefined}
                        >
                          <td>
                            {href ? <Link href={href}>{h.name}</Link> : h.name}
                            <div className="muted small">
                              {l(...h.processLabel)}
                              {h.partner && ` · ${h.partner}`}
                              {h.value !== null && h.value > 0 && ` · ${money(h.value, locale, 0)}`}
                            </div>
                          </td>
                          <td>
                            {l(...h.waiting)}
                            <div className="muted small">{l(...h.stageLabel)}</div>
                          </td>
                          <td>
                            {h.fromStage ? (h.fromDepartment ?? "—") : l("Awal alur", "Start")}
                            {h.fromStageLabel && <div className="muted small">{l(...h.fromStageLabel)}</div>}
                          </td>
                          <td>
                            {h.toDepartment ?? l("Belum ditetapkan", "Not assigned")}
                            {h.owner && <div className="muted small">{h.owner}</div>}
                          </td>
                          <td className="num">
                            {h.ageDays}
                            {h.slaDays !== null && <div className="muted small">SLA {h.slaDays}</div>}
                          </td>
                          <td>{h.due ? formatDate(h.due, locale) : "—"}</td>
                          <td>
                            <span
                              className={`badge ${h.status === "late" ? "danger" : h.status === "at_risk" ? "warn" : "ok"}`}
                            >
                              {h.status === "late"
                                ? l("Terlambat", "Late")
                                : h.status === "at_risk"
                                  ? l("Berisiko", "At risk")
                                  : l("Tepat waktu", "On time")}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="link"
                              disabled={!h.canRemind}
                              title={
                                h.canRemind
                                  ? undefined
                                  : l(
                                      "Belum ada pemegang lain atau manajer departemen yang punya akun pengguna.",
                                      "There is no other holder or department manager with a user account yet.",
                                    )
                              }
                              onClick={() => setRemind(h)}
                            >
                              {l("Ingatkan", "Remind")}
                            </button>
                            {h.lastReminder && (
                              <div className="muted small">
                                {formatDate(h.lastReminder.at.slice(0, 10), locale)}
                                {h.lastReminder.by && ` · ${h.lastReminder.by}`}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {board.total > board.items.length && (
                  <p className="muted small">
                    {l(
                      `Menampilkan ${board.items.length} dari ${board.total} (paling terlambat dulu).`,
                      `Showing ${board.items.length} of ${board.total} (most late first).`,
                    )}
                  </p>
                )}
              </div>
            )}
          </section>
        </>
      )}
      {remind && (
        <RemindDialog
          item={remind}
          onClose={() => setRemind(null)}
          onSent={() => {
            setRemind(null);
            setTick((t) => t + 1);
          }}
        />
      )}
    </>
  );
}

function RemindDialog({ item, onClose, onSent }: { item: Item; onClose: () => void; onSent: () => void }) {
  const { l } = useI18n();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  async function send() {
    setSending(true);
    try {
      const res = await api<{ notified: number }>("/flow/handoffs/remind", {
        method: "POST",
        body: { process: item.process, id: item.id, ...(message.trim() ? { message: message.trim() } : {}) },
      });
      toast.success(
        l(
          `Pengingat dikirim ke ${res.notified} orang & dicatat di riwayat dokumen.`,
          `Reminder sent to ${res.notified} people and recorded on the document.`,
        ),
      );
      onSent();
    } catch (e) {
      toast.error(e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : String(e));
    } finally {
      setSending(false);
    }
  }
  return (
    <Modal
      open
      title={`${l("Ingatkan", "Remind")} · ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            {l("Batal", "Cancel")}
          </button>
          <button
            type="button"
            className="primary"
            disabled={sending}
            aria-busy={sending}
            onClick={() => void send()}
          >
            {l("Kirim pengingat", "Send reminder")}
          </button>
        </>
      }
    >
      <p>
        {l(
          `Pemegang dokumen${item.toDepartment ? ` dan manajer ${item.toDepartment}` : ""} akan diberi tahu bahwa dokumen ini menunggu "${l(...item.waiting)}" sejak ${item.ageDays} hari.`,
          `The document holder${item.toDepartment ? ` and the ${item.toDepartment} manager` : ""} will be told this document has been waiting for "${l(...item.waiting)}" for ${item.ageDays} days.`,
        )}
      </p>
      <label className="field">
        <span>{l("Pesan tambahan (opsional)", "Additional message (optional)")}</span>
        <textarea rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
    </Modal>
  );
}
