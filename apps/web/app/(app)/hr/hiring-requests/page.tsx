"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { errorText } from "../../../../components/hr/hr-panels";
import {
  HIRING_STATE_LABEL,
  hiringStatePill,
  type HiringState as State,
} from "../../../../components/hr/hiring";
import { RefSelect } from "../../../../components/ref-select";
import { api, ApiError } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface Row {
  id: string;
  number: string | null;
  department: string;
  job: string;
  kind: "new" | "replacement";
  quantity: number;
  unplanned: boolean;
  state: State;
  targetDate: string | null;
  openingId: string | null;
  candidates: number;
  active: number;
}

const empty = {
  departmentId: "",
  jobId: "",
  gradeId: "",
  kind: "new",
  quantity: "1",
  contractType: "pkwt",
  wageMin: "",
  wageMax: "",
  targetDate: "",
  reason: "",
  replacesEmployeeId: "",
};

/**
 * Usulan Penambahan Karyawan (FPK): dari baris MPP yang disetujui (tombol "Ajukan FPK" di MPP) atau di luar rencana
 * (formulir di sini, ditandai & memakai kategori persetujuan "FPK di luar MPP").
 */
export default function HiringRequestsPage() {
  return (
    <Suspense>
      <HiringRequests />
    </Suspense>
  );
}

