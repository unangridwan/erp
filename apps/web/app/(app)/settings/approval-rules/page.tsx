"use client";

import {
  APPROVAL_LIMIT_DOC_KEYS,
  APPROVAL_RULE_DOCS,
  APPROVAL_RULE_DOC_KEYS,
  APPROVER_TYPE_LABELS,
  type ApproverType,
} from "@erp/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { docLabel } from "../../../../components/settings/approval-panels";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Option {
  id: string;
  name: string;
}
interface StepRow {
  approverType: ApproverType;
  userId: string;
  roleId: string;
  minValue: string;
  label: string;
}
interface LimitRow {
  /** "" = default perusahaan, `u:<id>` pengguna, `r:<id>` peran. */
  who: string;
  categoryId: string;
  maxAmount: string;
  note: string;
}
interface SimStep {
  step: number;
  label: string | null;
  approver: string | null;
  holders: string[];
}
interface SimResult {
  rules: boolean;
  steps: SimStep[] | null;
  requesterLimit: number | null;
}

const DOCS = [...new Set<string>([...APPROVAL_RULE_DOC_KEYS, ...APPROVAL_LIMIT_DOC_KEYS])];
const hasRules = (doc: string) => (APPROVAL_RULE_DOC_KEYS as string[]).includes(doc);
const hasLimits = (doc: string) => (APPROVAL_LIMIT_DOC_KEYS as string[]).includes(doc);
const valueLabel = (doc: string) =>
  (APPROVAL_RULE_DOCS as Record<string, { value: readonly [string, string] | null }>)[doc]?.value ?? null;

