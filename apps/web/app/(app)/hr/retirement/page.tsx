"use client";

import {
  RETIREMENT_DATE_RULE_LABEL,
  RETIREMENT_RULE_KIND_LABEL,
  type RetirementDateRule,
  type RetirementRuleKind,
} from "@erp/shared";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable, type DataColumn } from "../../../../components/data-table";
import { errorText } from "../../../../components/hr/hr-panels";
import { useMe } from "../../../../components/me-context";
import { RefSelect } from "../../../../components/ref-select";
import { api, ApiError } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Rule {
  kind: RetirementRuleKind;
  refId: string;
  refName?: string | null;
  retirementAge: number | string;
  note: string | null;
}
interface Policy {
  retirementAge: number | string;
  dateRule: RetirementDateRule;
  reminderMonths: number | string;
  rules: Rule[];
}
interface Upcoming {
  employeeId: string;
  employeeNumber: string;
  name: string;
  birthDate: string;
  department: string | null;
  job: string | null;
  age: number;
  source: "employee" | RetirementRuleKind | "company";
  date: string;
}

const REF_RESOURCE: Record<RetirementRuleKind, string> = {
  job: "job-positions",
  grade: "salary-grades",
  department: "departments",
};
const SOURCE_LABEL: Record<Upcoming["source"], [string, string]> = {
  employee: ["Khusus karyawan", "Employee-specific"],
  job: ["Jabatan", "Job position"],
  grade: ["Golongan", "Grade"],
  department: ["Departemen", "Department"],
  company: ["Bawaan perusahaan", "Company default"],
};

/**
 * Kebijakan usia pensiun perusahaan aktif: usia bawaan, aturan tanggal pensiun, pengingat, dan pengecualian per
 * jabatan / golongan / departemen (usia khusus per karyawan diatur di data karyawan). Di bawahnya daftar karyawan yang
 * akan pensiun.
 */
