"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { formatDate, money, today } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { can } from "../../lib/resources";
import { useMe } from "../me-context";

export interface LeadRow {
  id: string;
  name: string;
  leadType: string;
  leadStatus: string;
  nextStep: string | null;
  score: number;
  state: string;
  stageId: string | null;
  stageName: string | null;
  partnerDisplay: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  userName: string | null;
  expectedRevenue: string;
  probability: string;
  priority: number;
  nextActivity: string | null;
  createdAt: string;
}
interface Stage {
  id: string;
  name: string;
  sequence: number;
  isWon: boolean;
  fold: boolean;
}

export const Stars = ({ n }: { n: number }) =>
  n > 0 ? <span className="stars">{"★".repeat(n)}</span> : null;

/** Kanban peluang per tahap; kartu bisa diseret ke tahap lain. */
export function Pipeline() {
  const me = useMe();
  const { l, locale } = useI18n();
  const writable = can(me.permissions, "crm.write");
  const [stages, setStages] = useState<Stage[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [quick, setQuick] = useState<{ stageId: string; name: string; revenue: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ leadType: "opportunity", state: "open,won", limit: "500" });
    if (q) params.set("q", q);
    if (mine) params.set("userId", "me");
    const [s, data] = await Promise.all([
      api<{ items: Stage[] }>("/crm-stages?limit=200"),
      api<{ items: LeadRow[] }>(`/leads?${params}`),
    ]);
    setStages(s.items);
    setLeads(data.items);
  }, [q, mine]);

  useEffect(() => {
    const timer = setTimeout(() => load().catch((e: Error) => setError(e.message)), 200);
    return () => clearTimeout(timer);
  }, [load]);

  async function move(leadId: string, stageId: string) {
    const lead = leads.find((x) => x.id === leadId);
    if (!lead || lead.stageId === stageId) return;
    // Pembaruan optimistis agar kartu langsung pindah.
    setLeads((rows) => rows.map((r) => (r.id === leadId ? { ...r, stageId } : r)));
    try {
      await api(`/leads/${leadId}`, { method: "PATCH", body: { stageId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    await load().catch(() => undefined);
  }

  async function quickCreate(e: FormEvent) {
    e.preventDefault();
    if (!quick) return;
    try {
      await api("/leads", {
        method: "POST",
        body: { name: quick.name, stageId: quick.stageId, expectedRevenue: quick.revenue || "0" },
      });
      setQuick(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <header className="toolbar">
        <h1>{l("Pipeline", "Pipeline")}</h1>
        <input
          type="search"
          placeholder={l("Cari peluang, pelanggan…", "Search opportunity, customer…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="field check">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          <span>{l("Milik saya", "My pipeline")}</span>
        </label>
        {writable && (
          <Link className="button primary" href="/crm/leads/new?type=opportunity">
            {l("Baru", "New")}
          </Link>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      <div className="kanban">
        {stages.map((stage) => {
          const cards = leads.filter((x) => x.stageId === stage.id);
          const total = cards.reduce((s, x) => s + Number(x.expectedRevenue), 0);
          return (
            <section
              key={stage.id}
              className={`kanban-col${dropTarget === stage.id ? " drop" : ""}`}
              onDragOver={(e) => {
                if (!writable) return;
                e.preventDefault();
                setDropTarget(stage.id);
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDropTarget(null);
                void move(e.dataTransfer.getData("text/plain"), stage.id);
              }}
            >
              <header>
                <strong>{stage.name}</strong>
                <small>
                  {cards.length} · {money(total, locale, 0)}
                </small>
              </header>
              {writable &&
                (quick?.stageId === stage.id ? (
                  <form className="kanban-card" onSubmit={quickCreate}>
                    <input
                      autoFocus
                      required
                      placeholder={l("Nama peluang", "Opportunity name")}
                      value={quick.name}
                      onChange={(e) => setQuick({ ...quick, name: e.target.value })}
                    />
                    <input
                      inputMode="decimal"
                      placeholder={l("Pendapatan harapan", "Expected revenue")}
                      value={quick.revenue}
                      onChange={(e) => setQuick({ ...quick, revenue: e.target.value })}
                    />
                    <span>
                      <button className="primary">{l("Tambah", "Add")}</button>{" "}
                      <button type="button" className="link" onClick={() => setQuick(null)}>
                        {l("Batal", "Cancel")}
                      </button>
                    </span>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="link"
                    onClick={() => setQuick({ stageId: stage.id, name: "", revenue: "" })}
                  >
                    + {l("Tambah cepat", "Quick add")}
                  </button>
                ))}
              {cards.map((x) => (
                <article
                  key={x.id}
                  className="kanban-card"
                  draggable={writable}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", x.id)}
                >
                  <Link href={`/crm/leads/${x.id}`}>{x.name}</Link>
                  {x.partnerDisplay && <span>{x.partnerDisplay}</span>}
                  <span className="meta">
                    <span>{money(x.expectedRevenue, locale, 0)}</span>
                    <Stars n={x.priority} />
                  </span>
                  <span className="meta">
                    <span>{x.userName ?? l("Belum ditugaskan", "Unassigned")}</span>
                    {x.nextActivity && (
                      <span className={x.nextActivity < today() ? "overdue" : ""}>
                        ⏰ {formatDate(x.nextActivity, locale)}
                      </span>
                    )}
                  </span>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