/** Pengaturan › Aturan Persetujuan: alur tahap per jenis dokumen, batas wewenang, simulasi. */
export default function ApprovalRulesPage() {
  const { l, locale } = useI18n();
  const me = useMe();
  const editable = can(me.permissions, "approval.manage");
  const [doc, setDoc] = useState<string>("purchase_order");
  const [users, setUsers] = useState<Option[]>([]);
  const [roles, setRoles] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [limits, setLimits] = useState<LimitRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sim, setSim] = useState({ value: "", userId: "" });
  const [simResult, setSimResult] = useState<SimResult | null>(null);

  useEffect(() => {
    api<Option[]>("/users/options").then(setUsers, () => setUsers([]));
    api<Option[]>("/roles/options").then(setRoles, () => setRoles([]));
    api<Option[]>("/approval-categories").then(setCategories, () => setCategories([]));
  }, []);

  const load = useCallback(async () => {
    setErrors({});
    setError(null);
    setNotice(null);
    setSimResult(null);
    try {
      if (hasRules(doc)) {
        const all = await api<
          Record<
            string,
            {
              approverType: ApproverType;
              userId: string | null;
              roleId: string | null;
              minValue: string | null;
              label: string | null;
            }[]
          >
        >("/approval-rules");
        setSteps(
          (all[doc] ?? []).map((r) => ({
            approverType: r.approverType,
            userId: r.userId ?? "",
            roleId: r.roleId ?? "",
            minValue: r.minValue ? String(Number(r.minValue)) : "",
            label: r.label ?? "",
          })),
        );
      } else setSteps([]);
      if (hasLimits(doc)) {
        const rows = await api<
          {
            userId: string | null;
            roleId: string | null;
            categoryId: string | null;
            maxAmount: string | null;
            note: string | null;
          }[]
        >(`/approval-limits?docType=${doc}`);
        setLimits(
          rows.map((r) => ({
            who: r.userId ? `u:${r.userId}` : r.roleId ? `r:${r.roleId}` : "",
            categoryId: r.categoryId ?? "",
            maxAmount: r.maxAmount ? String(Number(r.maxAmount)) : "",
            note: r.note ?? "",
          })),
        );
      } else setLimits([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [doc]);
  useEffect(() => {
    void load();
  }, [load]);

  const fail = (e: unknown) => {
    if (e instanceof ApiError) setErrors(e.fieldErrors);
    setError(e instanceof Error ? e.message : String(e));
  };
  async function saveSteps() {
    setErrors({});
    setError(null);
    try {
      await api(`/approval-rules/${doc}`, {
        method: "PUT",
        body: {
          steps: steps.map((s) => ({
            approverType: s.approverType,
            userId: s.userId || null,
            roleId: s.roleId || null,
            minValue: s.minValue || null,
            label: s.label || null,
          })),
        },
      });
      setNotice(l("Alur persetujuan disimpan.", "Approval flow saved."));
    } catch (e) {
      fail(e);
    }
  }
  async function saveLimits() {
    setErrors({});
    setError(null);
    try {
      await api(`/approval-limits/${doc}`, {
        method: "PUT",
        body: {
          limits: limits.map((x) => ({
            userId: x.who.startsWith("u:") ? x.who.slice(2) : null,
            roleId: x.who.startsWith("r:") ? x.who.slice(2) : null,
            categoryId: x.categoryId || null,
            maxAmount: x.maxAmount || null,
            note: x.note || null,
          })),
        },
      });
      setNotice(l("Batas wewenang disimpan.", "Approval limits saved."));
    } catch (e) {
      fail(e);
    }
  }
  async function simulate() {
    setError(null);
    try {
      setSimResult(
        await api<SimResult>("/approval-rules/simulate", {
          method: "POST",
          body: { docType: doc, value: sim.value || null, userId: sim.userId || null },
        }),
      );
    } catch (e) {
      fail(e);
    }
  }

  const setStep = (i: number, patch: Partial<StepRow>) =>
    setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...steps];
    const [row] = next.splice(i, 1);
    next.splice(i + d, 0, row!);
    setSteps(next);
  };
  const setLimit = (i: number, patch: Partial<LimitRow>) =>
    setLimits(limits.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const err = (k: string) => errors[k] && <small className="error">{errors[k]}</small>;
  const unit = valueLabel(doc);

  return (
    <>
      <section className="panel">
        <header className="toolbar">
          <h1>{l("Aturan Persetujuan", "Approval Rules")}</h1>
        </header>
        <p className="muted">
          {l(
            "Atur siapa yang menyetujui tiap jenis dokumen dan sampai nominal berapa. Jenis dokumen tanpa tahap memakai perilaku bawaan (atasan → HR menurut Pengaturan Payroll; PO menurut batas wewenang). Aturan berlaku untuk dokumen yang diajukan setelah disimpan.",
            "Set who approves each document type and up to what amount. Document types without steps use the default behaviour (manager → HR per Payroll Settings; purchase orders per approval limits). Rules apply to documents submitted after saving.",
          )}
        </p>
        {!editable && (
          <p className="notice">
            {l(
              "Butuh hak Kelola aturan persetujuan untuk mengubah.",
              "Requires Manage approval rules to edit.",
            )}
          </p>
        )}
      </section>

      <nav className="tabs">
        {DOCS.map((d) => (
          <button key={d} type="button" className={doc === d ? "active" : ""} onClick={() => setDoc(d)}>
            {l(...docLabel(d))}
          </button>
        ))}
      </nav>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      {hasRules(doc) && (
        <section className="panel">
          <h2>{l("Alur tahap", "Approval steps")}</h2>
          <fieldset disabled={!editable} className="bare">
            <div className="table-wrap">
              <table className="lines">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{l("Penyetuju", "Approver")}</th>
                    <th>{l("Pengguna / peran", "User / role")}</th>
                    {unit && (
                      <th>
                        {l("Berlaku bila", "Applies when")} {l(...unit).toLowerCase()} ≥
                      </th>
                    )}
                    <th>{l("Label", "Label")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {steps.map((s, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>
                        <select
                          aria-label={l("Penyetuju", "Approver")}
                          value={s.approverType}
                          onChange={(e) => setStep(i, { approverType: e.target.value as ApproverType })}
                        >
                          {(Object.keys(APPROVER_TYPE_LABELS) as ApproverType[]).map((t) => (
                            <option key={t} value={t}>
                              {l(...(APPROVER_TYPE_LABELS[t] as readonly [string, string]))}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {s.approverType === "user" && (
                          <select
                            aria-label={l("Pengguna", "User")}
                            value={s.userId}
                            onChange={(e) => setStep(i, { userId: e.target.value })}
                          >
                            <option value="">—</option>
                            {users.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                          </select>
                        )}
                        {s.approverType === "role" && (
                          <select
                            aria-label={l("Peran", "Role")}
                            value={s.roleId}
                            onChange={(e) => setStep(i, { roleId: e.target.value })}
                          >
                            <option value="">—</option>
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        )}
                        {err(`steps.${i}.userId`)}
                        {err(`steps.${i}.roleId`)}
                      </td>
                      {unit && (
                        <td>
                          <input
                            type="number"
                            min="0"
                            aria-label={l("Batas minimal", "Minimum value")}
                            placeholder={l("selalu", "always")}
                            value={s.minValue}
                            onChange={(e) => setStep(i, { minValue: e.target.value })}
                          />
                        </td>
                      )}
                      <td>
                        <input
                          aria-label={l("Label", "Label")}
                          placeholder={l("mis. Direktur", "e.g. Director")}
                          value={s.label}
                          onChange={(e) => setStep(i, { label: e.target.value })}
                        />
                      </td>
                      <td className="nowrap">
                        <button
                          type="button"
                          className="link"
                          aria-label={l("Naikkan", "Move up")}
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="link"
                          aria-label={l("Turunkan", "Move down")}
                          disabled={i === steps.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="link"
                          onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                        >
                          {l("Hapus", "Remove")}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!steps.length && (
                    <tr>
                      <td colSpan={6} className="muted">
                        {l(
                          "Belum ada tahap — memakai perilaku bawaan.",
                          "No steps — default behaviour applies.",
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {editable && (
              <div className="toolbar">
                <button
                  type="button"
                  onClick={() =>
                    setSteps([
                      ...steps,
                      { approverType: "manager", userId: "", roleId: "", minValue: "", label: "" },
                    ])
                  }
                >
                  {l("Tambah tahap", "Add step")}
                </button>
                <button type="button" className="primary" onClick={saveSteps}>
                  {l("Simpan alur", "Save flow")}
                </button>
              </div>
            )}
          </fieldset>
        </section>
      )}

      {hasLimits(doc) && (
        <section className="panel">
          <h2>{l("Batas wewenang", "Approval limits")}</h2>
          <p className="muted">
            {doc === "purchase_order"
              ? l(
                  "Nominal maksimum PO yang boleh dibuat tanpa persetujuan dan yang boleh disetujui (mata uang perusahaan). Batas pengguna menimpa peran; beberapa peran → yang terbesar. Tanpa batas default di sini dipakai batas di Pengaturan Akuntansi.",
                  "Maximum purchase order amount one may confirm without approval and may approve (company currency). User limits override roles; several roles → the largest. Without a default here, the Accounting Settings limit applies.",
                )
              : l(
                  "Nominal maksimum yang boleh disetujui pada tahap terakhir. Batas pengguna menimpa peran; beberapa peran → yang terbesar.",
                  "Maximum amount one may approve at the final step. User limits override roles; several roles → the largest.",
                )}
          </p>
          <fieldset disabled={!editable} className="bare">
            <div className="table-wrap">
              <table className="lines">
                <thead>
                  <tr>
                    <th>{l("Berlaku untuk", "Applies to")}</th>
                    {doc === "approval_request" && <th>{l("Kategori", "Category")}</th>}
                    <th>{l("Nominal maksimum", "Maximum amount")}</th>
                    <th>{l("Catatan", "Note")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {limits.map((x, i) => (
                    <tr key={i}>
                      <td>
                        <select
                          aria-label={l("Berlaku untuk", "Applies to")}
                          value={x.who}
                          onChange={(e) => setLimit(i, { who: e.target.value })}
                        >
                          <option value="">
                            {l("Default perusahaan (semua)", "Company default (everyone)")}
                          </option>
                          <optgroup label={l("Peran", "Roles")}>
                            {roles.map((r) => (
                              <option key={r.id} value={`r:${r.id}`}>
                                {r.name}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label={l("Pengguna", "Users")}>
                            {users.map((u) => (
                              <option key={u.id} value={`u:${u.id}`}>
                                {u.name}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                        {err(`limits.${i}.roleId`)}
                        {err(`limits.${i}.userId`)}
                      </td>
                      {doc === "approval_request" && (
                        <td>
                          <select
                            aria-label={l("Kategori", "Category")}
                            value={x.categoryId}
                            onChange={(e) => setLimit(i, { categoryId: e.target.value })}
                          >
                            <option value="">{l("Semua kategori", "All categories")}</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      <td>
                        <input
                          type="number"
                          min="0"
                          aria-label={l("Nominal maksimum", "Maximum amount")}
                          placeholder={l("tanpa batas", "unlimited")}
                          value={x.maxAmount}
                          onChange={(e) => setLimit(i, { maxAmount: e.target.value })}
                        />
                        {err(`limits.${i}.maxAmount`)}
                      </td>
                      <td>
                        <input
                          aria-label={l("Catatan", "Note")}
                          value={x.note}
                          onChange={(e) => setLimit(i, { note: e.target.value })}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="link"
                          onClick={() => setLimits(limits.filter((_, j) => j !== i))}
                        >
                          {l("Hapus", "Remove")}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!limits.length && (
                    <tr>
                      <td colSpan={5} className="muted">
                        {l("Belum ada batas wewenang.", "No approval limits yet.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {editable && (
              <div className="toolbar">
                <button
                  type="button"
                  onClick={() => setLimits([...limits, { who: "", categoryId: "", maxAmount: "", note: "" }])}
                >
                  {l("Tambah batas", "Add limit")}
                </button>
                <button type="button" className="primary" onClick={saveLimits}>
                  {l("Simpan batas", "Save limits")}
                </button>
              </div>
            )}
          </fieldset>
          {doc === "approval_request" && (
            <p className="muted">
              {l("Penyetuju per kategori diatur di", "Approvers per category are set in")}{" "}
              <Link href="/hr/approval-categories">{l("Kategori Persetujuan", "Approval Categories")}</Link>.
            </p>
          )}
        </section>
      )}

      {hasRules(doc) && editable && (
        <section className="panel">
          <h2>{l("Simulasi", "Simulation")}</h2>
          <div className="grid-2">
            <label className="field">
              <span>{l("Diajukan oleh", "Submitted by")}</span>
              <select value={sim.userId} onChange={(e) => setSim({ ...sim, userId: e.target.value })}>
                <option value="">—</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            {unit && (
              <label className="field">
                <span>{l(...unit)}</span>
                <input
                  type="number"
                  min="0"
                  value={sim.value}
                  onChange={(e) => setSim({ ...sim, value: e.target.value })}
                />
              </label>
            )}
          </div>
          <div className="toolbar">
            <button type="button" onClick={simulate}>
              {l("Simulasikan", "Simulate")}
            </button>
          </div>
          {simResult &&
            (simResult.steps === null ? (
              <p className="muted">
                {l(
                  "Belum ada aturan tersimpan untuk dokumen ini — memakai perilaku bawaan.",
                  "No saved rules for this document — default behaviour applies.",
                )}
              </p>
            ) : simResult.steps.length === 0 ? (
              <p className="notice">{l("Tidak perlu persetujuan.", "No approval needed.")}</p>
            ) : (
              <ol>
                {simResult.steps.map((s) => (
                  <li key={s.step}>
                    <strong>{s.label ?? s.approver ?? l("Admin dokumen", "Document admin")}</strong>
                    {s.label &&
                      ` — ${
                        s.approver ??
                        (doc === "purchase_order"
                          ? l("Pemegang hak Setujui PO", "Holders of Approve PO")
                          : l("HR", "HR"))
                      }`}
                    {s.holders.length > 0 && <span className="muted"> ({s.holders.join(", ")})</span>}
                  </li>
                ))}
              </ol>
            ))}
          {simResult && simResult.requesterLimit !== null && (
            <p className="muted">
              {l("Batas wewenang pengaju", "Submitter's approval limit")}:{" "}
              {money(simResult.requesterLimit, locale, 0)}
            </p>
          )}
        </section>
      )}
    </>
  );
}
