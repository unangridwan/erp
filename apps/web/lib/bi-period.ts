import { periodRange, type PeriodPreset } from "@erp/shared";

/** Hari ini menurut tanggal bisnis server (UTC). */
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Rentang tanggal dari preset, kustom, atau tanpa periode ("none" = semua waktu). */
export function resolvePeriod(
  preset: PeriodPreset | "custom" | "none",
  custom: { from: string; to: string },
) {
  if (preset === "none") return { from: "", to: "" };
  return preset === "custom" ? custom : periodRange(preset, todayIso());
}