export default function RetirementPage() {
  const { l, locale } = useI18n();
  const me = useMe();
  const manage = can(me.permissions, "hr.manage");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [months, setMonths] = useState("12");
  const [upcoming, setUpcoming] = useState<Upcoming[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadUpcoming = useCallback(
    (m: string) =>
      api<Upcoming[]>(`/retirement/upcoming?months=${m}`).then(setUpcoming, (e) => setError(errorText(e))),
    [],
  );
  useEffect(() => {
    api<Policy>("/retirement-policy").then(setPolicy, (e) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    void loadUpcoming(months);
  }, [months, loadUpcoming]);

  const set = <K extends keyof Policy>(k: K, v: Policy[K]) => setPolicy((p) => (p ? { ...p, [k]: v } : p));
  const setRule = (i: number, patch: Partial<Rule>) =>
    setPolicy((p) => (p ? { ...p, rules: p.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) } : p));
  const save = async () => {
    if (!policy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setErrors({});
    try {
      const saved = await api<Policy>("/retirement-policy", {
        method: "PUT",
        body: {
          retirementAge: Number(policy.retirementAge),
          dateRule: policy.dateRule,
          reminderMonths: Number(policy.reminderMonths),
          rules: policy.rules
            .filter((r) => r.refId)
            .map((r) => ({
              kind: r.kind,
              refId: r.refId,
              retirementAge: Number(r.retirementAge),
              note: r.note || null,
            })),
        },
      });
      setPolicy(saved);
      setNotice(l("Kebijakan usia pensiun disimpan.", "Retirement policy saved."));
      await loadUpcoming(months);
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const fe = (k: string) => errors[k] && <small className="error">{errors[k]}</small>;

  const columns = useMemo<DataColumn<Upcoming>[]>(
    () => [
      {
        key: "name",
        label: l("Karyawan", "Employee"),
        value: (r) => r.name,
        render: (r) => (
          <>
            <Link href={`/employees/${r.employeeId}`}>{r.name}</Link>
            <br />
            <small className="muted">{r.employeeNumber}</small>
          </>
        ),
      },
      { key: "department", label: l("Departemen", "Department"), type: "enum", value: (r) => r.department },
      { key: "job", label: l("Jabatan", "Job position"), type: "enum", value: (r) => r.job },
      {
        key: "birthDate",
        label: l("Tanggal lahir", "Birth date"),
        type: "date",
        value: (r) => r.birthDate,
        text: (r) => formatDate(r.birthDate, locale),
      },
      {
        key: "age",
        label: l("Usia pensiun", "Retirement age"),
        type: "number",
        className: "num",
        value: (r) => r.age,
      },
      {
        key: "source",
        label: l("Dasar", "Basis"),
        type: "enum",
        value: (r) => r.source,
        optionLabel: (v) => l(...(SOURCE_LABEL[v as Upcoming["source"]] ?? [v, v])),
        text: (r) => l(...SOURCE_LABEL[r.source]),
      },
      {
        key: "date",
        label: l("Tanggal pensiun", "Retirement date"),
        type: "date",
        value: (r) => r.date,
        render: (r) => (
          <>
            {formatDate(r.date, locale)}
            {r.date < new Date().toISOString().slice(0, 10) && (
              <span className="pill bad">{l("lewat", "past")}</span>
            )}
          </>
        ),
      },
    ],
    [l, locale],
  );

  return (
    <div className="stack-wide">
      <section className="panel">
        <header className="toolbar">
          <h1>{l("Usia Pensiun", "Retirement Age")}</h1>
        </header>
        <p className="muted">
          {l(
            "Kebijakan usia pensiun perusahaan aktif (sesuai Peraturan Perusahaan/PKB). Urutan yang berlaku: usia khusus karyawan (di data karyawan) → jabatan → golongan → departemen → usia bawaan. Kontrak tidak bisa melewati tanggal pensiun; karyawan yang mendekati pensiun muncul di Pengingat HR.",
            "Retirement policy of the active company (per company regulation/CLA). Precedence: employee-specific age (on the employee) → job position → grade → department → default age. Contracts cannot run past the retirement date; employees nearing retirement appear in HR Reminders.",
          )}
        </p>
        {error && <p className="error">{error}</p>}
        {notice && <p className="success">{notice}</p>}
        {policy && (
          <>
            <fieldset className="fields" disabled={!manage || busy}>
              <label className="field">
                <span>{l("Usia pensiun bawaan (tahun) *", "Default retirement age (years) *")}</span>
                <input
                  type="number"
                  min={40}
                  max={80}
                  value={policy.retirementAge}
                  onChange={(e) => set("retirementAge", e.target.value)}
                />
                {fe("retirementAge")}
              </label>
              <label className="field">
                <span>{l("Tanggal pensiun jatuh pada", "Retirement date falls on")}</span>
                <select
                  value={policy.dateRule}
                  onChange={(e) => set("dateRule", e.target.value as RetirementDateRule)}
                >
                  {Object.entries(RETIREMENT_DATE_RULE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {l(...v)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{l("Pengingat HR (bulan sebelumnya)", "HR reminder (months before)")}</span>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={policy.reminderMonths}
                  onChange={(e) => set("reminderMonths", e.target.value)}
                />
                {fe("reminderMonths")}
              </label>
            </fieldset>

            <h2>{l("Pengecualian", "Exceptions")}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{l("Berlaku untuk", "Applies to")}</th>
                    <th>{l("Jabatan / golongan / departemen", "Job / grade / department")}</th>
                    <th className="num">{l("Usia pensiun", "Retirement age")}</th>
                    <th>{l("Catatan", "Note")}</th>
                    {manage && <th />}
                  </tr>
                </thead>
                <tbody>
                  {policy.rules.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <select
                          value={r.kind}
                          disabled={!manage}
                          aria-label={l("Berlaku untuk", "Applies to")}
                          onChange={(e) =>
                            setRule(i, { kind: e.target.value as RetirementRuleKind, refId: "" })
                          }
                        >
                          {Object.entries(RETIREMENT_RULE_KIND_LABEL).map(([k, v]) => (
                            <option key={k} value={k}>
                              {l(...v)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {manage ? (
                          <RefSelect
                            key={r.kind}
                            name={`rules.${i}.refId`}
                            resource={REF_RESOURCE[r.kind]}
                            display="name"
                            value={r.refId}
                            onChange={(v) => setRule(i, { refId: v })}
                          />
                        ) : (
                          r.refName
                        )}
                        {fe(`rules.${i}.refId`)}
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          min={40}
                          max={80}
                          className="num"
                          style={{ maxWidth: 90 }}
                          disabled={!manage}
                          aria-label={l("Usia pensiun", "Retirement age")}
                          value={r.retirementAge}
                          onChange={(e) => setRule(i, { retirementAge: e.target.value })}
                        />
                        {fe(`rules.${i}.retirementAge`)}
                      </td>
                      <td>
                        <input
                          value={r.note ?? ""}
                          maxLength={300}
                          disabled={!manage}
                          aria-label={l("Catatan", "Note")}
                          onChange={(e) => setRule(i, { note: e.target.value })}
                        />
                      </td>
                      {manage && (
                        <td>
                          <button
                            type="button"
                            className="link danger"
                            onClick={() =>
                              setPolicy((p) => (p ? { ...p, rules: p.rules.filter((_, j) => j !== i) } : p))
                            }
                          >
                            {l("Hapus", "Remove")}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {policy.rules.length === 0 && (
                    <tr>
                      <td colSpan={manage ? 5 : 4} className="muted">
                        {l(
                          "Belum ada pengecualian — semua karyawan memakai usia pensiun bawaan.",
                          "No exceptions — every employee uses the default retirement age.",
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {manage && (
              <div className="row-actions">
                <button
                  type="button"
                  onClick={() =>
                    set("rules", [
                      ...policy.rules,
                      { kind: "job", refId: "", retirementAge: policy.retirementAge, note: "" },
                    ])
                  }
                >
                  {l("Tambah pengecualian", "Add exception")}
                </button>
                <button type="button" className="primary" disabled={busy} onClick={save}>
                  {l("Simpan", "Save")}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="panel">
        <header className="toolbar">
          <h2>{l("Akan pensiun", "Upcoming retirements")}</h2>
          <select
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            aria-label={l("Rentang", "Range")}
          >
            {["6", "12", "24", "60"].map((m) => (
              <option key={m} value={m}>
                {l(`${m} bulan ke depan`, `Next ${m} months`)}
              </option>
            ))}
          </select>
        </header>
        {upcoming ? (
          <DataTable
            rows={upcoming}
            columns={columns}
            storageKey="retirement-upcoming"
            rowKey={(r) => r.employeeId}
            defaultSort={{ key: "date", dir: "asc" }}
            searchPlaceholder={l("Cari karyawan…", "Search employee…")}
            empty={l(
              "Tidak ada karyawan yang pensiun pada rentang ini (karyawan tanpa tanggal lahir tidak dihitung).",
              "No employees retire in this range (employees without a birth date are not counted).",
            )}
          />
        ) : (
          <p className="muted">{l("Memuat…", "Loading…")}</p>
        )}
      </section>
    </div>
  );
}
