"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { ContractComponentsEditor } from "../../../../../components/hr/contract-components";
import { ContractDocumentPanel } from "../../../../../components/hr/contract-document";
import { ProbationPanel } from "../../../../../components/hr/probation-panel";
import { ContractTypeOptions } from "../../../../../components/hr/contract-type-options";
import { RESIGN_REASON_LABEL } from "../../../../../components/hr/offboarding-panel";
import { RefSelect } from "../../../../../components/ref-select";
import { api, ApiError } from "../../../../../lib/api";
import { addDays } from "@erp/shared";
import { formatDate, today } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { CONTRACT_STATE_LABEL, can } from "../../../../../lib/resources";
import { useMe } from "../../../../../components/me-context";
import { GradeWageHint, useEffectiveGrade, useGradeAutofill } from "../../../../../components/hr/grade-wage";
import { useContractTypes } from "../../../../../lib/use-contract-types";
import { ask } from "../../../../../components/feedback";

interface Contract {
  id: string;
  name: string;
  employeeId: string;
  employeeName: string;
  contractType: string;
  dateStart: string;
  dateEnd: string | null;
  wage: string;
  wageType: "monthly" | "daily" | "piece";
  taxMethod: "gross" | "gross_up";
  state: string;
  signState: "unsigned" | "pending" | "partial" | "signed";
  endReason: string | null;
  endNote: string | null;
  isFirst: boolean;
  isLast: boolean;
  employee: { joinDate: string; resignDate: string | null; resignReason: string | null } | null;
  note: string | null;
  allowances: { componentId: string; amount: string; name: string; kind: string; fixed: boolean }[];
  probationMonths: number | null;
  probationEnd: string | null;
  probationResult: "passed" | "failed" | null;
  probationNote: string | null;
  grade: {
    id: string;
    code: string;
    name: string;
    minWage: string | null;
    maxWage: string | null;
    baseWage: string | null;
    position: "below" | "within" | "above" | null;
    adjusted: boolean;
  } | null;
}

interface EmployeeDates {
  joinDate: string;
  resignDate: string | null;
  gradeId: string | null;
  jobId: string | null;
}

/**
 * Tanggal bawaan kontrak baru mengikuti masa kerja: kontrak pertama mulai di tanggal masuk karyawan, kontrak
 * berikutnya sehari setelah kontrak terakhir berakhir; berakhir paling lambat di tanggal keluar.
 */
function defaultDates(
  e: EmployeeDates,
  contracts: { dateStart: string; dateEnd: string | null; state: string }[],
) {
  const ends = contracts
    .filter((c) => c.state !== "cancel" && c.dateEnd)
    .map((c) => c.dateEnd!)
    .sort();
  const after = ends.length ? addDays(ends[ends.length - 1]!, 1) : e.joinDate;
  return { dateStart: after > e.joinDate ? after : e.joinDate, dateEnd: e.resignDate ?? "" };
}

/** Kontrak kerja: PKWT/PKWTT, gaji pokok, tunjangan & potongan bulanan. */
export default function ContractPage() {
  return (
    <Suspense>
      <Contract />
    </Suspense>
  );
}

