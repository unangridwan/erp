"use client";

import {
  OVERTIME_PRESETS,
  overtimePay,
  overtimePresetOf,
  type OvertimeRates,
  type OvertimeTier,
} from "@erp/shared";
import { useState } from "react";
import { money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";

const DAYS = [
  ["workday", "Hari kerja", "Workday"],
  ["rest_day", "Hari istirahat / libur", "Rest day / holiday"],
] as const;

/**
 * Master tarif lembur: preset PP 35/2021 (pola 5 atau 6 hari kerja) atau tarif sendiri — pembagi upah sejam dan
 * pengali per tingkat jam untuk hari kerja & hari libur, dengan contoh hitung.
 */
export function OvertimeRatesEditor(props: { value: OvertimeRates; onChange: (r: OvertimeRates) => void }) {
  const { l, locale } = useI18n();
  const r = props.value;
  const preset = overtimePresetOf(r);
  const [sample, setSample] = useState("5000000");
  const setTiers = (day: keyof Omit<OvertimeRates, "divisor">, tiers: OvertimeTier[]) =>
    props.onChange({ ...r, [day]: tiers });
  const num = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(",", ".")));
  return (
    <div className="stack overtime-rates">
      <label className="field">
        <span>{l("Tarif lembur", "Overtime rates")}</span>
        <select
          value={preset}
          onChange={(e) => {
            const p = e.target.value as keyof typeof OVERTIME_PRESETS | "custom";
            if (p !== "custom") props.onChange(structuredClone(OVERTIME_PRESETS[p]));
          }}
        >
          <option value="pp35_5">{l("PP 35/2021 — pola 5 hari kerja", "PP 35/2021 — 5-day week")}</option>
          <option value="pp35_6">{l("PP 35/2021 — pola 6 hari kerja", "PP 35/2021 — 6-day week")}</option>
          <option value="custom">
            {l("Tarif sendiri (ubah tabel di bawah)", "Custom (edit the tables below)")}
          </option>
        </select>
      </label>
      <label className="field">
        <span>{l("Pembagi upah sejam (upah sebulan ÷ …)", "Hourly wage divisor (monthly wage ÷ …)")}</span>
        <input
          className="num"
          type="number"
          min="1"
          max="400"
          step="0.01"
          value={String(r.divisor)}
          onChange={(e) => props.onChange({ ...r, divisor: num(e.target.value) })}
        />
      </label>
      <div className="overtime-rate-tables">
        {DAYS.map(([day, id, en]) => (
          <table key={day} className="lines">
            <caption>{l(id, en)}</caption>
            <thead>
              <tr>
                <th>{l("Sampai jam ke-", "Up to hour")}</th>
                <th className="num">{l("Pengali", "Multiplier")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {r[day].map((t, i) => {
                const last = i === r[day].length - 1;
                const patch = (p: Partial<OvertimeTier>) =>
                  setTiers(
                    day,
                    r[day].map((x, j) => (j === i ? { ...x, ...p } : x)),
                  );
                return (
                  <tr key={i}>
                    <td>
                      {last ? (
                        <span className="muted">{l("seterusnya", "and beyond")}</span>
                      ) : (
                        <input
                          className="num"
                          type="number"
                          min="0.5"
                          max="24"
                          step="0.5"
                          aria-label={l("Sampai jam ke-", "Up to hour")}
                          value={t.upToHour === null ? "" : String(t.upToHour)}
                          onChange={(e) => patch({ upToHour: num(e.target.value) })}
                        />
                      )}
                    </td>
                    <td>
                      <input
                        className="num"
                        type="number"
                        min="1"
                        max="10"
                        step="0.1"
                        aria-label={l("Pengali", "Multiplier")}
                        value={String(t.multiplier)}
                        onChange={(e) => patch({ multiplier: num(e.target.value) })}
                      />
                    </td>
                    <td>
                      {r[day].length > 1 && (
                        <button
                          type="button"
                          className="link"
                          aria-label={l("Hapus tingkat", "Remove tier")}
                          onClick={() => {
                            const next = r[day].filter((_, j) => j !== i);
                            next[next.length - 1] = { ...next[next.length - 1]!, upToHour: null };
                            setTiers(day, next);
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>
                  <button
                    type="button"
                    className="link"
                    disabled={r[day].length >= 6}
                    onClick={() => {
                      const tiers = r[day].map((x) => ({ ...x }));
                      const prev = tiers.length > 1 ? (tiers[tiers.length - 2]!.upToHour ?? 0) : 0;
                      tiers[tiers.length - 1] = { ...tiers[tiers.length - 1]!, upToHour: prev + 1 };
                      tiers.push({ upToHour: null, multiplier: tiers[tiers.length - 1]!.multiplier });
                      setTiers(day, tiers);
                    }}
                  >
                    + {l("Tambah tingkat", "Add tier")}
                  </button>
                </td>
              </tr>
            </tfoot>
          </table>
        ))}
      </div>
      <p className="muted small">
        {l("Contoh untuk upah sebulan", "Example for a monthly wage of")}{" "}
        <input
          className="num inline"
          inputMode="numeric"
          aria-label={l("Upah contoh", "Sample wage")}
          value={sample}
          onChange={(e) => setSample(e.target.value.replace(/\D/g, ""))}
        />
        :{" "}
        {(() => {
          try {
            return [
              [2, "workday", l("2 jam hari kerja", "2 h on a workday")],
              [8, "rest_day", l("8 jam hari libur", "8 h on a rest day")],
            ]
              .map(
                ([h, day, label]) =>
                  `${label} = ${money(overtimePay(sample || 0, h as number, day as "workday", r), locale, 0)}`,
              )
              .join(" · ");
          } catch {
            return "—";
          }
        })()}
      </p>
    </div>
  );
}
