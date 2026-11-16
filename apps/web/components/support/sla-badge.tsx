"use client";

import { useI18n } from "../../lib/i18n";

const STYLE: Record<string, string> = {
  met: "state-won",
  breached: "state-cancel",
  at_risk: "state-lost",
  on_track: "",
};

/** Lencana status SLA (tepat waktu / hampir lewat / terlewati). */
export function SlaBadge({ state, label }: { state: string; label?: string }) {
  const { l } = useI18n();
  if (state === "none") return null;
  const text: Record<string, string> = {
    met: l("Tepat waktu", "Met"),
    breached: l("Terlewati", "Breached"),
    at_risk: l("Hampir lewat", "At risk"),
    on_track: l("Berjalan", "On track"),
  };
  return (
    <span className={`badge ${STYLE[state] ?? ""}`}>
      {label ? `${label}: ` : ""}
      {text[state] ?? state}
    </span>
  );
}
