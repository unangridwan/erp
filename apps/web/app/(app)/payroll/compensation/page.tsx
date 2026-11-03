"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { COMPENSATION_STATE_LABEL, type CompensationState } from "@erp/shared";
import { useMe } from "../../../../components/me-context";
import { cycleStatePill } from "../../../../components/payroll/team-compensation";
import { RefSelect } from "../../../../components/ref-select";
import { api, ApiError } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface Cycle {
  id: string;
  name: string;
  effectiveDate: string;
  state: CompensationState;
  budgetKind: "percent" | "amount";
  budgetValue: string;
  count: number;
  budget: { budget: string; used: string; averagePercent: string; overBudget: boolean };
}

/** Payroll › Kenaikan Gaji: daftar siklus & buat siklus baru. */
export default function CompensationCyclesPage() {
  const me = useMe();
  const router = useRouter();
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Cycle[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: `Kenaikan gaji ${new Date().getFullYear() + 1}`,
    effectiveDate: `${new Date().getFullYear() + 1}-01-01`,
    budgetKind: "percent",
    budgetValue: "5",
    departmentId: "",
    gradeId: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const manage = can(me.permissions, "payroll.manage");

  const columns = useMemo<ViewColumn<Cycle>[]>(
    () => [
      { key: "name", label: l("Siklus", "Cycle"), value: (c) => c.name },
      { key: "effectiveDate", label: l("Berlaku", "Effective"), type: "date", value: (c) => c.effectiveDate },
      { key: "count", label: l("Peserta", "Employees"), type: "number", value: (c) => c.count },
      {
        key: "budget",
        label: l("Anggaran / bln", "Budget / mo"),
        type: "number",
        value: (c) => Number(c.budget.budget),
      },
      { key: "used", label: l("Terpakai", "Used"), type: "number", value: (c) => Number(c.budget.used) },
      {
        key: "average",
        label: l("Rata-rata", "Average"),
        type: "number",
        value: (c) => Number(c.budget.averagePercent),
      },
      {
        key: "state",
        label: "Status",
        type: "enum",
        value: (c) => c.state,
        optionLabel: (v) =>
          COMPENSATION_STATE_LABEL[v as CompensationState]
            ? l(...COMPENSATION_STATE_LABEL[v as CompensationState])
            : v,
      },
    ],
    [l],
  );
  const table = useTableView(rows ?? [], columns, {
    storageKey: "compensation-cycles",
    defaultSort: { key: "effectiveDate", dir: "desc" },
  });

  useEffect(() => {
    api<Cycle[]>("/compensation-cycles")
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    try {
      const created = await api<{ id: string }>("/compensation-cycles", {
        method: "POST",
        body: { ...form, departmentId: form.departmentId || null, gradeId: form.gradeId || null },
      });
      await api(`/compensation-cycles/${created.id}/generate`, { method: "POST" });
      router.push(`/payroll/compensation/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
    }
  };
  const err = (p: string) => fieldErrors[p] && <small className="error">{fieldErrors[p]}</small>;
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <header className="toolbar">
        <h1>{l("Kenaikan Gaji", "Salary Review")}</h1>
        {manage && !open && (
          <button type="button" className="primary" onClick={() => setOpen(true)}>
            {l("Siklus baru", "New cycle")}
          </button>
        )}
      </header>
      <p className="muted">
        {l(
          "Usulan kenaikan per karyawan dihitung dari hasil penilaian kinerja terakhir, dibatasi anggaran, disetujui lewat Persetujuan, lalu diterapkan sebagai kontrak upah baru (berlaku mundur → rapel di payroll berikutnya).",
          "Per-employee raise proposals come from the latest performance appraisal, are limited by a budget, approved through Approvals, then applied as new wage contracts (backdated → retro pay in the next payroll).",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {open && (
        <form className="inline-panel" onSubmit={submit}>
          <label className="field">
            <span>{l("Nama siklus", "Cycle name")}</span>
            <input required value={form.name} onChange={(e) => set("name", e.target.value)} />
            {err("name")}
          </label>
          <label className="field">
            <span>{l("Tanggal berlaku", "Effective date")}</span>
            <input
              type="date"
              required
              value={form.effectiveDate}
              onChange={(e) => set("effectiveDate", e.target.value || today())}
            />
            {err("effectiveDate")}
          </label>
          <label className="field">
            <span>{l("Anggaran", "Budget")}</span>
            <select value={form.budgetKind} onChange={(e) => set("budgetKind", e.target.value)}>
              <option value="percent">{l("% dari total upah peserta", "% of participants' wages")}</option>
              <option value="amount">
                {l("Nominal tambahan upah / bulan", "Monthly wage increase amount")}
              </option>
            </select>
          </label>
          <label className="field">
            <span>{form.budgetKind === "percent" ? "%" : "Rp"}</span>
            <input
              className="num"
              inputMode="decimal"
              required
              value={form.budgetValue}
              onChange={(e) => set("budgetValue", e.target.value)}
            />
            {err("budgetValue")}
          </label>
          <label className="field">
            <span>{l("Departemen (opsional)", "Department (optional)")}</span>
            <RefSelect
              name="departmentId"
              resource="departments"
              display="name"
              value={form.departmentId}
              onChange={(v) => set("departmentId", v)}
            />
          </label>
          <label className="field">
            <span>{l("Golongan (opsional)", "Grade (optional)")}</span>
            <RefSelect
              name="gradeId"
              resource="salary-grades"
              display="name"
              value={form.gradeId}
              onChange={(v) => set("gradeId", v)}
            />
          </label>
          <button className="primary">{l("Buat & isi usulan", "Create & fill proposals")}</button>
          <button type="button" onClick={() => setOpen(false)}>
            {l("Batal", "Cancel")}
          </button>
        </form>
      )}
      <section className="panel stack proj-panel">
        {!rows ? (
          <p className="muted">{l("Memuat…", "Loading…")}</p>
        ) : rows.length === 0 ? (
          <p className="muted">{l("Belum ada siklus kenaikan gaji.", "No salary review cycles yet.")}</p>
        ) : (
          <>
            <TableTools view={table} />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <SortTh view={table} col="name">
                      {l("Siklus", "Cycle")}
                    </SortTh>
                    <SortTh view={table} col="effectiveDate">
                      {l("Berlaku", "Effective")}
                    </SortTh>
                    <SortTh view={table} col="count" className="num">
                      {l("Peserta", "Employees")}
                    </SortTh>
                    <SortTh view={table} col="budget" className="num">
                      {l("Anggaran / bln", "Budget / mo")}
                    </SortTh>
                    <SortTh view={table} col="used" className="num">
                      {l("Terpakai", "Used")}
                    </SortTh>
                    <SortTh view={table} col="average" className="num">
                      {l("Rata-rata", "Average")}
                    </SortTh>
                    <SortTh view={table} col="state">
                      Status
                    </SortTh>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/payroll/compensation/${c.id}`}>{c.name}</Link>
                      </td>
                      <td>{formatDate(c.effectiveDate, locale)}</td>
                      <td className="num">{c.count}</td>
                      <td className="num">{money(c.budget.budget, locale)}</td>
                      <td className={`num ${c.budget.overBudget ? "error" : ""}`}>
                        {money(c.budget.used, locale)}
                      </td>
                      <td className="num">{Number(c.budget.averagePercent)}%</td>
                      <td>
                        <span className={`pill ${cycleStatePill(c.state)}`}>
                          {l(...COMPENSATION_STATE_LABEL[c.state])}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {table.rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">
                        {l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
        {rows && rows.length > 0 && <TablePager view={table} />}
      </section>
    </>
  );
}
