"use client";

import { SEVERANCE_REASONS, type SeveranceReason } from "@erp/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { formatDate, money } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { can } from "../lib/resources";
import { BankAccountsPanel } from "./accounting/bank-accounts-panel";
import { CreditPanel } from "./accounting/credit-panel";
import { CareerPanel, ChecklistsPanel, DocumentsPanel } from "./hr/hr-panels";
import { FeedbackPanel, NotesPanel } from "./hr/ess-panels";
import {
  ContractActions,
  EmployeeVehiclesPanel,
  ServiceBillPanel,
  VehicleExtras,
} from "./fleet/fleet-panels";
import { GradeBaseWagePanel } from "./hr/grade-wage-panel";
import { EquipmentPanel, PlanTasksPanel, TeamMembersPanel } from "./maintenance/maintenance-panels";
import { OffboardingPanel } from "./hr/offboarding-panel";
import {
  EducationPanel,
  ExperiencePanel,
  FamilyPanel,
  MovementsPanel,
  ProfileHeader,
  WarningsPanel,
} from "./hr/profile-panels";
import { useMe } from "./me-context";
import { ask } from "./feedback";
import { RelatedDocuments } from "./related-documents";

interface Attribute {
  id: string;
  name: string;
}
interface AttributeValue {
  id: string;
  attributeId: string;
  name: string;
  priceExtra: string;
}
interface Variant {
  id: string;
  sku: string;
  name: string;
  salePrice: string;
  active: boolean;
  attributes: { attribute: string; value: string }[];
}

