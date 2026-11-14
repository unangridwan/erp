"use client";

import { ALERT_STATE_LABEL, CHECK_STATE_LABEL } from "@erp/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { can } from "../../lib/resources";
import { useMe } from "../me-context";

const BADGE: Record<string, string> = {
  pending: "warn",
  passed: "success",
  failed: "danger",
  conditional: "warn",
  open: "danger",
  in_progress: "warn",
  closed: "success",
};

export function QualityBadge({ state }: { state: string }) {
  const { locale } = useI18n();
  const i = locale === "id" ? 0 : 1;
  return (
    <span className={`badge ${BADGE[state] ?? ""}`}>
      {CHECK_STATE_LABEL[state]?.[i] ?? ALERT_STATE_LABEL[state]?.[i] ?? state}
    </span>
  );
}

/** Panel di transfer / order produksi: pemeriksaan mutu yang dibuat dari dokumen ini. */
export function QualityChecksPanel({
  pickingId,
  productionOrderId,
}: {
  pickingId?: string;
  productionOrderId?: string;
}) {
  const { l } = useI18n();
  const me = useMe();
  const [rows, setRows] = useState<{ id: string; name: string; state: string; quantity: string }[]>([]);
  const allowed = can(me.permissions, "quality.read");
  useEffect(() => {
    if (!allowed) return;
    const q = pickingId ? `pickingId=${pickingId}` : `productionOrderId=${productionOrderId}`;
    void api<typeof rows>(`/quality-checks-for?${q}`).then(setRows, () => setRows([]));
  }, [allowed, pickingId, productionOrderId]);
  if (!rows.length) return null;
  return (
    <section className="panel">
      <h2>{l("Pemeriksaan mutu", "Quality checks")}</h2>
      <ul className="plain">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/quality/checks/${r.id}`}>{r.name}</Link> — {Number(r.quantity)}{" "}
            <QualityBadge state={r.state} />
          </li>
        ))}
      </ul>
    </section>
  );
}
