import { BOM_TYPE_LABEL, PRODUCTION_STATE_LABEL } from "@erp/shared";

export const MO_STATE = PRODUCTION_STATE_LABEL;
export const BOM_TYPE = BOM_TYPE_LABEL;
export const moPill = (state: string) =>
  state === "done" ? "ok" : state === "in_progress" ? "warn" : state === "cancel" ? "bad" : "";
