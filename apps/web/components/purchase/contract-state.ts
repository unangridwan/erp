import { PURCHASE_CONTRACT_STATE_LABEL } from "@erp/shared";

/** Label status kontrak pembelian + kelas pill. */
export const CONTRACT_STATE = PURCHASE_CONTRACT_STATE_LABEL;
export const contractPill = (state: string) =>
  state === "active"
    ? "ok"
    : state === "expired" || state === "refused"
      ? "bad"
      : state === "in_approval"
        ? "warn"
        : "";
