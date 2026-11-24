"use client";

import { recordHref, type RecordModel } from "@erp/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatDate, money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { Modal } from "../feedback";

interface Trace {
  process: string;
  label: [string, string];
  anchor: { model: RecordModel; id: string; name: string; href: string | null };
  partner: string | null;
  value: number | null;
  owner: { name: string; department: string | null } | null;
  stage: string | null;
  due: string | null;
  cycleDays: number | null;
  finished: boolean;
  stages: {
    key: string;
    label: [string, string];
    waiting: [string, string];
    at: string | null;
    days: number | null;
    current: boolean;
    slaDays: number | null;
    status: "on_time" | "at_risk" | "late" | null;
  }[];
  related: { model: RecordModel; id: string; name: string; date: string | null; state: string | null }[];
  events: {
    at: string;
    model: RecordModel;
    id: string;
    name: string;
    action: string;
    message: string | null;
    user: string | null;
  }[];
}

/** Model yang bisa ditelusuri alurnya (jangkar proses atau turunannya). */
export const FLOW_TRACE_MODELS: RecordModel[] = [
  "sale_order",
  "purchase_order",
  "stock_picking",
  "account_move",
  "production_order",
  "employee",
];

const ACTION: Record<string, [string, string]> = {
  create: ["membuat", "created"],
  update: ["mengubah", "updated"],
  delete: ["menghapus", "deleted"],
  comment: ["mencatat", "noted"],
  message: ["menulis", "wrote"],
};

/** Jejak satu dokumen sepanjang alur bisnisnya: tahap & lamanya, dokumen terkait, siapa melakukan apa & kapan. */
export function FlowTrace({ model, id, onClose }: { model: RecordModel; id: string; onClose: () => void }) {
  const { l, locale } = useI18n();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setTrace(null);
    setError(null);
    api<Trace>(`/flow/trace/${model}/${id}`).then(setTrace, (e: Error) => setError(e.message));
  }, [model, id]);
  const time = (v: string) =>
    new Date(v).toLocaleString(locale === "id" ? "id-ID" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const date = (v: string | null) => (v ? (v.length > 10 ? time(v) : formatDate(v, locale)) : "—");
  return (
    <Modal
      open
      title={
        trace ? `${l("Jejak alur", "Flow trace")} · ${trace.anchor.name}` : l("Jejak alur", "Flow trace")
      }
      onClose={onClose}
      side
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!trace && !error && <p className="muted">{l("Memuat…", "Loading…")}</p>}
      {trace && (
        <div className="flow-trace">
          <p className="muted">
            {l(...trace.label)}
            {trace.partner && ` · ${trace.partner}`}
            {trace.value !== null && trace.value > 0 && ` · ${money(trace.value, locale, 0)}`}
            {trace.owner &&
              ` · ${trace.owner.name}${trace.owner.department ? ` (${trace.owner.department})` : ""}`}
          </p>
          <p>
            {trace.finished
              ? l(`Selesai dalam ${trace.cycleDays} hari.`, `Completed in ${trace.cycleDays} days.`)
              : l(
                  `Berjalan ${trace.cycleDays ?? 0} hari sejauh ini.`,
                  `Running for ${trace.cycleDays ?? 0} days so far.`,
                )}
            {trace.due && ` ${l("Batas tahap ini", "This stage is due")}: ${formatDate(trace.due, locale)}.`}
          </p>
          <ol className="flow-timeline">
            {trace.stages.map((s) => (
              <li
                key={s.key}
                className={`${s.at ? "reached" : "pending"}${s.current ? " current" : ""} ${s.status ?? ""}`}
              >
                <span className="flow-dot" aria-hidden="true" />
                <div>
                  <strong>{l(...s.label)}</strong>
                  {s.at ? (
                    <span className="muted small">
                      {" "}
                      · {date(s.at)}
                      {s.days !== null &&
                        ` · ${s.current ? l(`${s.days} hari di tahap ini`, `${s.days} days in this stage`) : l(`${s.days} hari`, `${s.days} days`)}`}
                    </span>
                  ) : (
                    <span className="muted small"> · {l("belum", "not yet")}</span>
                  )}
                  {s.current && (
                    <p className="small">
                      {l("Menunggu", "Waiting for")}: {l(...s.waiting)}
                      {s.slaDays !== null && ` · SLA ${s.slaDays} ${l("hari", "days")}`}
                      {s.status === "late" && <span className="badge danger"> {l("Terlambat", "Late")}</span>}
                      {s.status === "at_risk" && (
                        <span className="badge warn"> {l("Berisiko", "At risk")}</span>
                      )}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {trace.related.length > 0 && (
            <>
              <h3>{l("Dokumen dalam alur", "Documents in this flow")}</h3>
              <ul className="flow-related">
                {trace.related.map((r) => {
                  const href = recordHref(r.model, r.id);
                  return (
                    <li key={r.id}>
                      {href ? <Link href={href}>{r.name}</Link> : r.name}
                      <span className="muted small">
                        {r.date && ` · ${formatDate(r.date, locale)}`}
                        {r.state && ` · ${r.state}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <h3>{l("Siapa melakukan apa", "Who did what")}</h3>
          {trace.events.length ? (
            <ul className="flow-events">
              {trace.events.map((e, i) => (
                <li key={i}>
                  <span className="muted small">{time(e.at)}</span>{" "}
                  <strong>{e.user ?? l("Sistem", "System")}</strong>{" "}
                  {l(...(ACTION[e.action] ?? [e.action, e.action]))} {e.name}
                  {e.message && (
                    <span className={e.action === "message" ? undefined : "muted"}>
                      {e.action === "message" ? `: “${e.message}”` : ` — ${e.message}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{l("Belum ada catatan aktivitas.", "No activity recorded yet.")}</p>
          )}
        </div>
      )}
    </Modal>
  );
}
