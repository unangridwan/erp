"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { BENEFIT_KIND_LABEL, type BenefitKind } from "@erp/shared";
import { api, ApiError } from "../../lib/api";
import { formatDate, money, today } from "../../lib/format";
import { useI18n, type Locale } from "../../lib/i18n";
import { can } from "../../lib/resources";
import { useMe } from "../me-context";
import { RefSelect } from "../ref-select";

export interface BenefitPlan {
  id: string;
  code: string;
  name: string;
  kind: BenefitKind;
  providerId: string | null;
  provider: string | null;
  policyNo: string | null;
  calc: "fixed" | "percent_wage";
  employerAmount: string;
  employeeAmount: string;
  wageCap: string | null;
  dependentAmount: string;
  dependentPayer: "employer" | "employee";
  taxable: boolean;
  expenseAccountId: string | null;
  payableAccountId: string | null;
  active: boolean;
  members: number;
}

export interface Enrollment {
  id: string;
  planId: string;
  employeeId: string;
  dateStart: string;
  dateEnd: string | null;
  memberNo: string | null;
  dependentIds: string[];
  employerAmount: string | null;
  employeeAmount: string | null;
  note: string | null;
  planCode: string;
  planName: string;
  kind: BenefitKind;
  provider: string | null;
  employeeName: string;
  employeeNumber: string;
  dependents: { id: string; name: string; relation: string }[];
  lastContribution: { month: string; employer: string; employee: string } | null;
}

/** Nilai iuran paket untuk tabel: nominal per bulan atau persen upah. */
export const planValue = (calc: string, v: string, locale: Locale) =>
  calc === "percent_wage" ? `${Number(v)}%` : money(v, locale);

const isActive = (e: { dateEnd: string | null }) => !e.dateEnd || e.dateEnd >= today();

const EMPTY = {
  planId: "",
  employeeId: "",
  dateStart: today(),
  dateEnd: "",
  memberNo: "",
  dependentIds: [] as string[],
  employerAmount: "",
  employeeAmount: "",
  note: "",
};

/**
 * Kepesertaan benefit: per karyawan (tab Benefit di form karyawan), per paket (detail paket), atau milik sendiri
 * (portal, `mine`). Pengguna `payroll.manage` bisa menambah, mengubah, dan mengakhiri kepesertaan.
 */
