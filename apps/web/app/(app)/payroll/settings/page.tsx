"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { api, ApiError } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

type Settings = Record<
  | "jkkRate"
  | "kesWageCap"
  | "jpWageCap"
  | "salaryExpenseAccountId"
  | "bpjsExpenseAccountId"
  | "salaryPayableAccountId"
  | "pph21PayableAccountId"
  | "bpjsPayableAccountId"
  | "journalId",
  string
>;

/** Pengaturan payroll: tarif JKK, batas upah BPJS, serta akun & jurnal gaji. */
export default function PayrollSettingsPage() {
  const { l } = useI18n();
  const accounts = useOptions<{ id: string; code: string; name: string }>("/accounts");
  const journals = useOptions<{ id: string; code: string; name: string; journalType: string }>("/journals");
  const [form, setForm] = useState<Settings | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Settings>("/payroll/settings")
      .then((s) =>
        setForm({
          ...s,
          jkkRate: String(Number(s.jkkRate)),
          kesWageCap: String(Number(s.kesWageCap)),
          jpWageCap: String(Number(s.jpWageCap)),
        }),
      )
      .catch((e: Error) => setError(e.message));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setNotice(null);
    try {
      const {
        jkkRate,
        kesWageCap,
        jpWageCap,
        salaryExpenseAccountId,
        bpjsExpenseAccountId,
        salaryPayableAccountId,
        pph21PayableAccountId,
        bpjsPayableAccountId,
        journalId,
      } = form;
      await api("/payroll/settings", {
        method: "PUT",
        body: {
          jkkRate: Number(jkkRate).toFixed(2),
          kesWageCap,
          jpWageCap,
          salaryExpenseAccountId,
          bpjsExpenseAccountId,
          salaryPayableAccountId,
          pph21PayableAccountId,
          bpjsPayableAccountId,
          journalId,
        },
      });
      setNotice(l("Pengaturan disimpan.", "Settings saved."));
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : String(err));
    }
  }

  if (!form) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  const set = (k: keyof Settings) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f!, [k]: e.target.value }));
  const accountSelect = (k: keyof Settings, label: string) => (
    <label className="field">
      <span>{label}</span>
      <select value={form[k]} onChange={set(k)}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} {a.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form className="panel narrow stack" onSubmit={save}>
      <h1>{l("Pengaturan Payroll", "Payroll Settings")}</h1>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      <label className="field">
        <span>{l("Tarif JKK (kelompok risiko)", "JKK rate (risk group)")}</span>
        <select value={form.jkkRate} onChange={set("jkkRate")}>
          {["0.24", "0.54", "0.89", "1.27", "1.74"].map((r) => (
            <option key={r} value={String(Number(r))}>
              {r}%
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{l("Batas upah BPJS Kesehatan", "BPJS Health wage cap")}</span>
        <input className="num" inputMode="decimal" value={form.kesWageCap} onChange={set("kesWageCap")} />
      </label>
      <label className="field">
        <span>
          {l(
            "Batas upah Jaminan Pensiun (disesuaikan BPJS tiap Maret)",
            "Pension (JP) wage cap (updated each March)",
          )}
        </span>
        <input className="num" inputMode="decimal" value={form.jpWageCap} onChange={set("jpWageCap")} />
      </label>
      {accountSelect("salaryExpenseAccountId", l("Akun beban gaji", "Salary expense account"))}
      {accountSelect(
        "bpjsExpenseAccountId",
        l("Akun beban BPJS perusahaan", "Employer BPJS expense account"),
      )}
      {accountSelect("salaryPayableAccountId", l("Akun utang gaji", "Salary payable account"))}
      {accountSelect("pph21PayableAccountId", l("Akun utang PPh 21", "PPh 21 payable account"))}
      {accountSelect("bpjsPayableAccountId", l("Akun utang BPJS", "BPJS payable account"))}
      <label className="field">
        <span>{l("Jurnal gaji", "Payroll journal")}</span>
        <select value={form.journalId} onChange={set("journalId")}>
          {journals
            .filter((j) => j.journalType === "general")
            .map((j) => (
              <option key={j.id} value={j.id}>
                {j.code} {j.name}
              </option>
            ))}
        </select>
      </label>
      <button className="primary">{l("Simpan", "Save")}</button>
    </form>
  );
}
