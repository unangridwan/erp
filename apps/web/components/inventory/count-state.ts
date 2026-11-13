import { STOCK_COUNT_STATE_LABEL } from "@erp/shared";

export const COUNT_STATE = STOCK_COUNT_STATE_LABEL;
export const countPill = (state: string) =>
  state === "done" ? "ok" : state === "in_approval" ? "warn" : state === "cancel" ? "bad" : "";
