"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { BENEFIT_KIND_LABEL, BENEFIT_KINDS, type BenefitKind } from "@erp/shared";
import { useMe } from "../../../../components/me-context";
import { planValue, type BenefitPlan } from "../../../../components/payroll/benefits-panel";
import { RefSelect } from "../../../../components/ref-select";
import { api, ApiError } from "../../../../lib/api";
import { download } from "../../../../lib/download";
import { money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface Report {
  summary: {
    planId: string;
    code: string;
    name: string;
    kind: BenefitKind;
    provider: string | null;
    members: number;
    employer: string;
    employee: string;
    total: string;
  }[];
}

const EMPTY = {
  code: "",
  name: "",
  kind: "health_insurance" as BenefitKind,
  providerId: "",
  policyNo: "",
  calc: "fixed" as "fixed" | "percent_wage",
  employerAmount: "0",
  employeeAmount: "0",
  wageCap: "",
  dependentAmount: "0",
  dependentPayer: "employer" as "employer" | "employee",
  taxable: true,
  expenseAccountId: "",
  payableAccountId: "",
  active: true,
};
type Form = typeof EMPTY;

/** Payroll › Konfigurasi › Benefit: asuransi kesehatan swasta, DPLK, fasilitas; laporan premi/iuran per penyedia. */
export default function BenefitPlansPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<BenefitPlan[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const month = today().slice(0, 7);
  const [range, setRange] = useState({ from: `${month.slice(0, 4)}-01`, to: month });
  const [report, setReport] = useState<Report | null>(null);
  const columns = useMemo<ViewColumn<BenefitPlan>[]>(
    () => [
      {
        key: "name",
        label: l("Paket", "Plan"),
        value: (p) => p.name,
        text: (p) => `${p.name} ${p.code} ${p.policyNo ?? ""}`,
      },
      {
        key: "kind",
        label: l("Jenis", "Kind"),
        type: "enum",
        value: (p) => p.kind,
        optionLabel: (v) =>
          BENEFIT_KIND_LABEL[v as BenefitKind] ? l(...BENEFIT_KIND_LABEL[v as BenefitKind]) : v,
      },
      { key: "provider", label: l("Penyedia", "Provider"), type: "enum", value: (p) => p.provider },
      {
        key: "employer",
        label: l("Perusahaan", "Employer"),
        type: "number",
        value: (p) => Number(p.employerAmount),
      },
      {
        key: "employee",
        label: l("Karyawan", "Employee"),
        type: "number",
        value: (p) => Number(p.employeeAmount),
      },
      { key: "members", label: l("Peserta", "Members"), type: "number", value: (p) => p.members },
      {
        key: "active",
        label: l("Aktif", "Active"),
        type: "enum",
        value: (p) => (p.active ? "1" : "0"),
        optionLabel: (v) => (v === "1" ? l("Aktif", "Active") : l("Nonaktif", "Inactive")),
        hidden: true,
      },
    ],
    [l],
  );
  const table = useTableView(rows ?? [], columns, { storageKey: "benefit-plans" });
  const manage = can(me.permissions, "payroll.manage");

  useEffect(() => {
    api<BenefitPlan[]>("/benefit-plans")
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [version]);
  useEffect(() => {
    api<Report>(`/payroll/reports/benefits?from=${range.from}&to=${range.to}`)
      .then(setReport)
      .catch(() => setReport(null));
  }, [range, version]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const edit = (p: BenefitPlan | null) => {
    setFieldErrors({});
    setError(null);
    setEditId(p?.id ?? null);
    setForm(
      p
        ? {
            ...EMPTY,
            ...Object.fromEntries(
              Object.entries(p).map(([k, v]) => [
                k,
                v === null ? "" : typeof v === "boolean" ? v : String(v),
              ]),
            ),
            taxable: p.taxable,
            active: p.active,
          }
        : { ...EMPTY },
    );
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setFieldErrors({});
    const body = {
      ...form,
      providerId: form.providerId || null,
      policyNo: form.policyNo || null,
      wageCap: form.wageCap || null,
      expenseAccountId: form.expenseAccountId || null,
      payableAccountId: form.payableAccountId || null,
    };
    try {
      await api(editId ? `/benefit-plans/${editId}` : "/benefit-plans", {
        method: editId ? "PATCH" : "POST",
        body,
      });
      setForm(null);
      setEditId(null);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
    }
  };
  const remove = async (id: string) => {
    if (!confirm(l("Hapus paket benefit ini?", "Delete this benefit plan?"))) return;
    try {
      await api(`/benefit-plans/${id}`, { method: "DELETE" });
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const err = (p: string) => fieldErrors[p] && <small className="error">{fieldErrors[p]}</small>;
  const unit = form?.calc === "percent_wage" ? "%" : l("Rp / bulan", "Rp / month");

  return (
    <>
      <header className="toolbar">
        <h1>{l("Paket Benefit", "Benefit Plans")}</h1>
        {manage && !form && (
          <button type="button" className="primary" onClick={() => edit(null)}>
            {l("Paket baru", "New plan")}
          </button>
        )}
      </header>
      <p className="muted">
        {l(
          "Asuransi kesehatan swasta, DPLK, dan fasilitas (kendaraan, HP, rumah dinas). Porsi perusahaan yang kena pajak menjadi natura di PPh 21; iuran DPLK karyawan menjadi pengurang PPh 21.",
          "Private health insurance, pension funds (DPLK), and perks (car, phone, housing). The taxable employer portion becomes a benefit in kind for PPh 21; employee DPLK contributions reduce PPh 21.",
        )}
      </p>
      {error && <p className="error">{error}</p>}

      {form && (
        <form className="panel stack benefit-form" onSubmit={submit}>
          <h2>{editId ? l("Ubah paket", "Edit plan") : l("Paket baru", "New plan")}</h2>
          <div className="o-grid">
            <div className="stack">
              <label className="field">
                <span>{l("Kode", "Code")}</span>
                <input required value={form.code} onChange={(e) => set("code", e.target.value)} />
                {err("code")}
              </label>
              <label className="field">
                <span>{l("Nama", "Name")}</span>
                <input required value={form.name} onChange={(e) => set("name", e.target.value)} />
                {err("name")}
              </label>
              <label className="field">
                <span>{l("Jenis", "Kind")}</span>
                <select
                  value={form.kind}
                  onChange={(e) => {
                    const kind = e.target.value as BenefitKind;
                    setForm((f) => (f ? { ...f, kind, taxable: kind !== "pension" } : f));
                  }}
                >
                  {BENEFIT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {l(...BENEFIT_KIND_LABEL[k])}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{l("Penyedia", "Provider")}</span>
                <RefSelect
                  name="providerId"
                  resource="partners"
                  display="name"
                  value={form.providerId}
                  onChange={(v) => set("providerId", v)}
                />
                {err("providerId")}
              </label>
              <label className="field">
                <span>{l("Nomor polis / kontrak", "Policy / contract no.")}</span>
                <input value={form.policyNo} onChange={(e) => set("policyNo", e.target.value)} />
              </label>
            </div>
            <div className="stack">
              <label className="field">
                <span>{l("Cara hitung iuran", "Contribution method")}</span>
                <select value={form.calc} onChange={(e) => set("calc", e.target.value as Form["calc"])}>
                  <option value="fixed">{l("Nominal tetap per bulan", "Fixed amount per month")}</option>
                  <option value="percent_wage">
                    {l(
                      "Persen upah (gaji pokok + tunjangan tetap)",
                      "Percent of wage (base + fixed allowances)",
                    )}
                  </option>
                </select>
              </label>
              <label className="field">
                <span>
                  {l("Porsi perusahaan", "Employer portion")} ({unit})
                </span>
                <input
                  className="num"
                  inputMode="decimal"
                  value={form.employerAmount}
                  onChange={(e) => set("employerAmount", e.target.value)}
                />
                {err("employerAmount")}
              </label>
              <label className="field">
                <span>
                  {l("Porsi karyawan", "Employee portion")} ({unit})
                </span>
                <input
                  className="num"
                  inputMode="decimal"
                  value={form.employeeAmount}
                  onChange={(e) => set("employeeAmount", e.target.value)}
                />
                {err("employeeAmount")}
              </label>
              {form.calc === "percent_wage" && (
                <label className="field">
                  <span>{l("Batas upah (opsional)", "Wage cap (optional)")}</span>
                  <input
                    className="num"
                    inputMode="decimal"
                    value={form.wageCap}
                    onChange={(e) => set("wageCap", e.target.value)}
                  />
                  {err("wageCap")}
                </label>
              )}
              <label className="field">
                <span>{l("Premi per tanggungan / bulan", "Premium per dependent / month")}</span>
                <input
                  className="num"
                  inputMode="decimal"
                  value={form.dependentAmount}
                  onChange={(e) => set("dependentAmount", e.target.value)}
                />
              </label>
              <label className="field">
                <span>{l("Premi tanggungan dibayar", "Dependent premium paid by")}</span>
                <select
                  value={form.dependentPayer}
                  onChange={(e) => set("dependentPayer", e.target.value as Form["dependentPayer"])}
                >
                  <option value="employer">{l("Perusahaan", "Employer")}</option>
                  <option value="employee">
                    {l("Karyawan (dipotong gaji)", "Employee (payroll deduction)")}
                  </option>
                </select>
              </label>
            </div>
            <div className="stack">
              <label className="field">
                <span>
                  {l("Akun beban (kosong = beban gaji)", "Expense account (empty = salary expense)")}
                </span>
                <RefSelect
                  name="expenseAccountId"
                  resource="accounts"
                  display="name"
                  value={form.expenseAccountId}
                  onChange={(v) => set("expenseAccountId", v)}
                />
                {err("expenseAccountId")}
              </label>
              <label className="field">
                <span>{l("Akun utang premi/iuran ke penyedia", "Premium/contribution payable account")}</span>
                <RefSelect
                  name="payableAccountId"
                  resource="accounts"
                  display="name"
                  value={form.payableAccountId}
                  onChange={(v) => set("payableAccountId", v)}
                />
                {err("payableAccountId")}
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.taxable}
                  onChange={(e) => set("taxable", e.target.checked)}
                />
                {l(
                  "Porsi perusahaan menambah penghasilan bruto PPh 21 (natura)",
                  "Employer portion is taxable income for PPh 21 (in kind)",
                )}
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => set("active", e.target.checked)}
                />
                {l("Aktif", "Active")}
              </label>
            </div>
          </div>
          <div className="toolbar">
            <button className="primary">{l("Simpan", "Save")}</button>
            <button type="button" onClick={() => setForm(null)}>
              {l("Batal", "Cancel")}
            </button>
          </div>
        </form>
      )}

      <section className="panel stack proj-panel">
        {!rows ? (
          <p className="muted">{l("Memuat…", "Loading…")}</p>
        ) : rows.length === 0 ? (
          <p className="muted">{l("Belum ada paket benefit.", "No benefit plans yet.")}</p>
        ) : (
          <>
            <TableTools view={table} />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <SortTh view={table} col="name">
                      {l("Paket", "Plan")}
                    </SortTh>
                    <SortTh view={table} col="kind">
                      {l("Jenis", "Kind")}
                    </SortTh>
                    <SortTh view={table} col="provider">
                      {l("Penyedia", "Provider")}
                    </SortTh>
                    <SortTh view={table} col="employer" className="num">
                      {l("Perusahaan", "Employer")}
                    </SortTh>
                    <SortTh view={table} col="employee" className="num">
                      {l("Karyawan", "Employee")}
                    </SortTh>
                    <SortTh view={table} col="members" className="num">
                      {l("Peserta", "Members")}
                    </SortTh>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((p) => (
                    <tr key={p.id} className={p.active ? "" : "muted"}>
                      <td>
                        <Link href={`/payroll/benefits/${p.id}`}>{p.name}</Link>{" "}
                        <small className="muted">{p.code}</small>
                      </td>
                      <td>
                        {l(...BENEFIT_KIND_LABEL[p.kind])}
                        {p.taxable && <small className="muted"> · {l("natura", "in kind")}</small>}
                      </td>
                      <td>{p.provider ?? "—"}</td>
                      <td className="num">{planValue(p.calc, p.employerAmount, locale)}</td>
                      <td className="num">{planValue(p.calc, p.employeeAmount, locale)}</td>
                      <td className="num">{p.members}</td>
                      <td className="nowrap">
                        {manage && (
                          <>
                            <button type="button" className="link" onClick={() => edit(p)}>
                              {l("Ubah", "Edit")}
                            </button>
                            <button type="button" className="link danger" onClick={() => remove(p.id)}>
                              {l("Hapus", "Delete")}
                            </button>
                          </>
                        )}
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
            <TablePager view={table} />
          </>
        )}
      </section>

      <section className="panel stack proj-panel">
        <h2>{l("Laporan premi & iuran", "Premium & contribution report")}</h2>
        <div className="inline-panel">
          <label className="field">
            <span>{l("Dari", "From")}</span>
            <input
              type="month"
              value={range.from}
              onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>{l("Sampai", "To")}</span>
            <input
              type="month"
              value={range.to}
              onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))}
            />
          </label>
          <button
            type="button"
            onClick={() =>
              download(
                `/payroll/reports/benefits?from=${range.from}&to=${range.to}&format=xlsx`,
                undefined,
                `benefit-${range.from}-${range.to}.xlsx`,
              ).catch((e: Error) => setError(e.message))
            }
          >
            {l("Unduh Excel", "Download Excel")}
          </button>
        </div>
        {report && report.summary.length === 0 ? (
          <p className="muted">
            {l("Belum ada iuran dari payroll terposting.", "No contributions from posted payroll yet.")}
          </p>
        ) : (
          report && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{l("Paket", "Plan")}</th>
                    <th>{l("Penyedia", "Provider")}</th>
                    <th className="num">{l("Peserta", "Members")}</th>
                    <th className="num">{l("Perusahaan", "Employer")}</th>
                    <th className="num">{l("Karyawan", "Employee")}</th>
                    <th className="num">{l("Total setor", "Total to remit")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.summary.map((r) => (
                    <tr key={r.planId}>
                      <td>
                        {r.name} <small className="muted">{r.code}</small>
                      </td>
                      <td>{r.provider ?? "—"}</td>
                      <td className="num">{r.members}</td>
                      <td className="num">{money(r.employer, locale)}</td>
                      <td className="num">{money(r.employee, locale)}</td>
                      <td className="num">
                        <strong>{money(r.total, locale)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </section>
    </>
  );
}
