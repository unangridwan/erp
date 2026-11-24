"use client";

import { isRecordModel, recordHref, RECORD_MODELS, type RecordModel } from "@erp/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatDate, money } from "../lib/format";
import { FLOW_TRACE_MODELS, FlowTrace } from "./flow/flow-trace";
import { useI18n } from "../lib/i18n";

interface Group {
  key: string;
  model: RecordModel;
  label: [string, string];
  direction: "upstream" | "downstream";
  count: number;
  items: {
    id: string;
    name: string | null;
    date: string | null;
    amount: string | null;
    state: string | null;
  }[];
}

const SHOWN = 5;

/**
 * Panel "Dokumen terkait": dokumen asal & turunan sebuah dokumen lintas modul (mis. faktur ← SO, → pembayaran,
 * faktur pajak). Hanya dokumen yang boleh dibaca pengguna yang tampil.
 */
export function RelatedDocuments({
  model,
  id,
  version,
}: {
  model: RecordModel;
  id: string;
  version?: number;
}) {
  const { l, locale } = useI18n();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [trace, setTrace] = useState(false);

  useEffect(() => {
    api<{ groups: Group[] }>(`/links/${model}/${id}`)
      .then((r) => setGroups(r.groups))
      .catch(() => setGroups([]));
  }, [model, id, version]);

  if (!groups?.length) return null;
  const ordered = [...groups].sort((a, b) =>
    a.direction === b.direction ? 0 : a.direction === "upstream" ? -1 : 1,
  );
  return (
    <section className="panel related-docs" aria-label={l("Dokumen terkait", "Related documents")}>
      <h2>
        {l("Dokumen terkait", "Related documents")}
        {FLOW_TRACE_MODELS.includes(model) && (
          <button type="button" className="link small flow-trace-btn" onClick={() => setTrace(true)}>
            {l("Jejak alur bisnis", "Business flow trace")}
          </button>
        )}
      </h2>
      {trace && <FlowTrace model={model} id={id} onClose={() => setTrace(false)} />}
      <div className="related-grid">
        {ordered.map((g) => {
          const all = open[g.key];
          const items = all ? g.items : g.items.slice(0, SHOWN);
          const def = isRecordModel(g.model) ? RECORD_MODELS[g.model] : null;
          return (
            <div key={g.key} className="related-group">
              <h3>
                <span className="related-dir" aria-hidden>
                  {g.direction === "upstream" ? "↑" : "↓"}
                </span>{" "}
                {l(...g.label)} <span className="badge">{g.count}</span>
              </h3>
              <ul>
                {items.map((x) => {
                  const href = recordHref(g.model, x.id);
                  const text = x.name ?? (def ? l(...def.label) : x.id);
                  return (
                    <li key={x.id}>
                      {href ? <Link href={href}>{text}</Link> : text}
                      {(x.date || x.amount) && (
                        <span className="muted">
                          {x.date && ` · ${formatDate(x.date, locale)}`}
                          {x.amount && Number(x.amount) !== 0 && ` · ${money(x.amount, locale)}`}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {g.items.length > SHOWN && (
                <button
                  type="button"
                  className="link"
                  onClick={() => setOpen((o) => ({ ...o, [g.key]: !all }))}
                >
                  {all
                    ? l("Lebih sedikit", "Show less")
                    : l(`+${g.items.length - SHOWN} lainnya`, `+${g.items.length - SHOWN} more`)}
                </button>
              )}
              {g.count > g.items.length && (
                <p className="muted small">
                  {l(
                    `${g.count - g.items.length} lainnya tidak ditampilkan`,
                    `${g.count - g.items.length} more not shown`,
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