function Contract() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const presetEmployee = params.get("employeeId") ?? "";
  const justCreated = params.get("created") === "1";
  const router = useRouter();
  const { l, tx, locale } = useI18n();
  const me = useMe();
  const types = useContractTypes();
  const isNew = id === "new";
  const [contract, setContract] = useState<Contract | null>(null);
  const [form, setForm] = useState({
    employeeId: presetEmployee,
    contractType: "pkwtt",
    dateStart: today(),
    dateEnd: "",
    wage: "",
    wageType: "monthly",
    taxMethod: "gross",
    note: "",
  });
  const [allowances, setAllowances] = useState<{ componentId: string; amount: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);

  // Kontrak baru: tanggal mulai/berakhir mengikuti tanggal masuk/keluar karyawan terpilih.
  const [employeeDates, setEmployeeDates] = useState<EmployeeDates | null>(null);
  useEffect(() => {
    if (!isNew || !form.employeeId) {
      setEmployeeDates(null);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const e = await api<EmployeeDates>(`/employees/${form.employeeId}`);
        const list = await api<{ items: { dateStart: string; dateEnd: string | null; state: string }[] }>(
          `/contracts?employeeId=${form.employeeId}`,
        ).then(
          (r) => r.items,
          () => [],
        );
        if (!live) return;
        setEmployeeDates(e);
        setForm((f) => ({ ...f, ...defaultDates(e, list) }));
      } catch {
        if (live) setEmployeeDates(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [isNew, form.employeeId]);

  useEffect(() => {
    if (isNew) return;
    api<Contract>(`/contracts/${id}`)
      .then((c) => {
        setContract(c);
        setForm({
          employeeId: c.employeeId,
          contractType: c.contractType,
          dateStart: c.dateStart,
          dateEnd: c.dateEnd ?? "",
          wage: String(Number(c.wage)),
          wageType: c.wageType,
          taxMethod: c.taxMethod,
          note: c.note ?? "",
        });
        setAllowances(
          c.allowances.map((a) => ({ componentId: a.componentId, amount: String(Number(a.amount)) })),
        );
      })
      .catch((e: Error) => setError(e.message));
  }, [id, isNew, version]);

  // Gaji pokok standar golongan: kontrak baru terisi otomatis, kontrak lama menampilkan penanda & tombol Pakai standar.
  const grade = useEffectiveGrade(
    isNew ? employeeDates?.gradeId : contract?.grade?.id,
    isNew ? employeeDates?.jobId : null,
  );
  useGradeAutofill(isNew ? grade : null, form.wage, form.wageType, (wage) =>
    setForm((f) => ({ ...f, wage })),
  );

  // Kontrak yang sudah ditandatangani terkunci; batalkan tanda tangan di panel dokumen untuk mengubahnya.
  const signed = contract?.signState === "partial" || contract?.signState === "signed";
  const editable = isNew || ((contract?.state === "draft" || contract?.state === "running") && !signed);
  // Satu jalur perubahan upah: upah kontrak berjalan diubah lewat SK (Promosi & Mutasi) atau Kenaikan Gaji.
  const wageLocked = contract?.state === "running";
  async function run(fn: () => Promise<void>) {
    setError(null);
    setFieldErrors({});
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
    }
  }
  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const body = {
        ...form,
        dateEnd: form.dateEnd || null,
        note: form.note || null,
        allowances: allowances
          .filter((a) => a.componentId)
          .map((a) => ({ componentId: a.componentId, amount: a.amount.trim() || "0" })),
      };
      if (isNew) {
        const c = await api<Contract>("/contracts", { method: "POST", body });
        router.replace(`/hr/contracts/${c.id}`);
      } else {
        await api(`/contracts/${id}`, { method: "PUT", body });
        setVersion((v) => v + 1);
      }
    });
  };
  const [started, setStarted] = useState(false);
  const action = (path: string) =>
    run(async () => {
      await api(`/contracts/${id}/${path}`, { method: "POST", body: {} });
      if (path === "start") setStarted(true);
      setVersion((v) => v + 1);
    });
  const err = (p: string) => fieldErrors[p] && <small className="error">{fieldErrors[p]}</small>;

  // Akhiri kontrak: tanggal berakhir, dan bila karyawan keluar → tanggal ini menjadi tanggal keluar karyawan.
  const [retirement, setRetirement] = useState<{ age: number; date: string | null } | null>(null);
  useEffect(() => {
    if (!contract?.employeeId) return;
    api<{ age: number; date: string | null }>(`/employees/${contract.employeeId}/retirement`).then(
      setRetirement,
      () => setRetirement(null),
    );
  }, [contract?.employeeId]);
  const [ending, setEnding] = useState<{
    dateEnd: string;
    exit: boolean;
    resignReason: string;
    resignNote: string;
    startChecklist: boolean;
  } | null>(null);
  const openEnd = (exit: boolean) => {
    if (!contract) return;
    setEnding({
      dateEnd: contract.dateEnd ?? today(),
      exit,
      resignReason:
        contract.endReason ?? (types.fixedTerm(contract.contractType) ? "end_contract" : "resign"),
      resignNote: contract.endNote ?? "",
      startChecklist: !contract.employee?.resignDate,
    });
    setTimeout(() => document.getElementById("end-contract")?.scrollIntoView({ block: "center" }), 0);
  };
  const submitEnd = () =>
    run(async () => {
      if (!ending) return;
      await api(`/contracts/${id}/close`, {
        method: "POST",
        body: {
          dateEnd: ending.dateEnd,
          exit: ending.exit,
          resignReason: ending.exit ? ending.resignReason : null,
          resignNote: ending.exit ? ending.resignNote || null : null,
          startChecklist: ending.startChecklist,
        },
      });
      setEnding(null);
      setVersion((v) => v + 1);
    });

  if (!isNew && !contract) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;

  return (
    <div className="stack-wide">
      {contract?.endReason && (
        <section className="panel exit-banner">
          <p>
            <span className="pill bad">{l("Karyawan keluar", "Employee left")}</span>{" "}
            <strong>{formatDate(contract.dateEnd, locale)}</strong> —{" "}
            {l(...(RESIGN_REASON_LABEL[contract.endReason] ?? ["", ""]))}
            {contract.endNote ? ` · ${contract.endNote}` : ""}
          </p>
          <div className="row-actions">
            <button type="button" onClick={() => openEnd(true)}>
              {l("Ubah data keluar", "Edit leaving details")}
            </button>
            <button
              type="button"
              className="danger"
              onClick={async () =>
                (await ask(
                  l(
                    "Batalkan keluar? Kontrak kembali berjalan dan tanggal keluar karyawan dihapus.",
                    "Cancel the leaving? The contract runs again and the employee's leaving date is cleared.",
                  ),
                )) && action("cancel-exit")
              }
            >
              {l("Batalkan keluar", "Cancel leaving")}
            </button>
            <Link href={`/employees/${contract.employeeId}`}>
              {l("Offboarding & Full and Final", "Offboarding & Full and Final")}
            </Link>
          </div>
        </section>
      )}
      {ending && contract && (
        <section className="panel" id="end-contract">
          <h2>
            {contract.endReason
              ? l("Ubah data keluar", "Edit leaving details")
              : l("Akhiri kontrak", "End contract")}
          </h2>
          <div className="fields">
            <label className="field">
              <span>
                {ending.exit
                  ? l("Tanggal keluar *", "Leaving date *")
                  : l("Tanggal berakhir *", "End date *")}
              </span>
              <input
                type="date"
                required
                min={contract.dateStart}
                value={ending.dateEnd}
                onChange={(e) => setEnding({ ...ending, dateEnd: e.target.value })}
              />
              {err("dateEnd")}
              {retirement?.date && contract.isLast && (
                <button
                  type="button"
                  className="link small"
                  onClick={() =>
                    setEnding({
                      ...ending,
                      dateEnd: retirement.date!,
                      exit: true,
                      resignReason: "retirement",
                    })
                  }
                >
                  {l(
                    `Pensiun: ${formatDate(retirement.date, locale)} (usia ${retirement.age} tahun)`,
                    `Retirement: ${formatDate(retirement.date, locale)} (age ${retirement.age})`,
                  )}
                </button>
              )}
            </label>
            {contract.isLast && !contract.endReason && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={ending.exit}
                  onChange={(e) => setEnding({ ...ending, exit: e.target.checked })}
                />
                <span>
                  {l(
                    "Karyawan keluar (tanggal ini menjadi tanggal keluar karyawan)",
                    "Employee leaves (this date becomes the employee's leaving date)",
                  )}
                </span>
              </label>
            )}
            {ending.exit && (
              <>
                <label className="field">
                  <span>{l("Alasan keluar *", "Leaving reason *")}</span>
                  <select
                    value={ending.resignReason}
                    onChange={(e) => setEnding({ ...ending, resignReason: e.target.value })}
                  >
                    {Object.entries(RESIGN_REASON_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {l(...v)}
                      </option>
                    ))}
                  </select>
                  {err("resignReason")}
                </label>
                <label className="field">
                  <span>{l("Catatan", "Note")}</span>
                  <input
                    maxLength={1000}
                    value={ending.resignNote}
                    onChange={(e) => setEnding({ ...ending, resignNote: e.target.value })}
                  />
                </label>
                {!contract.employee?.resignDate && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={ending.startChecklist}
                      onChange={(e) => setEnding({ ...ending, startChecklist: e.target.checked })}
                    />
                    <span>{l("Mulai checklist offboarding", "Start offboarding checklist")}</span>
                  </label>
                )}
              </>
            )}
          </div>
          {error && <p className="error">{error}</p>}
          {!ending.exit && (
            <p className="muted small">
              {l(
                'Tanpa "karyawan keluar", kontrak hanya selesai (mis. akan diganti kontrak baru); karyawan tetap tercatat aktif.',
                'Without "employee leaves", the contract just ends (e.g. to be replaced by a new one); the employee stays active.',
              )}
            </p>
          )}
          <div className="row-actions">
            <button type="button" className={ending.exit ? "danger" : "primary"} onClick={submitEnd}>
              {ending.exit
                ? l("Simpan & proses keluar", "Save & process leaving")
                : l("Akhiri kontrak", "End contract")}
            </button>
            <button type="button" onClick={() => setEnding(null)}>
              {l("Batal", "Cancel")}
            </button>
          </div>
        </section>
      )}
      <form className="panel" onSubmit={save}>
        <header className="toolbar">
          <h1>
            {contract ? `${contract.name} — ${contract.employeeName}` : l("Kontrak baru", "New contract")}
          </h1>
          {contract && (
            <span className={`badge state-${contract.state === "running" ? "sale" : contract.state}`}>
              {tx(CONTRACT_STATE_LABEL[contract.state]!)}
            </span>
          )}
          {editable && <button className="primary">{l("Simpan", "Save")}</button>}
          {contract?.state === "draft" && (
            <button type="button" className="primary" onClick={() => action("start")}>
              {l("Mulai berlaku", "Start")}
            </button>
          )}
          {contract?.state === "running" && (
            <button type="button" className="danger" onClick={() => openEnd(contract.isLast)}>
              {l("Akhiri kontrak", "End contract")}
            </button>
          )}
          {contract?.state === "closed" &&
            !contract.endReason &&
            contract.isLast &&
            !contract.employee?.resignDate && (
              <button type="button" onClick={() => openEnd(true)}>
                {l("Tandai karyawan keluar", "Mark employee as left")}
              </button>
            )}
        </header>
        {error && <p className="error">{error}</p>}
        {isNew && !presetEmployee && (
          <p className="muted">
            {l(
              "Kontrak pertama karyawan dibuat dari form karyawan baru. Halaman ini untuk perpanjangan/kontrak baru karyawan yang sudah ada.",
              "An employee's first contract is created from the new-employee form. This page is for renewals or new contracts of existing employees.",
            )}
          </p>
        )}
        {justCreated && contract && (
          <p className="success">
            {l(
              "Karyawan & kontrak tersimpan; kontrak langsung berlaku. Cetak atau tandatangani dokumennya di bawah.",
              "Employee & contract saved; the contract is in effect. Print or sign the document below.",
            )}{" "}
            <Link href={`/employees/${contract.employeeId}`}>{l("Buka karyawan", "Open employee")}</Link>
          </p>
        )}
        {signed && (
          <p className="muted">
            {l(
              "Kontrak sudah ditandatangani sehingga syaratnya terkunci. Untuk perubahan, batalkan tanda tangan di panel dokumen atau buat kontrak baru.",
              "The contract is signed, so its terms are locked. To change them, revoke the signatures in the document panel or create a new contract.",
            )}
          </p>
        )}
        {started && contract && (
          <p className="success">
            {l(
              "Kontrak dimulai. Calon karyawan dari rekrutmen kini aktif (masuk payroll) dan onboarding dimulai.",
              "Contract started. A pre-hire from recruitment is now active (included in payroll) and onboarding has started.",
            )}{" "}
            <Link href={`/employees/${contract.employeeId}`}>{l("Buka karyawan", "Open employee")}</Link>
            {" · "}
            <Link href="/hr/checklists">{l("Checklist onboarding", "Onboarding checklists")}</Link>
          </p>
        )}
        <fieldset className="fields" disabled={!editable}>
          <label className="field">
            <span>{l("Karyawan *", "Employee *")}</span>
            <RefSelect
              name="employeeId"
              resource="employees"
              display="name"
              required
              disabled={!isNew}
              value={form.employeeId}
              onChange={(v) => setForm((f) => ({ ...f, employeeId: v }))}
            />
            {err("employeeId")}
          </label>
          <label className="field">
            <span>{l("Jenis kontrak", "Contract type")}</span>
            <select
              value={form.contractType}
              onChange={(e) => setForm((f) => ({ ...f, contractType: e.target.value }))}
            >
              <ContractTypeOptions types={types} current={contract?.contractType ?? form.contractType} />
            </select>
            {types.find(form.contractType)?.legalBasis && (
              <small className="muted">{types.find(form.contractType)!.legalBasis}</small>
            )}
            {err("contractType")}
          </label>
          <label className="field">
            <span>{l("Mulai *", "Start *")}</span>
            <input
              type="date"
              required
              value={form.dateStart}
              max={employeeDates?.resignDate ?? undefined}
              onChange={(e) => setForm((f) => ({ ...f, dateStart: e.target.value }))}
            />
            {err("dateStart")}
            {contract?.isFirst && (
              <small className="muted">
                {l(
                  "Kontrak pertama: tanggal mulai = tanggal masuk karyawan.",
                  "First contract: the start date is the employee's join date.",
                )}
              </small>
            )}
            {employeeDates && (
              <small className="muted">
                {l("Masa kerja karyawan: ", "Employment: ")}
                {formatDate(employeeDates.joinDate, locale)} –{" "}
                {employeeDates.resignDate
                  ? formatDate(employeeDates.resignDate, locale)
                  : l("sekarang", "present")}
              </small>
            )}
          </label>
          <label className="field">
            <span>
              {types.fixedTerm(form.contractType) ? l("Berakhir *", "End *") : l("Berakhir", "End")}
            </span>
            <input
              type="date"
              value={form.dateEnd}
              min={form.dateStart}
              max={employeeDates?.resignDate ?? undefined}
              onChange={(e) => setForm((f) => ({ ...f, dateEnd: e.target.value }))}
            />
            {err("dateEnd")}
          </label>
          <label className="field">
            <span>{l("Jenis upah", "Wage type")}</span>
            <select
              value={form.wageType}
              disabled={wageLocked}
              onChange={(e) => setForm((f) => ({ ...f, wageType: e.target.value }))}
            >
              <option value="monthly">{l("Bulanan", "Monthly")}</option>
              <option value="daily">{l("Harian lepas (per hari hadir)", "Daily (per day present)")}</option>
              <option value="piece">
                {l("Borongan (per satuan hasil kerja)", "Piece rate (per unit of output)")}
              </option>
            </select>
          </label>
          <label className="field">
            <span>{l("Metode PPh 21", "PPh 21 method")}</span>
            <select
              value={form.taxMethod}
              onChange={(e) => setForm((f) => ({ ...f, taxMethod: e.target.value }))}
            >
              <option value="gross">{l("Gross — dipotong dari gaji", "Gross — withheld from pay")}</option>
              <option value="gross_up">
                {l("Gross-up — ditanggung perusahaan (tunjangan PPh 21)", "Gross-up — borne by the company")}
              </option>
            </select>
          </label>
          <label className="field">
            <span>
              {form.wageType === "daily"
                ? l("Upah per hari *", "Wage per day *")
                : form.wageType === "piece"
                  ? l("Upah per satuan *", "Rate per unit *")
                  : l("Gaji pokok / bulan *", "Base wage / month *")}
            </span>
            <input
              className={wageLocked ? "num locked" : "num"}
              inputMode="decimal"
              required
              readOnly={wageLocked}
              value={form.wage}
              onChange={(e) => setForm((f) => ({ ...f, wage: e.target.value }))}
            />
            {wageLocked && (
              <small className="muted">
                {l("Ubah upah kontrak berjalan lewat ", "Change a running contract's wage via ")}
                <Link href="/hr/movements">{l("SK Penyesuaian upah", "a wage adjustment decree")}</Link>
                {l(" atau ", " or ")}
                <Link href="/payroll/compensation">{l("Kenaikan Gaji", "Salary Review")}</Link>
                {l(
                  " agar tercatat dan berlaku per tanggal efektif.",
                  " so it is recorded and takes effect on a date.",
                )}
              </small>
            )}
            <GradeWageHint
              grade={grade}
              wage={form.wage}
              wageType={form.wageType}
              editable={editable && !wageLocked}
              onUseStandard={(wage) => setForm((f) => ({ ...f, wage }))}
            />
            {err("wage")}
          </label>
          <label className="field">
            <span>{l("Catatan", "Note")}</span>
            <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          </label>
        </fieldset>

        <h2>{l("Komponen gaji lain", "Other pay components")}</h2>
        <ContractComponentsEditor
          value={allowances}
          onChange={setAllowances}
          wage={form.wage}
          wageType={form.wageType}
          editable={editable}
          errors={fieldErrors}
        />
        {form.wageType === "monthly" ? null : (
          <p className="muted">
            {form.wageType === "daily"
              ? l(
                  "Upah dihitung dari jumlah hari hadir di absensi × upah per hari.",
                  "Pay = days present in attendance × daily wage.",
                )
              : l(
                  "Upah dihitung dari hasil kerja (menu Hasil Kerja Borongan) × upah per satuan.",
                  "Pay = recorded work entries (Piece Work menu) × rate per unit.",
                )}{" "}
            {l(
              "Sebelum masa kerja mencapai batas di pengaturan payroll, BPJS yang dibayar hanya JKK & JKM.",
              "Until the tenure threshold in payroll settings, only JKK & JKM are contributed.",
            )}
          </p>
        )}
      </form>
      {contract && (
        <ProbationPanel
          contract={contract}
          manage={can(me.permissions, "hr.manage")}
          onChange={() => setVersion((v) => v + 1)}
        />
      )}
      {contract && contract.state !== "cancel" && (
        <ContractDocumentPanel
          contractId={contract.id}
          contractType={contract.contractType}
          onChange={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}
