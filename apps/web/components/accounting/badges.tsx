"use client";

import { useI18n } from "../../lib/i18n";
import { MOVE_TYPE_LABEL, PAYMENT_STATE_LABEL } from "../../lib/resources";

export function StateBadge({ state }: { state: string }) {
  const { l } = useI18n();
  return (
    <span className={`badge state-${state}`}>
      {state === "posted" ? l("Diposting", "Posted") : l("Draft", "Draft")}
    </span>
  );
}

export function PaymentBadge({ state }: { state: string }) {
  const { tx } = useI18n();
  const label = PAYMENT_STATE_LABEL[state];
  return label ? <span className={`badge pay-${state}`}>{tx(label)}</span> : null;
}

export function TypeLabel({ type }: { type: string }) {
  const { tx } = useI18n();
  const label = MOVE_TYPE_LABEL[type];
  return <>{label ? tx(label) : type}</>;
}
