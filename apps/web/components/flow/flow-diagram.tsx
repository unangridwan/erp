"use client";

import type { FlowDef, FlowStageSummary, FlowSummary } from "@erp/shared";
import { money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";

export type StageView = FlowStageSummary & { department?: string | null };

/**
 * Diagram alur: kotak tahap berurutan dengan panah. Tiap kotak: dokumen yang sedang di tahap itu, nilainya, umur
 * rata-rata vs SLA, terlambat/berisiko, departemen penanggung jawab. Panah: % kohort yang sampai ke tahap berikut dan
 * lama rata-rata di tahap sebelumnya. Tahap penghambat ditandai.
 */
export function FlowDiagram({
  def,
  summary,
  stages,
  selected,
  onSelect,
}: {
  def: FlowDef;
  summary: FlowSummary;
  stages: StageView[];
  selected?: string | null;
  onSelect?: (stage: string) => void;
}) {
  const { l, locale } = useI18n();
  const last = def.stages[def.stages.length - 1]!.key;
  const n = (v: number | null) => (v === null ? "—" : v.toLocaleString(locale === "id" ? "id-ID" : "en-US"));
  return (
    <div className="flow-diagram" role="list" aria-label={l("Tahap alur", "Flow stages")}>
      {stages.map((s, i) => {
        const final = s.key === last;
        const tone = final ? "done" : s.late > 0 ? "late" : s.atRisk > 0 ? "risk" : s.count ? "ok" : "idle";
        const next = stages[i + 1];
        return (
          <div key={s.key} className="flow-step" role="listitem">
            <button
              type="button"
              className={`flow-stage tone-${tone}${selected === s.key ? " selected" : ""}${summary.bottleneck === s.key ? " bottleneck" : ""}`}
              aria-pressed={selected === s.key}
              onClick={() => onSelect?.(s.key)}
            >
              <span className="flow-stage-label">{l(...s.label)}</span>
              <span className="flow-count">
                <strong>{s.count.toLocaleString(locale === "id" ? "id-ID" : "en-US")}</strong>{" "}
                <span className="muted small">
                  {final ? l("selesai di periode", "completed in period") : l("dokumen", "documents")}
                </span>
              </span>
              {def.valueLabel && s.value > 0 && (
                <span className="flow-value">{money(s.value, locale, 0)}</span>
              )}
              {!final ? (
                <>
                  <span className="muted small">
                    {l("Menunggu", "Waiting for")}: {l(...s.waiting)}
                  </span>
                  <span className="muted small">
                    {s.avgAge !== null
                      ? l(`Umur rata-rata ${n(s.avgAge)} hari`, `Average age ${n(s.avgAge)} days`)
                      : l("Tidak ada dokumen", "No documents")}
                    {s.slaDays !== null && ` · SLA ${s.slaDays} ${l("hari", "days")}`}
                  </span>
                  {(s.late > 0 || s.atRisk > 0) && (
                    <span className="flow-badges">
                      {s.late > 0 && (
                        <span className="badge danger">
                          {s.late} {l("terlambat", "late")}
                        </span>
                      )}
                      {s.atRisk > 0 && (
                        <span className="badge warn">
                          {s.atRisk} {l("berisiko", "at risk")}
                        </span>
                      )}
                    </span>
                  )}
                </>
              ) : (
                summary.completed.cycleMedian !== null && (
                  <span className="muted small">
                    {l(
                      `Waktu siklus median ${n(summary.completed.cycleMedian)} hari (P90 ${n(summary.completed.cycleP90)})`,
                      `Median cycle time ${n(summary.completed.cycleMedian)} days (P90 ${n(summary.completed.cycleP90)})`,
                    )}
                  </span>
                )
              )}
              {s.department && <span className="flow-dept">{s.department}</span>}
              {summary.bottleneck === s.key && (
                <span className="flow-flag">{l("Penghambat", "Bottleneck")}</span>
              )}
            </button>
            {next && (
              <div className="flow-arrow" aria-hidden="true">
                <span className="flow-arrow-line" />
                <span className="flow-arrow-text">
                  {next.reachedPct !== null && `${n(next.reachedPct)}%`}
                  {s.avgDays !== null && <small>{l(`${n(s.avgDays)} hr`, `${n(s.avgDays)} d`)}</small>}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
