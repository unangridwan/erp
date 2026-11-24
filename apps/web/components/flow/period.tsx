"use client";

import { PERIOD_LABEL, PERIOD_PRESETS, type PeriodPreset } from "@erp/shared";
import { resolvePeriod } from "../../lib/bi-period";
import { useI18n } from "../../lib/i18n";

export type FlowPreset = PeriodPreset | "custom";

/** Pemilih periode alur (preset atau rentang kustom); mengembalikan rentang tanggal. */
export function usePeriod(preset: FlowPreset, custom: { from: string; to: string }) {
  const p = resolvePeriod(preset, custom);
  const invalid = preset === "custom" && (!custom.from || !custom.to || custom.from > custom.to);
  return { from: invalid ? "" : p.from, to: invalid ? "" : p.to, invalid };
}

export function PeriodFilter({
  preset,
  custom,
  onPreset,
  onCustom,
}: {
  preset: FlowPreset;
  custom: { from: string; to: string };
  onPreset: (p: FlowPreset) => void;
  onCustom: (c: { from: string; to: string }) => void;
}) {
  const { l } = useI18n();
  return (
    <span className="dash-period">
      <select
        aria-label={l("Periode", "Period")}
        value={preset}
        onChange={(e) => onPreset(e.target.value as FlowPreset)}
      >
        {PERIOD_PRESETS.map((p) => (
          <option key={p} value={p}>
            {l(...PERIOD_LABEL[p])}
          </option>
        ))}
        <option value="custom">{l("Rentang kustom", "Custom range")}</option>
      </select>
      {preset === "custom" && (
        <>
          <input
            type="date"
            aria-label={l("Dari", "From")}
            value={custom.from}
            onChange={(e) => onCustom({ ...custom, from: e.target.value })}
          />
          <input
            type="date"
            aria-label={l("Sampai", "To")}
            value={custom.to}
            onChange={(e) => onCustom({ ...custom, to: e.target.value })}
          />
        </>
      )}
    </span>
  );
}
