"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useOptions } from "../../../../../components/accounting/use-options";
import { useMe } from "../../../../../components/me-context";
import { RefSelect } from "../../../../../components/ref-select";
import { api, ApiError } from "../../../../../lib/api";
import { formatDate, today } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";
import { ask } from "../../../../../components/feedback";

interface Form {
  leaveTypeId: string;
  name: string;
  frequency: "monthly" | "yearly";
  daysPerPeriod: string;
  startAfterMonths: number;
  maxBalance: string;
  carryOver: "none" | "all" | "limited";
  carryOverMax: string;
  carryOverExpiryMonths: string;
  active: boolean;
}
interface Assignment {
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  joinDate: string;
  dateFrom: string;
}

/** Preset cuti tahunan menurut UU 13/2003 jo. UU 6/2023. */
const LAW_PRESET: Omit<Form, "leaveTypeId"> = {
  name: "Cuti tahunan (UU Ketenagakerjaan)",
  frequency: "yearly",
  daysPerPeriod: "12",
  startAfterMonths: 12,
  maxBalance: "",
  carryOver: "limited",
  carryOverMax: "6",
  carryOverExpiryMonths: "3",
  active: true,
};

/** Ubah rencana akrual: aturan, penugasan karyawan, jalankan akrual & carry-over. */
export default function LeavePlanPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const { l, locale } = useI18n();
  const me = useMe();
  const manage = can(me.permissions, "hr.manage");
  const types = useOptions<{ id: string; name: string; requiresAllocation: boolean }>("/leave-types");
  const [form, setForm] = useState<Form | null>(isNew ? { ...LAW_PRESET, leaveTypeId: "" } : null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assign, setAssign] = useState({ mode: "all", departmentId: "", employeeId: "", dateFrom: today() });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (isNew) return;
    api<
      Form & {
        maxBalance: string | null;
        carryOverMax: string | null;
        carryOverExpiryMonths: number | null;
        assignments: Assignment[];
      }
    >(`/leave-accrual-plans/${id}`).then(
      (p) => {
        setForm({
          leaveTypeId: p.leaveTypeId,
          name: p.name,
          frequency: p.frequency,
          daysPerPeriod: String(Number(p.daysPerPeriod)),
          startAfterMonths: p.startAfterMonths,
          maxBalance: p.maxBalance ? String(Number(p.maxBalance)) : "",
          carryOver: p.carryOver,
          carryOverMax: p.carryOverMax ? String(Number(p.carryOverMax)) : "",
          carryOverExpiryMonths: p.carryOverExpiryMonths ? String(p.carryOverExpiryMonths) : "",
          active: p.active,
        });
        setAssignments(p.assignments);
      },
      (e: Error) => setError(e.message),
    );
  }, [id, isNew, version]);

  useEffect(() => {
    if (isNew && form && !form.leaveTypeId) {
      const annual = types.find((t) => t.name === "Cuti tahunan");
      if (annual) setForm((f) => ({ ...f!, leaveTypeId: annual.id }));
    }
  }, [types, isNew, form]);

  if (!form) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f!, ...patch }));

  async function act(fn: () => Promise<string | void>) {
    setError(null);
    setNotice(null);
    try {
      const message = await fn();
      if (message) setNotice(message);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : String(e));
    }
  }
  const save = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      const saved = await api<{ id: string }>(isNew ? "/leave-accrual-plans" : `/leave-accrual-plans/${id}`, {
        method: isNew ? "POST" : "PUT",
        body: {
          ...form,
          maxBalance: form.maxBalance || null,
          carryOverMax: form.carryOverMax || null,
          carryOverExpiryMonths: form.carryOverExpiryMonths ? Number(form.carryOverExpiryMonths) : null,
        },
      });
      if (isNew) router.replace(`/hr/leave-plans/${saved.id}`);
      return l("Tersimpan.", "Saved.");
    });
  };
  const doAssign = () =>
    act(async () => {
      const r = await api<{ assigned: number }>(`/leave-accrual-plans/${id}/assign`, {
        method: "POST",
        body: {
          dateFrom: assign.dateFrom,
          ...(assign.mode === "department" ? { departmentId: assign.departmentId || null } : {}),
          ...(assign.mode === "employee" ? { employeeIds: [assign.employeeId] } : {}),
        },
      });
      return l(`${r.assigned} karyawan ditugaskan.`, `${r.assigned} employees assigned.`);
    });
  const run = () =>
    act(async () => {
      const r = await api<{ created: number; capped: number }>(`/leave-accrual-plans/${id}/run`, {
        method: "POST",
      });
      return l(`${r.created} jatah akrual dibuat.`, `${r.created} accrual allocations created.`);
    });
  const year = new Date().getFullYear() - 1;
  const carry = () =>
    act(async () => {
      const r = await api<{ created: number; days: string }>(
        `/leave-accrual-plans/${id}/carry-over?year=${year}`,
        {
          method: "POST",
        },
      );
      return l(
        `${r.created} karyawan membawa total ${Number(r.days)} hari dari ${year}.`,
        `${r.created} employees carried ${Number(r.days)} days from ${year}.`,
      );
    });

  return (
    <div className="stack-wide">
      <form className="panel" onSubmit={save}>
        <header className="toolbar">
          <h1>{isNew ? l("Rencana akrual baru", "New accrual plan") : form.name}</h1>
          {manage && (
            <>
              <button type="submit" className="primary">
                {l("Simpan", "Save")}
              </button>
              {!isNew && (
                <button
                  type="button"
                  className="link"
                  onClick={async () =>
                    (await ask(
                      l(
                        "Hapus rencana ini? Jatah yang sudah dibuat tetap ada.",
                        "Delete this plan? Created allocations remain.",
                      ),
                    )) &&
                    act(async () => {
                      await api(`/leave-accrual-plans/${id}`, { method: "DELETE" });
                      router.push("/hr/leave-plans");
                    })
                  }
                >
                  {l("Hapus", "Delete")}
                </button>
              )}
            </>
          )}
        </header>
        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        <fieldset disabled={!manage} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="grid-2">
            <label className="field">
              <span>{l("Nama", "Name")} *</span>
              <input value={form.name} onChange={(e) => set({ name: e.target.value })} required />
            </label>
            <label className="field">
              <span>{l("Jenis cuti", "Time off type")} *</span>
              <select
                value={form.leaveTypeId}
                onChange={(e) => set({ leaveTypeId: e.target.value })}
                required
              >
                <option value="">—</option>
                {types
                  .filter((t) => t.requiresAllocation)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Bertambah", "Accrues")}</span>
              <select
                value={form.frequency}
                onChange={(e) => set({ frequency: e.target.value as Form["frequency"] })}
              >
                <option value="yearly">{l("Per tahun", "Yearly")}</option>
                <option value="monthly">{l("Per bulan", "Monthly")}</option>
              </select>
            </label>
            <label className="field">
              <span>{l("Hari per periode", "Days per period")} *</span>
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={form.daysPerPeriod}
                onChange={(e) => set({ daysPerPeriod: e.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>{l("Mulai setelah masa kerja (bulan)", "Starts after service (months)")}</span>
              <input
                type="number"
                min="0"
                value={form.startAfterMonths}
                onChange={(e) => set({ startAfterMonths: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>{l("Saldo maksimum (kosong = tanpa batas)", "Maximum balance (empty = none)")}</span>
              <input
                type="number"
                min="0"
                value={form.maxBalance}
                onChange={(e) => set({ maxBalance: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("Sisa akhir tahun", "Year-end balance")}</span>
              <select
                value={form.carryOver}
                onChange={(e) => set({ carryOver: e.target.value as Form["carryOver"] })}
              >
                <option value="none">{l("Hangus", "Lost")}</option>
                <option value="all">{l("Dibawa semua", "Carry all")}</option>
                <option value="limited">{l("Dibawa maksimal …", "Carry up to …")}</option>
              </select>
            </label>
            {form.carryOver === "limited" && (
              <label className="field">
                <span>{l("Maksimal hari dibawa", "Max days carried")}</span>
                <input
                  type="number"
                  min="0"
                  value={form.carryOverMax}
                  onChange={(e) => set({ carryOverMax: e.target.value })}
                  required
                />
              </label>
            )}
            {form.carryOver !== "none" && (
              <label className="field">
                <span>
                  {l(
                    "Sisa dibawa berlaku (bulan, kosong = setahun)",
                    "Carried days valid for (months, empty = year)",
                  )}
                </span>
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={form.carryOverExpiryMonths}
                  onChange={(e) => set({ carryOverExpiryMonths: e.target.value })}
                />
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set({ active: e.target.checked })}
              />
              {l("Aktif (dijalankan otomatis)", "Active (runs automatically)")}
            </label>
          </div>
        </fieldset>
      </form>

      {!isNew && (
        <section className="panel">
          <header className="toolbar">
            <h2>{l("Karyawan", "Employees")}</h2>
            {manage && (
              <>
                <button type="button" onClick={run}>
                  {l("Jalankan akrual sekarang", "Run accrual now")}
                </button>
                {form.carryOver !== "none" && (
                  <button type="button" onClick={carry}>
                    {l(`Bawa sisa ${year}`, `Carry over ${year}`)}
                  </button>
                )}
              </>
            )}
          </header>
          {manage && (
            <div className="inline-panel">
              <label className="field">
                <span>{l("Tugaskan ke", "Assign to")}</span>
                <select
                  value={assign.mode}
                  onChange={(e) => setAssign((a) => ({ ...a, mode: e.target.value }))}
                >
                  <option value="all">{l("Semua karyawan aktif", "All active employees")}</option>
                  <option value="department">{l("Satu departemen", "One department")}</option>
                  <option value="employee">{l("Satu karyawan", "One employee")}</option>
                </select>
              </label>
              {assign.mode === "department" && (
                <label className="field">
                  <span>{l("Departemen", "Department")}</span>
                  <RefSelect
                    name="departmentId"
                    resource="departments"
                    display="name"
                    value={assign.departmentId}
                    onChange={(v) => setAssign((a) => ({ ...a, departmentId: v }))}
                  />
                </label>
              )}
              {assign.mode === "employee" && (
                <label className="field">
                  <span>{l("Karyawan", "Employee")}</span>
                  <RefSelect
                    name="employeeId"
                    resource="employees"
                    display="name"
                    value={assign.employeeId}
                    onChange={(v) => setAssign((a) => ({ ...a, employeeId: v }))}
                  />
                </label>
              )}
              <label className="field">
                <span>{l("Berlaku sejak", "Effective from")}</span>
                <input
                  type="date"
                  value={assign.dateFrom}
                  onChange={(e) => setAssign((a) => ({ ...a, dateFrom: e.target.value }))}
                />
              </label>
              <button type="button" className="primary" onClick={doAssign}>
                {l("Tugaskan", "Assign")}
              </button>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Karyawan", "Employee")}</th>
                  <th>{l("Tanggal masuk", "Join date")}</th>
                  <th>{l("Berlaku sejak", "Effective from")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.employeeId}>
                    <td>
                      {a.employeeName} <span className="muted">{a.employeeNumber}</span>
                    </td>
                    <td>{formatDate(a.joinDate, locale)}</td>
                    <td>{formatDate(a.dateFrom, locale)}</td>
                    <td>
                      {manage && (
                        <button
                          type="button"
                          className="link"
                          onClick={() =>
                            act(async () => {
                              await api(`/leave-accrual-plans/${id}/assignments/${a.employeeId}`, {
                                method: "DELETE",
                              });
                            })
                          }
                        >
                          {l("Lepas", "Remove")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {assignments.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      {l("Belum ada karyawan.", "No employees yet.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