export function BenefitEnrollments({
  employeeId,
  planId,
  mine = false,
}: {
  employeeId?: string;
  planId?: string;
  mine?: boolean;
}) {
  const me = useMe();
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Enrollment[] | null>(null);
  const [plans, setPlans] = useState<BenefitPlan[]>([]);
  const [family, setFamily] = useState<{ id: string; name: string; relation: string }[]>([]);
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const manage = !mine && can(me.permissions, "payroll.manage");
  const canRead = mine || can(me.permissions, "payroll.read");

  useEffect(() => {
    if (!canRead) return;
    const path = mine
      ? "/me/benefits"
      : planId
        ? `/benefit-plans/${planId}`
        : `/employees/${employeeId}/benefits`;
    api<Enrollment[] | { enrollments: Enrollment[] }>(path)
      .then((r) => setRows(Array.isArray(r) ? r : r.enrollments))
      .catch((e: Error) => setError(e.message));
  }, [employeeId, planId, mine, version, canRead]);
  useEffect(() => {
    if (manage && !planId)
      api<BenefitPlan[]>("/benefit-plans")
        .then((p) => setPlans(p.filter((x) => x.active)))
        .catch(() => setPlans([]));
  }, [manage, planId]);
  // Anggota keluarga karyawan (pilihan tanggungan) dimuat saat form terbuka.
  const familyOf = form ? (employeeId ?? form.employeeId) : "";
  useEffect(() => {
    if (!manage || !familyOf) return setFamily([]);
    api<{ id: string; name: string; relation: string }[]>(`/employees/${familyOf}/family`)
      .then(setFamily)
      .catch(() => setFamily([]));
  }, [manage, familyOf]);

  if (!canRead) return null;
  if (mine && rows && rows.length === 0) return null;

  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));
  const edit = (e: Enrollment | null) => {
    setError(null);
    setFieldErrors({});
    setEditId(e?.id ?? null);
    setForm(
      e
        ? {
            planId: e.planId,
            employeeId: e.employeeId,
            dateStart: e.dateStart,
            dateEnd: e.dateEnd ?? "",
            memberNo: e.memberNo ?? "",
            dependentIds: e.dependentIds,
            employerAmount: e.employerAmount ?? "",
            employeeAmount: e.employeeAmount ?? "",
            note: e.note ?? "",
          }
        : { ...EMPTY, planId: planId ?? "", employeeId: employeeId ?? "" },
    );
  };
  const call = async (fn: () => Promise<unknown>) => {
    setError(null);
    setFieldErrors({});
    try {
      await fn();
      setForm(null);
      setEditId(null);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const body = {
      ...form,
      dateEnd: form.dateEnd || null,
      memberNo: form.memberNo || null,
      employerAmount: form.employerAmount || null,
      employeeAmount: form.employeeAmount || null,
      note: form.note || null,
    };
    void call(() =>
      api(editId ? `/benefit-enrollments/${editId}` : "/benefit-enrollments", {
        method: editId ? "PATCH" : "POST",
        body,
      }),
    );
  };
  const remove = (id: string) => {
    if (confirm(l("Hapus kepesertaan ini?", "Delete this enrollment?")))
      void call(() => api(`/benefit-enrollments/${id}`, { method: "DELETE" }));
  };
  const err = (p: string) => fieldErrors[p] && <small className="error">{fieldErrors[p]}</small>;

  return (
    <section className="panel stack proj-panel">
      <header className="toolbar">
        <h2>
          {mine
            ? l("Benefit saya", "My benefits")
            : planId
              ? l("Peserta", "Members")
              : l("Benefit & asuransi", "Benefits & insurance")}
        </h2>
        {manage && !form && (
          <button type="button" onClick={() => edit(null)}>
            {planId ? l("Tambah peserta", "Add member") : l("Ikutkan benefit", "Enroll")}
          </button>
        )}
      </header>
      {error && <p className="error">{error}</p>}

      {form && (
        <form className="inline-panel" onSubmit={submit}>
          {!planId && (
            <label className="field">
              <span>{l("Paket", "Plan")}</span>
              <select
                required
                disabled={!!editId}
                value={form.planId}
                onChange={(e) => set("planId", e.target.value)}
              >
                <option value="">—</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
              {err("planId")}
            </label>
          )}
          {!employeeId && (
            <label className="field">
              <span>{l("Karyawan", "Employee")}</span>
              <RefSelect
                name="employeeId"
                resource="employees"
                display="name"
                required
                value={form.employeeId}
                onChange={(v) => setForm((f) => (f ? { ...f, employeeId: v, dependentIds: [] } : f))}
              />
              {err("employeeId")}
            </label>
          )}
          <label className="field">
            <span>{l("Mulai", "Start")}</span>
            <input
              type="date"
              required
              value={form.dateStart}
              onChange={(e) => set("dateStart", e.target.value)}
            />
            {err("dateStart")}
          </label>
          <label className="field">
            <span>{l("Berakhir (opsional)", "End (optional)")}</span>
            <input type="date" value={form.dateEnd} onChange={(e) => set("dateEnd", e.target.value)} />
            {err("dateEnd")}
          </label>
          <label className="field">
            <span>{l("No. peserta / kartu", "Member / card no.")}</span>
            <input value={form.memberNo} onChange={(e) => set("memberNo", e.target.value)} />
          </label>
          <label className="field">
            <span>{l("Porsi perusahaan khusus", "Employer override")}</span>
            <input
              className="num"
              inputMode="decimal"
              placeholder={l("ikut paket", "plan default")}
              value={form.employerAmount}
              onChange={(e) => set("employerAmount", e.target.value)}
            />
            {err("employerAmount")}
          </label>
          <label className="field">
            <span>{l("Porsi karyawan khusus", "Employee override")}</span>
            <input
              className="num"
              inputMode="decimal"
              placeholder={l("ikut paket", "plan default")}
              value={form.employeeAmount}
              onChange={(e) => set("employeeAmount", e.target.value)}
            />
            {err("employeeAmount")}
          </label>
          {family.length > 0 && (
            <fieldset className="field">
              <legend>{l("Tanggungan yang ikut", "Covered dependents")}</legend>
              {family.map((f) => (
                <label key={f.id} className="check">
                  <input
                    type="checkbox"
                    checked={form.dependentIds.includes(f.id)}
                    onChange={(e) =>
                      set(
                        "dependentIds",
                        e.target.checked
                          ? [...form.dependentIds, f.id]
                          : form.dependentIds.filter((x) => x !== f.id),
                      )
                    }
                  />
                  {f.name}
                </label>
              ))}
              {err("dependentIds")}
            </fieldset>
          )}
          <label className="field">
            <span>{l("Catatan", "Note")}</span>
            <input value={form.note} onChange={(e) => set("note", e.target.value)} />
          </label>
          <button className="primary">{l("Simpan", "Save")}</button>
          <button type="button" onClick={() => setForm(null)}>
            {l("Batal", "Cancel")}
          </button>
        </form>
      )}

      {!rows ? (
        <p className="muted">{l("Memuat…", "Loading…")}</p>
      ) : rows.length === 0 ? (
        <p className="muted">{l("Belum ada kepesertaan.", "No enrollments yet.")}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{planId ? l("Karyawan", "Employee") : l("Paket", "Plan")}</th>
                <th>{l("Periode", "Period")}</th>
                <th>{l("No. peserta", "Member no.")}</th>
                <th>{l("Tanggungan", "Dependents")}</th>
                <th className="num">{l("Iuran terakhir", "Last contribution")}</th>
                {manage && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className={isActive(e) ? "" : "muted"}>
                  <td>
                    {planId ? (
                      <>
                        <Link href={`/employees/${e.employeeId}`}>{e.employeeName}</Link>{" "}
                        <small className="muted">{e.employeeNumber}</small>
                      </>
                    ) : (
                      <>
                        {mine ? e.planName : <Link href={`/payroll/benefits/${e.planId}`}>{e.planName}</Link>}
                        <br />
                        <small className="muted">
                          {l(...BENEFIT_KIND_LABEL[e.kind])}
                          {e.provider && ` · ${e.provider}`}
                        </small>
                      </>
                    )}
                  </td>
                  <td>
                    {formatDate(e.dateStart, locale)} –{" "}
                    {e.dateEnd ? formatDate(e.dateEnd, locale) : l("berjalan", "ongoing")}
                  </td>
                  <td>{e.memberNo ?? "—"}</td>
                  <td>{e.dependents.map((d) => d.name).join(", ") || "—"}</td>
                  <td className="num">
                    {e.lastContribution ? (
                      <>
                        {money(e.lastContribution.employer, locale)} /{" "}
                        {money(e.lastContribution.employee, locale)}
                        <br />
                        <small className="muted">
                          {l("perusahaan / karyawan", "employer / employee")} · {e.lastContribution.month}
                        </small>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  {manage && (
                    <td className="nowrap">
                      <button type="button" className="link" onClick={() => edit(e)}>
                        {l("Ubah", "Edit")}
                      </button>
                      <button type="button" className="link danger" onClick={() => remove(e.id)}>
                        {l("Hapus", "Delete")}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
