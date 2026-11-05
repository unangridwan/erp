"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { api, ApiError } from "../../lib/api";
import { formatDate, money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { can, findResource, type Field } from "../../lib/resources";
import { AuthImage, bumpImage } from "../auth-image";
import { Chatter } from "../chatter";
import { SeverancePanel } from "../form-extras";
import { FieldInput, toPayload } from "../form-view";
import { EmployeeVehiclesPanel } from "../fleet/fleet-panels";
import { useMe } from "../me-context";
import { BenefitEnrollments } from "../payroll/benefits-panel";
import { TotalRewardsPanel } from "../payroll/total-rewards";
import { NEW_CONTRACT, NewEmployeeContract, type NewContractValues } from "./contract-document";
import { FeedbackPanel, NotesPanel } from "./ess-panels";
import { CareerPanel, ChecklistsPanel, DocumentsPanel, errorText } from "./hr-panels";
import { OffboardingPanel, RESIGN_REASON_LABEL } from "./offboarding-panel";
import {
  EducationPanel,
  ExperiencePanel,
  FamilyPanel,
  MovementsPanel,
  resizePhoto,
  WarningsPanel,
} from "./profile-panels";
import { contractRuleText, useContractTypes } from "../../lib/use-contract-types";

type Values = Record<string, unknown>;

interface Overview {
  appraisals: number;
  openAppraisals: number;
  goals: number;
  hoursThisMonth: string;
  hasPhoto: boolean;
  contract: {
    id: string;
    name: string;
    contractType: string;
    wage: string;
    wageType: "monthly" | "daily" | "piece";
    taxMethod: "gross" | "gross_up";
    dateStart: string;
    dateEnd: string | null;
    fixedAllowance: string;
    components: {
      name: string;
      amount: string;
      fixed: boolean;
      kind: "allowance" | "deduction";
      calc: "fixed_amount" | "per_attendance_day" | "attendance_premium";
    }[];
  } | null;
  account:
    | { status: "linked"; userId: string; name: string; email: string }
    | { status: "invited"; email: string; expiresAt: string }
    | { status: "none" };
}

interface ProfileSummary {
  completeness: { percent: number; missing: string[] };
  suggestedPtkp: string;
  ptkpMismatch: boolean;
}

type Tab = "work" | "contract" | "personal" | "payroll" | "benefits" | "history" | "performance" | "settings";

const EMPLOYEES = findResource("employees")!;
const FIELDS = new Map(EMPLOYEES.fields.map((f) => [f.name, f]));
/** Field yang tampil di kepala form (bukan di tab). */
const HEAD_FIELDS = ["name", "workEmail", "workPhone", "personalPhone", "jobId"];

const GROUPS: Record<Tab, { title?: [string, string]; fields: string[] }[]> = {
  work: [
    {
      title: ["Posisi", "Position"],
      fields: ["departmentId", "jobId", "gradeId", "managerId"],
    },
    {
      title: ["Lokasi & jadwal", "Location & schedule"],
      fields: ["branchId", "businessUnitId", "workLocationId", "scheduleId"],
    },
  ],
  personal: [
    {
      title: ["Biodata", "Personal data"],
      fields: [
        "birthPlace",
        "birthDate",
        "gender",
        "religion",
        "maritalStatus",
        "bloodType",
        "rhesus",
        "nationality",
        "heightCm",
        "weightKg",
      ],
    },
    {
      title: ["Kontak pribadi", "Private contact"],
      fields: [
        "personalEmail",
        "personalPhone",
        "address",
        "domicileAddress",
        "emergencyContact",
        "emergencyPhone",
      ],
    },
    { title: ["Identitas", "Identity"], fields: ["nik", "kkNo"] },
    { title: ["Rekening bank", "Bank account"], fields: ["bankName", "bankAccount", "bankAccountName"] },
  ],
  payroll: [
    { title: ["Pajak", "Tax"], fields: ["ptkpStatus", "npwp"] },
    {
      title: ["BPJS Kesehatan", "BPJS Health"],
      fields: ["bpjsKesEnrolled", "bpjsKesNo", "bpjsKesDate", "bpjsKesClass", "bpjsKesFacility"],
    },
    {
      title: ["BPJS Ketenagakerjaan", "BPJS Employment"],
      fields: ["bpjsTkEnrolled", "bpjsTkNo", "bpjsTkDate", "bpjsJpEnrolled"],
    },
    { title: ["Lembur", "Overtime"], fields: ["overtimeEligible"] },
  ],
  contract: [],
  history: [],
  performance: [],
  benefits: [],
  settings: [
    { title: ["Identitas karyawan", "Employee identity"], fields: ["employeeNumber", "active"] },
    { title: ["Akses & absensi", "Access & attendance"], fields: ["userId", "badgeCode"] },
  ],
};

/** Tanggal masuk & keluar tidak disimpan dari form karyawan: keduanya diinput di kontrak kerja. */
const CONTRACT_DATE_FIELDS = ["joinDate", "resignDate"];
const SAVED_FIELDS = EMPLOYEES.fields.filter((f) => !CONTRACT_DATE_FIELDS.includes(f.name));

const WAGE_TYPE: Record<string, [string, string]> = {
  monthly: ["bulan", "month"],
  daily: ["hari", "day"],
  piece: ["satuan", "piece"],
};

function same(a: unknown, b: unknown) {
  const norm = (v: unknown) => (v === undefined || v === null ? "" : JSON.stringify(v));
  return norm(a) === norm(b);
}

/** Form karyawan ala Odoo: kepala dengan foto & kontak, tombol statistik, undangan portal, tab per area. */
export function EmployeeForm({ id }: { id: string }) {
  const me = useMe();
  const router = useRouter();
  const { l, tx, locale } = useI18n();
  const types = useContractTypes();
  const isNew = id === "new";
  const editable = can(me.permissions, "hr.write");
  const manage = can(me.permissions, "hr.manage");
  const [values, setValues] = useState<Values>(() => (isNew ? { active: true, tags: [] } : {}));
  const [original, setOriginal] = useState<Values>(() => (isNew ? { active: true, tags: [] } : {}));
  const [loaded, setLoaded] = useState(isNew);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [tab, setTab] = useState<Tab>("work");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  /** Foto baru yang belum diunggah (karyawan baru: diunggah setelah dibuat). */
  const [pendingPhoto, setPendingPhoto] = useState<{ type: string; data: string } | null>(null);
  const [photoVersion, setPhotoVersion] = useState(0);
  /** Karyawan baru: kontrak kerja pertama dibuat bersamaan & langsung berlaku. */
  const [newContract, setNewContract] = useState<NewContractValues>(NEW_CONTRACT);

  const loadMeta = useCallback(() => {
    if (isNew) return;
    api<Overview>(`/employees/${id}/overview`).then(setOverview, () => setOverview(null));
    api<ProfileSummary>(`/employees/${id}/profile-summary`).then(setSummary, () => setSummary(null));
  }, [id, isNew]);

  useEffect(() => {
    if (isNew) return;
    api<Values>(`/employees/${id}`)
      .then((row) => {
        setValues(row);
        setOriginal(row);
        setLoaded(true);
      })
      .catch((e: Error) => setError(e.message));
    loadMeta();
  }, [id, isNew, loadMeta]);

  const dirty = useMemo(
    () =>
      pendingPhoto !== null ||
      [...SAVED_FIELDS.map((f) => f.name), "tags"].some((k) => !same(values[k], original[k])),
    [values, original, pendingPhoto],
  );

  // Peringatan saat meninggalkan halaman dengan perubahan yang belum disimpan.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (name: string, value: unknown) => setValues((v) => ({ ...v, [name]: value }));

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});
    try {
      if (isNew) {
        const body: Values = { ...toPayload(SAVED_FIELDS, values, true), tags: values.tags ?? [] };
        // Tanggal masuk = tanggal mulai kontrak kerja (diinput di tab Kontrak kerja).
        const missing: Record<string, string> = {};
        if (!newContract.dateStart) missing["contract.dateStart"] = l("Wajib diisi", "Required");
        if (!newContract.wage.trim()) missing["contract.wage"] = l("Wajib diisi", "Required");
        if (Object.keys(missing).length) {
          setFieldErrors(missing);
          setError(l("Lengkapi tab Kontrak kerja.", "Complete the Contract tab."));
          setTab("contract");
          return;
        }
        body.contract = {
          dateStart: newContract.dateStart,
          templateId: newContract.templateId || null,
          contractType: newContract.contractType,
          dateEnd: newContract.dateEnd || null,
          wage: newContract.wage.trim(),
          wageType: newContract.wageType,
          taxMethod: newContract.taxMethod,
          allowances: newContract.allowances
            .filter((a) => a.componentId)
            .map((a) => ({ componentId: a.componentId, amount: a.amount.trim() || "0" })),
        };
        const created = await api<{ id: string; contractId?: string }>("/employees", {
          method: "POST",
          body,
        });
        if (pendingPhoto) await api(`/employees/${created.id}/photo`, { method: "PUT", body: pendingPhoto });
        router.replace(
          created.contractId ? `/hr/contracts/${created.contractId}?created=1` : `/employees/${created.id}`,
        );
        return;
      }
      const changed = SAVED_FIELDS.filter((f) => !same(values[f.name], original[f.name]));
      const body: Values = toPayload(changed, values, false);
      if (!same(values.tags, original.tags)) body.tags = values.tags ?? [];
      if (Object.keys(body).length) {
        const row = await api<Values>(`/employees/${id}`, { method: "PATCH", body });
        setValues(row);
        setOriginal(row);
      }
      if (pendingPhoto) {
        await api(`/employees/${id}/photo`, { method: "PUT", body: pendingPhoto });
        bumpImage(`/employees/${id}/photo`);
        setPendingPhoto(null);
        setPhotoVersion((v) => v + 1);
      }
      setVersion((v) => v + 1);
      loadMeta();
      setNotice(l("Tersimpan.", "Saved."));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors);
        if (Object.keys(err.fieldErrors).some((k) => k.startsWith("contract."))) setTab("contract");
      }
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setValues(original);
    setPendingPhoto(null);
    setFieldErrors({});
    setError(null);
  }

  async function removePhoto() {
    if (!confirm(l("Hapus foto?", "Remove photo?"))) return;
    try {
      await api(`/employees/${id}/photo`, { method: "DELETE" });
      bumpImage(`/employees/${id}/photo`);
      loadMeta();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function invite() {
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ status: "invited" | "linked"; email: string }>(`/employees/${id}/invite`, {
        method: "POST",
        body: {},
      });
      setNotice(
        res.status === "linked"
          ? l(`Ditautkan ke akun ${res.email}.`, `Linked to account ${res.email}.`)
          : l(`Undangan dikirim ke ${res.email}.`, `Invitation sent to ${res.email}.`),
      );
      loadMeta();
      if (res.status === "linked") setVersion((v) => v + 1);
    } catch (e) {
      if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
      setError(errorText(e));
    }
  }

  async function archive(active: boolean) {
    try {
      const row = await api<Values>(`/employees/${id}`, { method: "PATCH", body: { active } });
      setValues(row);
      setOriginal(row);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function remove() {
    if (!confirm(l("Hapus karyawan ini?", "Delete this employee?"))) return;
    try {
      await api(`/employees/${id}`, { method: "DELETE" });
      router.replace("/employees");
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (!loaded) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  // Karyawan baru selalu dibuat bersama kontrak kerjanya (tanggal masuk = mulai kontrak), jadi butuh hak kontrak.
  if (isNew && !manage)
    return (
      <section className="panel">
        <p className="error">
          {l(
            "Menambah karyawan memerlukan hak kelola kontrak kerja (hr.manage), karena tanggal masuk diisi di kontrak kerja.",
            "Adding employees requires the contract management right (hr.manage), because the join date is set on the employment contract.",
          )}
        </p>
        <Link href="/employees">{l("Kembali ke daftar karyawan", "Back to employees")}</Link>
      </section>
    );

  const name = String(values.name ?? "");
  const field = (n: string) => FIELDS.get(n);
  const row = (n: string) => {
    const f = field(n);
    if (!f) return null;
    return (
      <label key={n} className={f.type === "boolean" ? "o-row check" : "o-row"}>
        <span className="o-label">
          {tx(f.label)}
          {"required" in f && f.required ? " *" : ""}
        </span>
        <span className="o-value">
          <FieldInput field={f as Field} value={values[n]} onChange={(v) => set(n, v)} />
          {fieldErrors[n] && <small className="error">{fieldErrors[n]}</small>}
        </span>
      </label>
    );
  };
  const groups = (t: Tab) =>
    GROUPS[t].map((g, i) => (
      <section key={i} className="o-group">
        {g.title && <h3 className="o-group-title">{l(...g.title)}</h3>}
        {g.fields.filter((n) => !HEAD_FIELDS.includes(n) || t === "personal").map(row)}
      </section>
    ));

  const tabs: [Tab, string, boolean][] = [
    ["work", l("Kerja", "Work"), true],
    ["contract", l("Kontrak kerja", "Contract"), isNew && manage],
    ["personal", l("Pribadi", "Private"), true],
    ["payroll", l("Penggajian", "Payroll"), true],
    ["benefits", l("Benefit", "Benefits"), !isNew && can(me.permissions, "payroll.read")],
    ["history", l("Dokumen & Riwayat", "Documents & History"), !isNew],
    ["performance", l("Kinerja", "Performance"), !isNew],
    ["settings", l("Pengaturan", "Settings"), true],
  ];

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <nav className="breadcrumb">
            <Link href="/employees">{l("Karyawan", "Employees")}</Link>
            <span>/</span>
            <h1>{isNew ? l("Baru", "New") : name || "—"}</h1>
          </nav>
          {editable && (dirty || isNew) && (
            <span className="save-actions">
              <button
                type="button"
                className="icon-btn primary"
                title={l("Simpan", "Save")}
                aria-label={l("Simpan", "Save")}
                disabled={saving}
                onClick={save}
              >
                <CloudIcon />
              </button>
              {!isNew && (
                <button
                  type="button"
                  className="icon-btn"
                  title={l("Buang perubahan", "Discard changes")}
                  aria-label={l("Buang perubahan", "Discard changes")}
                  onClick={discard}
                >
                  ×
                </button>
              )}
              <small className="muted">{l("Belum disimpan", "Unsaved")}</small>
            </span>
          )}
          {!isNew && editable && (
            <details className="more-menu">
              <summary aria-label={l("Tindakan lain", "More actions")}>⋮</summary>
              <div className="more-menu-items">
                {values.active ? (
                  <button type="button" onClick={() => archive(false)}>
                    {l("Arsipkan", "Archive")}
                  </button>
                ) : (
                  <button type="button" onClick={() => archive(true)}>
                    {l("Aktifkan kembali", "Unarchive")}
                  </button>
                )}
                {manage && (
                  <button type="button" className="danger" onClick={remove}>
                    {l("Hapus", "Delete")}
                  </button>
                )}
              </div>
            </details>
          )}
        </div>
        {overview && (
          <div className="stat-buttons">
            <Link className="stat-button" href={`/hr/appraisals?employeeId=${id}`}>
              <StarIcon />
              <span>
                <small>{l("Penilaian", "Appraisals")}</small>
                <strong>
                  {overview.openAppraisals > 0
                    ? `${overview.openAppraisals} ${l("berjalan", "open")}`
                    : overview.appraisals}
                </strong>
              </span>
            </Link>
            <Link className="stat-button" href={`/hr/goals?employeeId=${id}`}>
              <TargetIcon />
              <span>
                <small>{l("Sasaran", "Goals")}</small>
                <strong>{overview.goals}</strong>
              </span>
            </Link>
            <Link className="stat-button" href={`/hr/attendance?employeeId=${id}`}>
              <ClockIcon />
              <span>
                <small>{l("Jam bulan ini", "Hours this month")}</small>
                <strong>
                  {Number(overview.hoursThisMonth).toLocaleString(locale === "id" ? "id-ID" : "en")} h
                </strong>
              </span>
            </Link>
          </div>
        )}
      </header>

      <div className="form-layout">
        <div className="stack-wide">
          {!isNew && overview && (
            <div className="emp-statusbar">
              {can(me.permissions, "user.write") && overview.account.status !== "linked" && (
                <button type="button" className="primary" onClick={invite}>
                  {overview.account.status === "invited"
                    ? l("Kirim ulang undangan", "Resend invitation")
                    : l("Undang ke portal", "Invite to portal")}
                </button>
              )}
              <span className="grow" />
              {overview.account.status === "linked" ? (
                <span className="pill ok">
                  ● {l("Punya akun", "Has account")}: {overview.account.email}
                </span>
              ) : overview.account.status === "invited" ? (
                <span className="pill warn">
                  ✉ {l("Diundang", "Invited")}: {overview.account.email} · {l("berlaku s.d.", "until")}{" "}
                  {formatDate(overview.account.expiresAt.slice(0, 10), locale)}
                </span>
              ) : (
                <span className="pill bad">○ {l("Belum diundang", "Not invited")}</span>
              )}
            </div>
          )}

          <div className="panel emp-sheet">
            {error && <p className="error">{error}</p>}
            {notice && <p className="notice">{notice}</p>}
            <fieldset disabled={!editable} className="bare">
              <div className="emp-head">
                <EmployeePhoto
                  key={photoVersion}
                  id={isNew ? null : id}
                  hasPhoto={overview?.hasPhoto ?? false}
                  pending={pendingPhoto}
                  editable={editable}
                  onPick={setPendingPhoto}
                  onRemove={!isNew && overview?.hasPhoto && !pendingPhoto ? removePhoto : undefined}
                  name={name}
                />
                <div className="emp-head-main">
                  <input
                    className="emp-name"
                    aria-label={l("Nama karyawan", "Employee name")}
                    placeholder={l("Nama Karyawan (mis. Budi Santoso)", "Employee name (e.g. John Doe)")}
                    value={name}
                    required
                    onChange={(e) => set("name", e.target.value)}
                  />
                  {fieldErrors.name && <small className="error">{fieldErrors.name}</small>}
                  <div className="emp-job">
                    <FieldInput
                      field={field("jobId") as Field}
                      value={values.jobId}
                      onChange={(v) => set("jobId", v)}
                    />
                  </div>
                  <IconInput
                    icon={<MailIcon />}
                    type="email"
                    label={l("Email kerja", "Work email")}
                    placeholder={l("contoh: budi@perusahaan.co.id", "e.g. johndoe@example.com")}
                    value={values.workEmail}
                    error={fieldErrors.workEmail}
                    onChange={(v) => set("workEmail", v)}
                  />
                  <IconInput
                    icon={<PhoneIcon />}
                    label={l("Telepon kantor", "Work phone")}
                    placeholder={l("Telepon kantor", "Work phone")}
                    value={values.workPhone}
                    error={fieldErrors.workPhone}
                    onChange={(v) => set("workPhone", v)}
                  />
                  <IconInput
                    icon={<MobileIcon />}
                    label={l("Nomor HP", "Mobile")}
                    placeholder={l("Nomor HP", "Mobile")}
                    value={values.personalPhone}
                    error={fieldErrors.personalPhone}
                    onChange={(v) => set("personalPhone", v)}
                  />
                  <div className="emp-icon-row">
                    <TagIcon />
                    <TagsInput
                      value={(values.tags as string[] | undefined) ?? []}
                      onChange={(t) => set("tags", t)}
                      placeholder={l("contoh: Remote, Gedung B, Shift malam…", "e.g. Remote, Building B…")}
                    />
                  </div>
                  {fieldErrors.tags && <small className="error">{fieldErrors.tags}</small>}
                </div>
                <div className="emp-head-side">
                  <span className={`pill ${values.active === false ? "bad" : "ok"}`}>
                    {values.active === false ? l("Diarsipkan", "Archived") : l("Aktif", "Active")}
                  </span>
                  {summary && (
                    <div className="emp-completeness" title={l("Kelengkapan profil", "Profile completeness")}>
                      <small className="muted">{l("Kelengkapan profil", "Profile completeness")}</small>
                      <div
                        className="meter"
                        role="meter"
                        aria-valuenow={summary.completeness.percent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={l("Kelengkapan profil", "Profile completeness")}
                      >
                        <span style={{ width: `${summary.completeness.percent}%` }} />
                      </div>
                      <small>{summary.completeness.percent}%</small>
                    </div>
                  )}
                </div>
              </div>

              <nav className="tabs emp-tabs" role="tablist">
                {tabs
                  .filter(([, , show]) => show)
                  .map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={tab === k}
                      className={tab === k ? "active" : ""}
                      onClick={() => setTab(k)}
                    >
                      {label}
                    </button>
                  ))}
              </nav>

              {tab === "payroll" && (
                <div className="o-grid">
                  <section className="o-group">
                    <h3 className="o-group-title">
                      {l("Ringkasan kontrak", "Contract summary")}
                      {!isNew &&
                        can(me.permissions, "hr.manage") &&
                        (overview?.contract ? (
                          <Link className="o-group-link" href={`/hr/contracts/${overview.contract.id}`}>
                            {l("Buka kontrak", "Open contract")}
                          </Link>
                        ) : (
                          <Link className="o-group-link" href={`/hr/contracts/new?employeeId=${id}`}>
                            {l("Buat kontrak", "Create contract")}
                          </Link>
                        ))}
                    </h3>
                    {isNew ? (
                      <p className="muted">
                        {l(
                          "Kontrak kerja & tanggal masuk diisi di tab ",
                          "The contract & join date are set in the ",
                        )}
                        <button type="button" className="link" onClick={() => setTab("contract")}>
                          {l("Kontrak kerja", "Contract")}
                        </button>
                        {l(
                          " dan langsung berlaku saat karyawan disimpan.",
                          " tab and take effect when saved.",
                        )}
                      </p>
                    ) : overview?.contract ? (
                      <>
                        <ReadRow label={l("Kontrak", "Contract")}>
                          {overview.contract.name} · {types.label(overview.contract.contractType)}
                        </ReadRow>
                        {types.find(overview.contract.contractType) && (
                          <ReadRow label={l("Aturan jenis kontrak", "Contract type rules")}>
                            {contractRuleText(types.find(overview.contract.contractType)!, l)}
                          </ReadRow>
                        )}
                        <ReadRow label={l("Periode", "Period")}>
                          {formatDate(overview.contract.dateStart, locale)} –{" "}
                          {overview.contract.dateEnd
                            ? formatDate(overview.contract.dateEnd, locale)
                            : l("tidak terbatas", "open-ended")}
                        </ReadRow>
                        <ReadRow label={l("Gaji dasar", "Base wage")}>
                          {money(overview.contract.wage, locale)} /{" "}
                          {l(...(WAGE_TYPE[overview.contract.wageType] ?? ["bulan", "month"]))}
                        </ReadRow>
                        <ReadRow label={l("Tunjangan tetap", "Fixed allowances")}>
                          {money(overview.contract.fixedAllowance, locale)}
                        </ReadRow>
                        {overview.contract.components.length > 0 && (
                          <ReadRow label={l("Komponen gaji", "Pay components")}>
                            <ul className="plain-list">
                              {overview.contract.components.map((c, i) => (
                                <li key={i}>
                                  {c.kind === "deduction" ? "− " : ""}
                                  {c.name}: {money(c.amount, locale, 0)}{" "}
                                  <small className="muted">
                                    {c.calc === "per_attendance_day"
                                      ? l("/ hari hadir", "/ day present")
                                      : c.calc === "attendance_premium"
                                        ? l("premi / bulan", "bonus / month")
                                        : l("/ bulan", "/ month")}
                                  </small>
                                </li>
                              ))}
                            </ul>
                          </ReadRow>
                        )}
                        <ReadRow label={l("Metode PPh 21", "PPh 21 method")}>
                          {overview.contract.taxMethod === "gross_up"
                            ? l("Gross-up (ditanggung perusahaan)", "Gross-up (company-borne)")
                            : l("Gross (dipotong dari gaji)", "Gross (deducted)")}
                        </ReadRow>
                      </>
                    ) : (
                      <p className="muted">{l("Belum ada kontrak berjalan.", "No running contract.")}</p>
                    )}
                  </section>
                  <div>
                    {groups("payroll")}
                    {summary && (
                      <p className={summary.ptkpMismatch ? "error" : "muted"}>
                        {l("Saran PTKP dari data keluarga", "PTKP suggested by family data")}:{" "}
                        <strong>{summary.suggestedPtkp}</strong>
                        {summary.ptkpMismatch &&
                          ` · ${l("berbeda dengan status saat ini", "differs from current")}`}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {tab === "contract" && isNew && manage && (
                <NewEmployeeContract value={newContract} onChange={setNewContract} errors={fieldErrors} />
              )}

              {(tab === "work" || tab === "personal" || tab === "settings") && (
                <div className="o-grid">
                  {groups(tab)}
                  {tab === "work" && !isNew && (
                    <section className="o-group">
                      <h3 className="o-group-title">
                        {l("Masa kerja", "Employment period")}
                        <Link className="o-group-link" href={`/hr/contracts?employeeId=${id}`}>
                          {l("Kontrak kerja", "Contracts")}
                        </Link>
                      </h3>
                      <ReadRow label={l("Tanggal masuk", "Join date")}>
                        {values.joinDate ? formatDate(values.joinDate as string, locale) : "—"}
                      </ReadRow>
                      <ReadRow label={l("Tanggal keluar", "Leaving date")}>
                        {values.resignDate
                          ? `${formatDate(values.resignDate as string, locale)}${
                              values.resignReason && RESIGN_REASON_LABEL[values.resignReason as string]
                                ? ` · ${l(...RESIGN_REASON_LABEL[values.resignReason as string]!)}`
                                : ""
                            }`
                          : "—"}
                      </ReadRow>
                      <p className="muted small">
                        {l(
                          "Tanggal masuk mengikuti tanggal mulai kontrak pertama; tanggal keluar diisi lewat Akhiri kontrak (karyawan keluar).",
                          "The join date follows the first contract's start date; the leaving date is set with End contract (employee leaves).",
                        )}
                      </p>
                    </section>
                  )}
                </div>
              )}
            </fieldset>

            {tab === "settings" && !isNew && editable && (
              <AttendancePin id={id} hasPin={Boolean(values.hasAttendancePin)} />
            )}
          </div>

          {!isNew && tab === "personal" && (
            <>
              <FamilyPanel employeeId={id} editable={manage} />
              <EducationPanel employeeId={id} editable={manage} />
              <ExperiencePanel employeeId={id} editable={manage} />
            </>
          )}
          {!isNew && tab === "history" && (
            <>
              {manage && <DocumentsPanel employeeId={id} />}
              <MovementsPanel employeeId={id} />
              {manage && <WarningsPanel employeeId={id} />}
              <CareerPanel employeeId={id} />
              <ChecklistsPanel employeeId={id} />
              {manage && <OffboardingPanel employeeId={id} />}
              {can(me.permissions, "payroll.read") && <SeverancePanel id={id} />}
            </>
          )}
          {!isNew && tab === "performance" && (
            <>
              <FeedbackPanel employeeId={id} />
              <NotesPanel employeeId={id} />
            </>
          )}
          {!isNew && tab === "payroll" && can(me.permissions, "payroll.read") && (
            <TotalRewardsPanel employeeId={id} />
          )}
          {!isNew && tab === "benefits" && <BenefitEnrollments employeeId={id} />}
          {!isNew && tab === "settings" && can(me.permissions, "fleet.read") && (
            <EmployeeVehiclesPanel employeeId={id} />
          )}
        </div>
        {!isNew && (
          <Chatter
            model="employee"
            id={id}
            version={version}
            labels={Object.fromEntries(EMPLOYEES.fields.map((f) => [f.name, tx(f.label)]))}
          />
        )}
      </div>
    </>
  );
}

function ReadRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="o-row">
      <span className="o-label">{label}</span>
      <span className="o-value">{children}</span>
    </div>
  );
}

function IconInput({
  icon,
  label,
  placeholder,
  value,
  onChange,
  error,
  type = "text",
}: {
  icon: ReactNode;
  label: string;
  placeholder: string;
  value: unknown;
  onChange: (v: string) => void;
  error?: string;
  type?: string;
}) {
  return (
    <>
      <label className="emp-icon-row">
        {icon}
        <input
          type={type}
          aria-label={label}
          placeholder={placeholder}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      {error && <small className="error">{error}</small>}
    </>
  );
}

/** Input tag: Enter atau koma menambah, × menghapus. */
function TagsInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}) {
  const { l } = useI18n();
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim().replace(/,$/, "").trim();
    if (t && !value.includes(t)) onChange([...value, t].slice(0, 10));
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
  };
  return (
    <span className="tags-input">
      {value.map((t) => (
        <span key={t} className="tag-chip">
          {t}
          <button
            type="button"
            aria-label={l(`Hapus tag ${t}`, `Remove tag ${t}`)}
            onClick={() => onChange(value.filter((x) => x !== t))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        aria-label={l("Tag", "Tags")}
        placeholder={value.length ? "" : placeholder}
        value={draft}
        maxLength={40}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
      />
    </span>
  );
}

/** Foto profil: klik untuk memilih; karyawan baru disimpan sementara lalu diunggah setelah dibuat. */
function EmployeePhoto({
  id,
  hasPhoto,
  pending,
  editable,
  onPick,
  onRemove,
  name,
}: {
  id: string | null;
  hasPhoto: boolean;
  pending: { type: string; data: string } | null;
  editable: boolean;
  onPick: (p: { type: string; data: string } | null) => void;
  onRemove?: () => void;
  name: string;
}) {
  const { l } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) return setError(l("Pilih berkas gambar", "Choose an image file"));
    try {
      onPick(await resizePhoto(file));
    } catch {
      setError(l("Gambar tidak bisa dibaca", "The image cannot be read"));
    }
  };
  const placeholder = (
    <span className="emp-photo-empty" aria-hidden>
      <CameraIcon />
    </span>
  );
  const image = pending ? (
    <img src={`data:${pending.type};base64,${pending.data}`} alt={name} />
  ) : id && hasPhoto ? (
    <AuthImage path={`/employees/${id}/photo`} alt={name} fallback={placeholder} />
  ) : (
    placeholder
  );
  return (
    <div className="emp-photo-wrap">
      <button
        type="button"
        className="emp-photo"
        disabled={!editable}
        title={editable ? l("Unggah foto", "Upload photo") : undefined}
        aria-label={l("Unggah foto", "Upload photo")}
        onClick={() => input.current?.click()}
      >
        {image}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      {editable && (pending || onRemove) && (
        <button type="button" className="link small" onClick={() => (pending ? onPick(null) : onRemove?.())}>
          {pending ? l("Batal ganti foto", "Undo photo") : l("Hapus foto", "Remove photo")}
        </button>
      )}
      {error && <small className="error">{error}</small>}
    </div>
  );
}

function AttendancePin({ id, hasPin }: { id: string; hasPin: boolean }) {
  const { l } = useI18n();
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    setMsg(null);
    try {
      await api(`/employees/${id}/attendance-pin`, { method: "PUT", body: { pin } });
      setPin("");
      setMsg(l("PIN kiosk disimpan.", "Kiosk PIN saved."));
    } catch (e) {
      setMsg(errorText(e));
    }
  };
  return (
    <section className="o-group">
      <h3 className="o-group-title">{l("PIN kiosk absensi", "Attendance kiosk PIN")}</h3>
      <div className="o-row">
        <span className="o-label">{hasPin ? l("Ganti PIN", "Change PIN") : l("Atur PIN", "Set PIN")}</span>
        <span className="o-value inline">
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4,8}"
            aria-label="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          />
          <button type="button" disabled={pin.length < 4} onClick={save}>
            {l("Simpan PIN", "Save PIN")}
          </button>
        </span>
      </div>
      {msg && <small className="muted">{msg}</small>}
    </section>
  );
}

// ---- Ikon (SVG sederhana, mengikuti warna teks) ----

const svg = (d: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    aria-hidden
  >
    {d}
  </svg>
);
const MailIcon = () =>
  svg(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>,
  );
const PhoneIcon = () =>
  svg(
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />,
  );
const MobileIcon = () =>
  svg(
    <>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </>,
  );
const TagIcon = () =>
  svg(
    <>
      <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" />
      <circle cx="8" cy="8" r="1.5" />
    </>,
  );
const CloudIcon = () =>
  svg(
    <>
      <path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8z" />
      <path d="m12 15 0-6m-3 3 3-3 3 3" />
    </>,
  );
const StarIcon = () =>
  svg(<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />);
const TargetIcon = () =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>,
  );
const ClockIcon = () =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
  );
const CameraIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="56"
    height="56"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    aria-hidden
  >
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13" r="4" />
    <path d="M19 4v4m-2-2h4" />
  </svg>
);
