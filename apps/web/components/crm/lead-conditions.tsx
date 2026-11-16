"use client";

import { CONDITION_OP_LABEL, CONDITION_OPS, LEAD_RULE_FIELDS, type AutomationCondition } from "@erp/shared";
import { useI18n } from "../../lib/i18n";

/** Editor syarat aturan lead (skor & penugasan): field lead × operator × nilai, digabung dengan "dan". */
export function LeadConditions(props: {
  value: AutomationCondition[];
  onChange: (next: AutomationCondition[]) => void;
  emptyText?: string;
}) {
  const { l, locale } = useI18n();
  const i = locale === "id" ? 0 : 1;
  const set = (idx: number, patch: Partial<AutomationCondition>) =>
    props.onChange(props.value.map((c, j) => (j === idx ? { ...c, ...patch } : c)));
  const noValue = (op: string) => op === "empty" || op === "notEmpty";
  return (
    <div className="stack">
      {props.value.length === 0 && props.emptyText && <p className="muted">{props.emptyText}</p>}
      {props.value.map((c, idx) => (
        <div className="automation-row" key={idx}>
          {idx > 0 && <span className="muted">{l("dan", "and")}</span>}
          <select
            aria-label={l("Field", "Field")}
            value={c.field}
            onChange={(e) => set(idx, { field: e.target.value })}
          >
            <option value="">—</option>
            {LEAD_RULE_FIELDS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label[i]}
              </option>
            ))}
          </select>
          <select
            aria-label={l("Operator", "Operator")}
            value={c.op}
            onChange={(e) => set(idx, { op: e.target.value as AutomationCondition["op"] })}
          >
            {CONDITION_OPS.map((o) => (
              <option key={o} value={o}>
                {CONDITION_OP_LABEL[o][i]}
              </option>
            ))}
          </select>
          {!noValue(c.op) && (
            <input
              aria-label={l("Nilai", "Value")}
              value={c.value}
              placeholder={c.op === "in" ? l("pisahkan dengan koma", "comma-separated") : ""}
              onChange={(e) => set(idx, { value: e.target.value })}
            />
          )}
          <button
            type="button"
            aria-label={l("Hapus syarat", "Remove condition")}
            onClick={() => props.onChange(props.value.filter((_, j) => j !== idx))}
          >
            ×
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          onClick={() => props.onChange([...props.value, { field: "source", op: "eq", value: "" }])}
        >
          {l("Tambah syarat", "Add condition")}
        </button>
      </div>
    </div>
  );
}
