"use client";

import type { FlowProcess } from "@erp/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PeriodFilter, usePeriod, type FlowPreset } from "../../../components/flow/period";
import { LoadFailed, useLoadError } from "../../../components/load-failed";
import { api } from "../../../lib/api";
import { money } from "../../../lib/format";
import { useI18n } from "../../../lib/i18n";

interface Card {
  process: FlowProcess;
  label: [string, string];
  description: [string, string];
  chain: Record<"input" | "process" | "output" | "outcome", [string, string]>;
  wip: { count: number; value: number; late: number };
  completed: { count: number; value: number; cycleMedian: number | null; cycleP90: number | null };
  bottleneck: string | null;
  stages: { key: string; label: [string, string]; count: number; late: number }[];
}

/** Alur Bisnis: ringkasan tiap proses end-to-end (input → proses → output → outcome) dengan hambatannya. */
export default function FlowOverviewPage() {
  const { l, locale } = useI18n();
  const [preset, setPreset] = useState<FlowPreset>("this_year");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const period = usePeriod(preset, custom);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, fail] = useLoadError();
  useEffect(() => {
    if (period.invalid) return;
    setCards(null);
    api<Card[]>(`/flow?from=${period.from}&to=${period.to}`).then(setCards).catch(fail);
  }, [period.from, period.to, period.invalid, fail]);

  if (error) return <LoadFailed message={error} />;
  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <h1>{l("Alur Bisnis", "Business Flow")}</h1>
        </div>
        <div className="cp-right">
          <PeriodFilter preset={preset} custom={custom} onPreset={setPreset} onCustom={setCustom} />
        </div>
      </header>
      <p className="muted">
        {l(
          "Bagaimana pekerjaan mengalir dari input sampai hasil akhir: dokumen di tiap tahap, yang terlambat, penghambat, dan waktu siklus. Klik proses untuk melihat detail sampai ke dokumen dan siapa yang memegangnya.",
          "How work flows from input to outcome: documents at each stage, what is late, the bottleneck and the cycle time. Open a process to drill down to documents and who holds them.",
        )}
      </p>
      {period.invalid && (
        <p className="muted">{l("Isi rentang tanggal yang valid.", "Enter a valid date range.")}</p>
      )}
      {!cards && !period.invalid && <p className="muted">{l("Memuat…", "Loading…")}</p>}
      {cards && !cards.length && (
        <p className="muted">
          {l("Anda belum punya akses ke proses mana pun.", "You do not have access to any process.")}
        </p>
      )}
      <div className="flow-cards">
        {cards?.map((c) => {
          const bottleneck = c.stages.find((s) => s.key === c.bottleneck);
          return (
            <Link
              key={c.process}
              href={`/flow/${c.process}${preset !== "this_year" && !period.invalid ? `?from=${period.from}&to=${period.to}` : ""}`}
              className="flow-card"
            >
              <h2>{l(...c.label)}</h2>
              <p className="muted small">{l(...c.description)}</p>
              <ol className="flow-chain">
                {(["input", "process", "output", "outcome"] as const).map((k) => (
                  <li key={k}>
                    <span className="muted small">
                      {
                        {
                          input: "Input",
                          process: l("Proses", "Process"),
                          output: "Output",
                          outcome: "Outcome",
                        }[k]
                      }
                    </span>
                    <span>{l(...c.chain[k])}</span>
                  </li>
                ))}
              </ol>
              <div className="flow-mini" aria-hidden="true">
                {c.stages.map((s, i) => (
                  <span
                    key={s.key}
                    className={`flow-mini-stage${s.late ? " late" : ""}${s.key === c.bottleneck ? " bottleneck" : ""}`}
                    title={`${l(...s.label)}: ${s.count}`}
                  >
                    <b>{s.count}</b>
                    <small>{l(...s.label)}</small>
                    {i < c.stages.length - 1 && <i>›</i>}
                  </span>
                ))}
              </div>
              <dl className="flow-kpis">
                <div>
                  <dt>{l("Sedang berjalan", "In progress")}</dt>
                  <dd>
                    {c.wip.count}
                    {c.wip.late > 0 && (
                      <span className="badge danger">
                        {c.wip.late} {l("terlambat", "late")}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{l("Selesai di periode", "Completed in period")}</dt>
                  <dd>
                    {c.completed.count}
                    {c.completed.value > 0 && <small> · {money(c.completed.value, locale, 0)}</small>}
                  </dd>
                </div>
                <div>
                  <dt>{l("Waktu siklus (median)", "Cycle time (median)")}</dt>
                  <dd>
                    {c.completed.cycleMedian !== null
                      ? l(`${c.completed.cycleMedian} hari`, `${c.completed.cycleMedian} days`)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>{l("Penghambat", "Bottleneck")}</dt>
                  <dd>{bottleneck ? l(...bottleneck.label) : "—"}</dd>
                </div>
              </dl>
            </Link>
          );
        })}
      </div>
    </>
  );
}