/** Varian produk: daftar varian & pembuat kombinasi dari nilai atribut. */
function VariantsPanel({ id }: { id: string }) {
  const me = useMe();
  const { l, locale } = useI18n();
  const [data, setData] = useState<{ template: { variantOfId: string | null }; variants: Variant[] } | null>(
    null,
  );
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [values, setValues] = useState<AttributeValue[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<typeof data>(`/products/${id}/variants`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    api<{ items: Attribute[] }>("/product-attributes?limit=200").then((r) => setAttributes(r.items));
    api<{ items: AttributeValue[] }>("/product-attribute-values?limit=200").then((r) => setValues(r.items));
  }, []);

  if (!data || data.template.variantOfId) return null;
  const writable = can(me.permissions, "product.write");
  const groups = attributes
    .map((a) => values.filter((v) => v.attributeId === a.id && picked.has(v.id)).map((v) => v.id))
    .filter((g) => g.length);
  const count = groups.reduce((n, g) => n * g.length, groups.length ? 1 : 0);

  return (
    <section className="panel">
      <h2>{l("Varian", "Variants")}</h2>
      {error && <p className="error">{error}</p>}
      {data.variants.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>{l("Atribut", "Attributes")}</th>
                <th className="num">{l("Harga jual", "Sales price")}</th>
              </tr>
            </thead>
            <tbody>
              {data.variants.map((v) => (
                <tr key={v.id} className={v.active ? "" : "muted"}>
                  <td>
                    <Link href={`/products/${v.id}`}>{v.sku}</Link>
                  </td>
                  <td>{v.attributes.map((a) => `${a.attribute}: ${a.value}`).join(" · ")}</td>
                  <td className="num">{money(v.salePrice, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">
          {l(
            "Belum ada varian. Pilih nilai atribut untuk membuat setiap kombinasinya sebagai produk tersendiri (stok & SKU sendiri); produk ini menjadi induknya.",
            "No variants yet. Pick attribute values to create every combination as its own product (own stock & SKU); this product becomes the parent.",
          )}
        </p>
      )}
      {writable && (
        <div className="variant-picker">
          {attributes.length === 0 && (
            <p className="muted">
              {l("Buat atribut dulu di", "Create attributes first in")}{" "}
              <Link href="/product-attributes">{l("Atribut Produk", "Product Attributes")}</Link>.
            </p>
          )}
          {attributes.map((a) => (
            <fieldset key={a.id}>
              <legend>{a.name}</legend>
              {values
                .filter((v) => v.attributeId === a.id)
                .map((v) => (
                  <label key={v.id} className="inline-check">
                    <input
                      type="checkbox"
                      checked={picked.has(v.id)}
                      onChange={(e) =>
                        setPicked((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.add(v.id);
                          else next.delete(v.id);
                          return next;
                        })
                      }
                    />
                    {v.name}
                    {Number(v.priceExtra) ? ` (+${money(v.priceExtra, locale)})` : ""}
                  </label>
                ))}
            </fieldset>
          ))}
          {attributes.length > 0 && (
            <button
              type="button"
              className="primary"
              disabled={busy || !count}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api(`/products/${id}/variants`, { method: "POST", body: { values: groups } });
                  setPicked(new Set());
                  load();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {l(`Buat ${count} kombinasi`, `Create ${count} combinations`)}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

interface PortalAccess {
  email: string;
  name: string;
  active: boolean;
  hasPassword: boolean;
  invitePending: boolean;
  inviteExpiresAt: string | null;
  lastLoginAt: string | null;
  inviteUrl?: string;
}

/** Akses portal pelanggan: undang/undang ulang & cabut. */
function PortalAccessPanel({ id }: { id: string }) {
  const me = useMe();
  const { l, locale } = useI18n();
  const [access, setAccess] = useState<PortalAccess | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PortalAccess | null>(`/partners/${id}/portal`)
      .then((a) => {
        // Belum ada akses: API membalas null (badan kosong).
        const found = a && a.email ? a : null;
        setAccess(found);
        setEmail(found?.email ?? "");
      })
      .catch(() => setAccess(null));
  }, [id]);

  if (access === undefined) return null;
  const writable = can(me.permissions, "partner.write");
  const run = async (path: string, body?: object) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<PortalAccess>(`/partners/${id}/${path}`, { method: "POST", body: body ?? {} });
      setAccess(res);
      setLink(res.inviteUrl ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>{l("Portal pelanggan", "Customer portal")}</h2>
      {error && <p className="error">{error}</p>}
      {access ? (
        <p>
          {access.name} &lt;{access.email}&gt; ·{" "}
          {!access.active
            ? l("dicabut", "revoked")
            : access.hasPassword
              ? l("aktif", "active")
              : l("menunggu undangan diterima", "invitation pending")}
          {access.lastLoginAt && (
            <span className="muted">
              {" "}
              · {l("terakhir masuk", "last login")} {formatDate(access.lastLoginAt.slice(0, 10), locale)}
            </span>
          )}
        </p>
      ) : (
        <p className="muted">
          {l(
            "Pelanggan bisa melihat penawaran, pesanan, dan faktur, mengunduh PDF, serta menyetujui penawaran lewat portal.",
            "Customers can view quotations, orders and invoices, download PDFs, and accept quotations in the portal.",
          )}
        </p>
      )}
      {writable && (
        <div className="cp-right">
          <input
            type="email"
            placeholder={l("Email portal", "Portal email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="button" disabled={busy} onClick={() => run("portal-invite", email ? { email } : {})}>
            {access
              ? l("Kirim ulang undangan", "Resend invitation")
              : l("Undang ke portal", "Invite to portal")}
          </button>
          {access?.active && (
            <button type="button" className="danger" disabled={busy} onClick={() => run("portal-revoke")}>
              {l("Cabut akses", "Revoke")}
            </button>
          )}
        </div>
      )}
      {link && (
        <p className="notice">
          {l(
            "Undangan terkirim. Tautan (bisa dibagikan manual):",
            "Invitation sent. Link (can be shared manually):",
          )}{" "}
          <code className="wrap">{link}</code>
        </p>
      )}
    </section>
  );
}

interface SeveranceResult {
  article: string;
  label: string;
  monthlyWage: string;
  unusedLeaveDays: string;
  serviceYears: string;
  upMonths: number;
  upFactor: number;
  up: string;
  upmkMonths: number;
  upmkFactor: number;
  upmk: string;
  leaveCompensation: string;
  uph: string;
  separationPay: string;
  pkwtCompensation: string;
  gross: string;
  tax: string;
  net: string;
}
interface SeveranceRow {
  id: string;
  reason: SeveranceReason;
  endDate: string;
  gross: string;
  tax: string;
  net: string;
  moveId: string | null;
  moveName: string | null;
}

/** Kalkulator & pencatatan hak akhir hubungan kerja (PP 35/2021) dengan PPh 21 final pesangon. */
export function SeverancePanel({ id }: { id: string }) {
  const me = useMe();
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<SeveranceRow[]>([]);
  const [form, setForm] = useState({
    reason: "resignation" as SeveranceReason,
    endDate: new Date().toISOString().slice(0, 10),
    unusedLeaveDays: "",
    otherRights: "0",
    separationPay: "0",
  });
  const [result, setResult] = useState<SeveranceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api<SeveranceRow[]>(`/employees/${id}/severances`)
      .then(setRows)
      .catch(() => setRows([]));
  }, [id, version]);

  const body = () => ({
    ...form,
    unusedLeaveDays: form.unusedLeaveDays === "" ? undefined : Number(form.unusedLeaveDays),
  });
  async function call(path: string) {
    setError(null);
    try {
      return await api<SeveranceResult>(`/employees/${id}/${path}`, { method: "POST", body: body() });
    } catch (e) {
      setError(
        e instanceof ApiError && Object.values(e.fieldErrors)[0]
          ? Object.values(e.fieldErrors)[0]!
          : e instanceof Error
            ? e.message
            : String(e),
      );
      return null;
    }
  }
  const preview = async () => setResult(await call("severance/preview"));
  const save = async () => {
    if (!(await ask(l("Catat & jurnal hak akhir ini?", "Record and post this final settlement?")))) return;
    if (await call("severances")) {
      setResult(null);
      setVersion((v) => v + 1);
    }
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const row = (label: string, amount: string, hint?: string) => (
    <tr>
      <td>
        {label}
        {hint && <span className="muted"> — {hint}</span>}
      </td>
      <td className="num">{money(amount, locale)}</td>
    </tr>
  );

  return (
    <section className="panel">
      <h2>{l("Pesangon & hak akhir (PP 35/2021)", "Severance & final settlement (PP 35/2021)")}</h2>
      {error && <p className="error">{error}</p>}
      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="lines">
            <thead>
              <tr>
                <th>{l("Alasan", "Reason")}</th>
                <th>{l("Tanggal berakhir", "End date")}</th>
                <th className="num">{l("Bruto", "Gross")}</th>
                <th className="num">{l("PPh 21 final", "Final PPh 21")}</th>
                <th className="num">{l("Diterima", "Net")}</th>
                <th>{l("Jurnal", "Entry")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{SEVERANCE_REASONS[r.reason]?.label ?? r.reason}</td>
                  <td>{formatDate(r.endDate, locale)}</td>
                  <td className="num">{money(r.gross, locale)}</td>
                  <td className="num">{money(r.tax, locale)}</td>
                  <td className="num">{money(r.net, locale)}</td>
                  <td>{r.moveId && <Link href={`/accounting/moves/${r.moveId}`}>{r.moveName}</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="inline-panel">
        <label className="field">
          <span>{l("Alasan PHK", "Termination reason")}</span>
          <select value={form.reason} onChange={set("reason")}>
            {Object.entries(SEVERANCE_REASONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.article} — {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{l("Tanggal berakhir", "End date")}</span>
          <input type="date" value={form.endDate} onChange={set("endDate")} />
        </label>
        <label className="field">
          <span>{l("Sisa cuti (kosong = dari saldo)", "Unused leave (empty = balance)")}</span>
          <input
            className="num"
            inputMode="decimal"
            value={form.unusedLeaveDays}
            onChange={set("unusedLeaveDays")}
          />
        </label>
        <label className="field">
          <span>{l("Hak lain (ongkos pulang, dll.)", "Other rights (travel home, etc.)")}</span>
          <input className="num" inputMode="decimal" value={form.otherRights} onChange={set("otherRights")} />
        </label>
        <label className="field">
          <span>{l("Uang pisah (PK/PP/PKB)", "Separation pay (agreement)")}</span>
          <input
            className="num"
            inputMode="decimal"
            value={form.separationPay}
            onChange={set("separationPay")}
          />
        </label>
        <button type="button" onClick={preview}>
          {l("Hitung", "Calculate")}
        </button>
      </div>
      {result && (
        <>
          <p className="muted">
            {result.article} · {l("masa kerja", "service")} {Number(result.serviceYears).toFixed(2)}{" "}
            {l("tahun", "years")} · {l("upah sebulan", "monthly wage")} {money(result.monthlyWage, locale)} ·{" "}
            {l("sisa cuti", "unused leave")} {Number(result.unusedLeaveDays)} {l("hari", "days")}
          </p>
          <div className="table-scroll">
            <table className="lines">
              <tbody>
                {row(
                  l("Uang pesangon", "Severance pay"),
                  result.up,
                  `${result.upMonths} × ${result.upFactor} ${l("bulan upah", "months")}`,
                )}
                {row(
                  l("Uang penghargaan masa kerja", "Long-service pay"),
                  result.upmk,
                  `${result.upmkMonths} × ${result.upmkFactor} ${l("bulan upah", "months")}`,
                )}
                {row(l("Uang penggantian hak", "Compensation of rights"), result.uph)}
                {Number(result.separationPay) > 0 &&
                  row(l("Uang pisah", "Separation pay"), result.separationPay)}
                {Number(result.pkwtCompensation) > 0 &&
                  row(l("Uang kompensasi PKWT", "Fixed-term compensation"), result.pkwtCompensation)}
                {row(l("Bruto", "Gross"), result.gross)}
                {row(l("PPh 21 final (PP 68/2009)", "Final PPh 21 (PP 68/2009)"), `-${result.tax}`)}
                {row(l("Diterima", "Net"), result.net)}
              </tbody>
            </table>
          </div>
          {can(me.permissions, "payroll.manage") && (
            <button type="button" className="primary" onClick={save}>
              {l("Catat & jurnal", "Record & post")}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function EmployeeExtras({ id }: { id: string }) {
  const me = useMe();
  const manage = can(me.permissions, "hr.manage");
  return (
    <>
      {can(me.permissions, "hr.read") && <ProfileHeader employeeId={id} />}
      {can(me.permissions, "hr.read") && <FamilyPanel employeeId={id} editable={manage} />}
      {can(me.permissions, "hr.read") && <EducationPanel employeeId={id} editable={manage} />}
      {can(me.permissions, "hr.read") && <ExperiencePanel employeeId={id} editable={manage} />}
      {manage && <DocumentsPanel employeeId={id} />}
      {can(me.permissions, "hr.read") && <MovementsPanel employeeId={id} />}
      {manage && <WarningsPanel employeeId={id} />}
      {can(me.permissions, "hr.read") && <CareerPanel employeeId={id} />}
      {can(me.permissions, "hr.read") && <FeedbackPanel employeeId={id} />}
      {can(me.permissions, "hr.read") && <NotesPanel employeeId={id} />}
      {can(me.permissions, "hr.read") && <ChecklistsPanel employeeId={id} />}
      {manage && <OffboardingPanel employeeId={id} />}
      {can(me.permissions, "payroll.read") && <SeverancePanel id={id} />}
      {can(me.permissions, "fleet.read") && <EmployeeVehiclesPanel employeeId={id} />}
    </>
  );
}

/** Plafon klaim per golongan: menimpa plafon tahunan kategori untuk karyawan di golongan tersebut. */
function ExpenseLimitsPanel({ id }: { id: string }) {
  const me = useMe();
  const { l, locale } = useI18n();
  const [grades, setGrades] = useState<{ id: string; code: string; name: string }[]>([]);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const writable = can(me.permissions, "hr.manage");
  useEffect(() => {
    api<{ items: { id: string; code: string; name: string }[] }>("/salary-grades?limit=200").then(
      (r) => setGrades(r.items),
      () => setGrades([]),
    );
    api<{ gradeId: string; annualLimit: string }[]>(`/expense-categories/${id}/limits`).then(
      (r) => setLimits(Object.fromEntries(r.map((x) => [x.gradeId, String(Number(x.annualLimit))]))),
      (e: Error) => setError(e.message),
    );
  }, [id]);
  if (!grades.length) return null;
  const save = () => {
    setError(null);
    setSaved(false);
    api(`/expense-categories/${id}/limits`, {
      method: "PUT",
      body: {
        limits: Object.entries(limits)
          .filter(([, v]) => v !== "")
          .map(([gradeId, annualLimit]) => ({ gradeId, annualLimit })),
      },
    }).then(
      () => setSaved(true),
      (e: Error) => setError(e.message),
    );
  };
  return (
    <section className="panel">
      <header className="toolbar">
        <h2>{l("Plafon per golongan", "Limit per grade")}</h2>
        {writable && (
          <button type="button" className="primary" onClick={save}>
            {l("Simpan plafon", "Save limits")}
          </button>
        )}
      </header>
      <p className="muted">
        {l(
          "Kosong = ikut plafon tahunan kategori. Contoh: kacamata Rp 1 jt untuk staf, Rp 2,5 jt untuk manajer.",
          "Empty = use the category annual limit. E.g. glasses Rp 1m for staff, Rp 2.5m for managers.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {saved && <p className="muted">{l("Tersimpan.", "Saved.")}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Golongan", "Grade")}</th>
              <th className="num">{l("Plafon tahunan", "Annual limit")}</th>
            </tr>
          </thead>
          <tbody>
            {grades.map((g) => (
              <tr key={g.id}>
                <td>
                  {g.name} <small className="muted">{g.code}</small>
                </td>
                <td className="num">
                  {writable ? (
                    <input
                      className="num"
                      inputMode="decimal"
                      aria-label={`${l("Plafon", "Limit")} ${g.name}`}
                      value={limits[g.id] ?? ""}
                      onChange={(e) => setLimits((x) => ({ ...x, [g.id]: e.target.value }))}
                    />
                  ) : limits[g.id] ? (
                    money(limits[g.id]!, locale)
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Panel tambahan di bawah form generik untuk resource tertentu. */
export function FormExtras({ path, id }: { path: string; id: string }) {
  if (path === "products") return <VariantsPanel id={id} />;
  if (path === "partners")
    return (
      <>
        <CreditPanel id={id} />
        <BankAccountsPanel id={id} />
        <PortalAccessPanel id={id} />
        <RelatedDocuments model="partner" id={id} />
      </>
    );
  if (path === "employees") return <EmployeeExtras id={id} />;
  if (path === "fleet-vehicles") return <VehicleExtras id={id} />;
  if (path === "fleet-contracts") return <ContractActions id={id} />;
  if (path === "fleet-services")
    return (
      <>
        <ServiceBillPanel id={id} />
        <RelatedDocuments model="fleet_service" id={id} />
      </>
    );
  if (path === "equipment") return <EquipmentPanel id={id} />;
  if (path === "maintenance-plans") return <PlanTasksPanel id={id} />;
  if (path === "maintenance-teams") return <TeamMembersPanel id={id} />;
  if (path === "expense-categories") return <ExpenseLimitsPanel id={id} />;
  if (path === "salary-grades") return <GradeBaseWagePanel id={id} />;
  return null;
}