function HiringRequests() {
  const { l, locale } = useI18n();
  const router = useRouter();
  const lineId = useSearchParams().get("lineId");
  const [d, setD] = useState<{ canManage: boolean; items: Row[] } | null>(null);
  const [form, setForm] = useState<typeof empty | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams();
    if (lineId) q.set("lineId", lineId);
    api<{ canManage: boolean; items: Row[] }>(`/hiring-requests?${q}`).then(setD, (e) =>
      setError(errorText(e)),
    );
  }, [lineId]);
  const columns = useMemo<ViewColumn<Row>[]>(
    () => [
      { key: "number", label: l("Nomor", "Number"), value: (r) => r.number },
      {
        key: "position",
        label: l("Posisi", "Position"),
        value: (r) => `${r.job} – ${r.department}`,
      },
      {
        key: "department",
        label: l("Departemen", "Department"),
        type: "enum",
        value: (r) => r.department,
        hidden: true,
      },
      {
        key: "kind",
        label: l("Jenis", "Kind"),
        type: "enum",
        value: (r) => r.kind,
        optionLabel: (v) => (v === "replacement" ? l("Pengganti", "Replacement") : l("Tambahan", "New")),
        hidden: true,
      },
      { key: "quantity", label: l("Jumlah", "Qty"), type: "number", value: (r) => r.quantity },
      {
        key: "unplanned",
        label: l("Asal", "Source"),
        type: "enum",
        value: (r) => (r.unplanned ? "1" : "0"),
        optionLabel: (v) => (v === "1" ? l("Di luar MPP", "Unplanned") : "MPP"),
      },
      {
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (r) => r.state,
        optionLabel: (v) => (HIRING_STATE_LABEL[v as State] ? l(...HIRING_STATE_LABEL[v as State]) : v),
      },
      { key: "targetDate", label: l("Target", "Target"), type: "date", value: (r) => r.targetDate },
      { key: "active", label: l("Karyawan aktif", "Active hires"), type: "number", value: (r) => r.active },
    ],
    [l],
  );
  const table = useTableView(d?.items ?? [], columns, { storageKey: "hiring-requests" });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const row = await api<{ id: string }>("/hiring-requests", {
        method: "POST",
        body: {
          departmentId: form.departmentId,
          jobId: form.jobId,
          gradeId: form.gradeId || null,
          kind: form.kind,
          quantity: Number(form.quantity),
          contractType: form.contractType,
          wageMin: form.wageMin || null,
          wageMax: form.wageMax || null,
          targetDate: form.targetDate || null,
          reason: form.reason,
          replacesEmployeeId: form.kind === "replacement" ? form.replacesEmployeeId || null : null,
        },
      });
      router.push(`/hr/hiring-requests/${row.id}`);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorText(err));
      setBusy(false);
    }
  };
  const set = (k: keyof typeof empty) => (v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const fe = (k: string) => errors[k] && <small className="error">{errors[k]}</small>;

  return (
    <div className="stack-wide">
      <section className="panel">
        <header className="toolbar">
          <h1>{l("Usulan Penambahan Karyawan (FPK)", "Hiring Requests")}</h1>
          {!form && (
            <button type="button" onClick={() => setForm(empty)}>
              {l("FPK di luar MPP", "Unplanned request")}
            </button>
          )}
          <Link href="/hr/manpower-plans" className="button">
            Man Power Planning
          </Link>
        </header>
        <p className="muted">
          {l(
            'Alur: MPP disetujui → FPK (dari baris MPP, atau di luar MPP dengan persetujuan tambahan) → persetujuan → lowongan → pelamar → penawaran diterima → kontrak → karyawan aktif → onboarding. Ajukan FPK dari baris MPP lewat tombol "Ajukan FPK" di halaman MPP.',
            'Flow: approved manpower plan → hiring request (from a plan line, or unplanned with extra approval) → approval → job opening → applicants → accepted offer → contract → active employee → onboarding. Request from a plan line with "Request hire" on the plan page.',
          )}
        </p>
        {lineId && (
          <p>
            <span className="pill">{l("Difilter per baris MPP", "Filtered by plan line")}</span>{" "}
            <Link href="/hr/hiring-requests">{l("Tampilkan semua", "Show all")}</Link>
          </p>
        )}
        {error && <p className="error">{error}</p>}
        {form && (
          <form className="inline-panel" onSubmit={save}>
            <p>
              <span className="pill warn">{l("Di luar MPP", "Unplanned")}</span>{" "}
              {l(
                'Penambahan di luar rencana memakai kategori persetujuan "FPK di luar MPP".',
                'Unplanned hires use the "FPK di luar MPP" approval category.',
              )}
            </p>
            <label className="field">
              <span>{l("Departemen", "Department")}</span>
              <RefSelect
                name="departmentId"
                resource="departments"
                display="name"
                required
                value={form.departmentId}
                onChange={set("departmentId")}
              />
              {fe("departmentId")}
            </label>
            <label className="field">
              <span>{l("Jabatan", "Job position")}</span>
              <RefSelect
                name="jobId"
                resource="job-positions"
                display="name"
                required
                value={form.jobId}
                onChange={set("jobId")}
              />
              {fe("jobId")}
            </label>
            <label className="field">
              <span>{l("Golongan", "Grade")}</span>
              <RefSelect
                name="gradeId"
                resource="salary-grades"
                display="name"
                value={form.gradeId}
                onChange={set("gradeId")}
              />
            </label>
            <label className="field">
              <span>{l("Jenis", "Type")}</span>
              <select value={form.kind} onChange={(e) => set("kind")(e.target.value)}>
                <option value="new">{l("Tambahan", "New position")}</option>
                <option value="replacement">{l("Pengganti", "Replacement")}</option>
              </select>
            </label>
            {form.kind === "replacement" && (
              <label className="field">
                <span>{l("Menggantikan", "Replaces")}</span>
                <RefSelect
                  name="replacesEmployeeId"
                  resource="employees"
                  display="name"
                  value={form.replacesEmployeeId}
                  onChange={set("replacesEmployeeId")}
                />
                {fe("replacesEmployeeId")}
              </label>
            )}
            <label className="field">
              <span>{l("Jumlah orang", "Headcount")}</span>
              <input
                className="num"
                type="number"
                min="1"
                required
                value={form.quantity}
                onChange={(e) => set("quantity")(e.target.value)}
              />
              {fe("quantity")}
            </label>
            <label className="field">
              <span>{l("Jenis kontrak", "Contract type")}</span>
              <select value={form.contractType} onChange={(e) => set("contractType")(e.target.value)}>
                <option value="pkwt">PKWT</option>
                <option value="pkwtt">PKWTT</option>
              </select>
            </label>
            <label className="field">
              <span>{l("Gaji min.", "Min. wage")}</span>
              <input
                className="num"
                inputMode="decimal"
                value={form.wageMin}
                onChange={(e) => set("wageMin")(e.target.value)}
              />
            </label>
            <label className="field">
              <span>{l("Gaji maks.", "Max. wage")}</span>
              <input
                className="num"
                inputMode="decimal"
                value={form.wageMax}
                onChange={(e) => set("wageMax")(e.target.value)}
              />
              {fe("wageMax")}
            </label>
            <label className="field">
              <span>{l("Target mulai", "Target start")}</span>
              <input
                type="date"
                value={form.targetDate}
                onChange={(e) => set("targetDate")(e.target.value)}
              />
            </label>
            <label className="field wide">
              <span>{l("Alasan kebutuhan", "Reason")}</span>
              <input
                required
                maxLength={1000}
                value={form.reason}
                onChange={(e) => set("reason")(e.target.value)}
              />
              {fe("reason")}
            </label>
            <button className="primary" disabled={busy}>
              {l("Simpan draft", "Save draft")}
            </button>
            <button type="button" onClick={() => setForm(null)}>
              {l("Batal", "Cancel")}
            </button>
          </form>
        )}
      </section>
      {d && (
        <section className="panel">
          <TableTools
            view={table}
            placeholder={l("Cari nomor, jabatan, departemen…", "Search number, position, department…")}
          />
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortTh view={table} col="number">
                    {l("Nomor", "Number")}
                  </SortTh>
                  <SortTh view={table} col="position">
                    {l("Posisi", "Position")}
                  </SortTh>
                  <SortTh view={table} col="quantity" className="num">
                    {l("Jumlah", "Qty")}
                  </SortTh>
                  <SortTh view={table} col="unplanned">
                    {l("Asal", "Source")}
                  </SortTh>
                  <SortTh view={table} col="state">
                    {l("Status", "Status")}
                  </SortTh>
                  <SortTh view={table} col="targetDate">
                    {l("Target", "Target")}
                  </SortTh>
                  <SortTh view={table} col="active" className="num">
                    {l("Karyawan aktif", "Active hires")}
                  </SortTh>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/hr/hiring-requests/${r.id}`}>{r.number ?? l("(draft)", "(draft)")}</Link>
                    </td>
                    <td>
                      {r.job} – {r.department}
                      {r.kind === "replacement" && (
                        <span className="muted"> ({l("pengganti", "replacement")})</span>
                      )}
                    </td>
                    <td className="num">{r.quantity}</td>
                    <td>
                      {r.unplanned ? (
                        <span className="pill warn">{l("Di luar MPP", "Unplanned")}</span>
                      ) : (
                        <span className="pill">MPP</span>
                      )}
                    </td>
                    <td>
                      <span className={`pill ${hiringStatePill(r.state)}`}>
                        {l(...HIRING_STATE_LABEL[r.state])}
                      </span>
                    </td>
                    <td>{r.targetDate ? formatDate(r.targetDate, locale) : "—"}</td>
                    <td className="num">
                      {r.openingId ? (
                        <Link href={`/hr/recruitment?openingId=${r.openingId}`}>
                          {r.active} / {r.quantity}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
                {!table.rows.length && (
                  <tr>
                    <td colSpan={7} className="muted">
                      {d.items.length
                        ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                        : l("Belum ada FPK.", "No hiring requests yet.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <TablePager view={table} />
        </section>
      )}
    </div>
  );
}
