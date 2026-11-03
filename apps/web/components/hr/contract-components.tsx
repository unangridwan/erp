"use client";

import { useOptions } from "../accounting/use-options";
import { money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";

export interface SalaryComponentOption {
  id: string;
  code: string;
  name: string;
  kind: "allowance" | "deduction";
  fixed: boolean;
  calc: "fixed_amount" | "per_attendance_day" | "attendance_premium";
  rate: string | null;
  autoAssign: boolean;
  active: boolean;
}
export interface ComponentLine {
  componentId: string;
  amount: string;
}

const UNIT: Record<SalaryComponentOption["calc"], [string, string]> = {
  fixed_amount: ["/ bulan", "/ month"],
  per_attendance_day: ["/ hari hadir", "/ day present"],
  attendance_premium: ["premi / bulan", "bonus / month"],
};
/** Tunjangan tetap = nilai tetap bulanan bertanda tetap (ikut dasar upah BPJS & lembur). */
const isFixed = (c: SalaryComponentOption) => c.kind === "allowance" && c.fixed && c.calc === "fixed_amount";

/**
 * Komponen gaji kontrak selain gaji pokok: tunjangan tetap, tunjangan tidak tetap (per hari hadir / premi kehadiran),
 * dan potongan. Nilai per bulan atau tarif per hari; komponen per hari/premi yang dikosongkan memakai nilai bawaan.
 * Komponen otomatis (berlaku untuk semua karyawan) ditampilkan dan bisa ditimpa nilainya.
 */
export function ContractComponentsEditor({
  value,
  onChange,
  wage,
  wageType,
  editable,
  errors,
  errorPrefix = "",
}: {
  value: ComponentLine[];
  onChange: (lines: ComponentLine[]) => void;
  wage: string;
  wageType: string;
  editable: boolean;
  errors: Record<string, string>;
  errorPrefix?: string;
}) {
  const { l, locale } = useI18n();
  const components = useOptions<SalaryComponentOption>("/salary-components");
  const byId = new Map(components.map((c) => [c.id, c]));
  const update = (i: number, patch: Partial<ComponentLine>) =>
    onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const choose = (i: number, componentId: string) => {
    const c = byId.get(componentId);
    const current = value[i]!;
    // Nilai bawaan komponen (tarif per hari / premi / nominal) terisi bila belum diisi.
    update(i, {
      componentId,
      amount:
        !current.amount || Number(current.amount) === 0
          ? c?.rate
            ? String(Number(c.rate))
            : ""
          : current.amount,
    });
  };
  const err = (k: string) => {
    const m = errors[`${errorPrefix}${k}`];
    return m ? <small className="error">{m}</small> : null;
  };
  const kindLabel = (c: SalaryComponentOption | undefined) =>
    !c
      ? ""
      : c.kind === "deduction"
        ? l("Potongan", "Deduction")
        : isFixed(c)
          ? l("Tunjangan tetap", "Fixed allowance")
          : l("Tunjangan tidak tetap", "Variable allowance");
  const auto = components.filter(
    (c) => c.active && c.autoAssign && !value.some((v) => v.componentId === c.id),
  );
  const fixedTotal =
    Number(wage || 0) +
    value.reduce((s, a) => {
      const c = byId.get(a.componentId);
      return s + (c && isFixed(c) ? Number(a.amount || 0) : 0);
    }, 0) +
    auto.filter(isFixed).reduce((s, c) => s + Number(c.rate ?? 0), 0);
  const options = (kind: SalaryComponentOption["kind"], selected: string) =>
    components
      .filter((c) => c.kind === kind && (c.active || c.id === selected))
      .map((c) => (
        <option key={c.id} value={c.id}>
          {c.code} — {c.name}
        </option>
      ));

  return (
    <div className="contract-components">
      <div className="table-scroll">
        <table className="lines">
          <thead>
            <tr>
              <th>{l("Komponen", "Component")}</th>
              <th>{l("Jenis", "Kind")}</th>
              <th className="num">{l("Nilai", "Amount")}</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {value.map((a, i) => {
              const c = byId.get(a.componentId);
              const variable = c && c.calc !== "fixed_amount";
              return (
                <tr key={i}>
                  <td>
                    <select
                      disabled={!editable}
                      value={a.componentId}
                      aria-label={l("Komponen gaji", "Pay component")}
                      onChange={(e) => choose(i, e.target.value)}
                    >
                      <option value="">—</option>
                      <optgroup label={l("Tunjangan", "Allowances")}>
                        {options("allowance", a.componentId)}
                      </optgroup>
                      <optgroup label={l("Potongan", "Deductions")}>
                        {options("deduction", a.componentId)}
                      </optgroup>
                    </select>
                    {err(`allowances.${i}.componentId`)}
                  </td>
                  <td>{kindLabel(c)}</td>
                  <td>
                    <span className="amount-unit">
                      <input
                        disabled={!editable}
                        className="num"
                        inputMode="decimal"
                        aria-label={l("Nilai komponen", "Component amount")}
                        placeholder={
                          variable && c?.rate
                            ? `${l("bawaan", "default")} ${money(c.rate, locale, 0)}`
                            : undefined
                        }
                        value={a.amount}
                        onChange={(e) => update(i, { amount: e.target.value })}
                      />
                      <small className="muted">{c ? l(...UNIT[c.calc]) : ""}</small>
                    </span>
                    {err(`allowances.${i}.amount`)}
                  </td>
                  {editable && (
                    <td>
                      <button
                        type="button"
                        className="link"
                        aria-label={l("Hapus komponen", "Remove component")}
                        onClick={() => onChange(value.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {auto.map((c) => (
              <tr key={`auto-${c.id}`} className="muted">
                <td>
                  {c.code} — {c.name}
                </td>
                <td>
                  {kindLabel(c)} · {l("otomatis", "automatic")}
                </td>
                <td className="num">
                  {c.rate ? money(c.rate, locale, 0) : "—"} <small>{l(...UNIT[c.calc])}</small>
                </td>
                {editable && (
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        onChange([
                          ...value,
                          { componentId: c.id, amount: c.rate ? String(Number(c.rate)) : "" },
                        ])
                      }
                    >
                      {l("Ubah nilai", "Override")}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!value.length && !auto.length && (
              <tr>
                <td colSpan={editable ? 4 : 3} className="muted">
                  {l("Hanya gaji pokok.", "Base wage only.")}
                </td>
              </tr>
            )}
          </tbody>
          {editable && (
            <tfoot>
              <tr>
                <td colSpan={4}>
                  <span className="row-actions">
                    <button
                      type="button"
                      className="link"
                      onClick={() => onChange([...value, { componentId: "", amount: "" }])}
                    >
                      + {l("Tambah komponen gaji", "Add pay component")}
                    </button>
                    <a className="small" href="/salary-components" target="_blank" rel="noreferrer">
                      {l("Kelola komponen gaji", "Manage pay components")}
                    </a>
                  </span>
                  {err("allowances")}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {wageType === "monthly" && (
        <p className="muted small">
          {l(
            "Upah dasar BPJS & lembur (gaji pokok + tunjangan tetap)",
            "BPJS & overtime wage base (base + fixed allowances)",
          )}
          : {money(fixedTotal, locale)}.{" "}
          {l(
            "Tunjangan per hari hadir & premi dihitung dari absensi saat payroll; komponen otomatis berlaku untuk semua karyawan.",
            "Per-day allowances & bonuses are computed from attendance in payroll; automatic components apply to all employees.",
          )}
        </p>
      )}
    </div>
  );
}
