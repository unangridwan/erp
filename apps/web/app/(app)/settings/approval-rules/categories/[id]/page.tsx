"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  FIELD_LABEL,
  type FieldKey,
  type FieldMode,
} from "../../../../../../components/hr/approval-request-form";
import { useMe } from "../../../../../../components/me-context";
import { api, ApiError } from "../../../../../../lib/api";
import { useI18n } from "../../../../../../lib/i18n";
import { can } from "../../../../../../lib/resources";
import { ask } from "../../../../../../components/feedback";

interface Approver {
  /** `u:<id>` (pengguna) atau `r:<id>` (peran). */
  who: string;
  label: string;
  required: boolean;
  minAmount: string;
}
interface Form {
  code: string;
  name: string;
  description: string;
  prefix: string;
  fields: Partial<Record<FieldKey, FieldMode>>;
  managerFirst: boolean;
  approvalMode: "sequential" | "parallel";
  minApprovals: number;
  sequence: number;
  active: boolean;
  approvers: Approver[];
}

const EMPTY: Form = {
  code: "",
  name: "",
  description: "",
  prefix: "",
  fields: { description: "required" },
  managerFirst: true,
  approvalMode: "sequential",
  minApprovals: 0,
  sequence: 100,
  active: true,
  approvers: [],
};

/** Ubah kategori persetujuan: field wajib/opsional, alur, penyetuju & batas nominal. */
export default function ApprovalCategoryPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const { l, tx } = useI18n();
  const me = useMe();
  const readOnly = !can(me.permissions, "approval.manage") && !can(me.permissions, "hr.manage");
  const [usedBy, setUsedBy] = useState<readonly [string, string] | null>(null);
  const [form, setForm] = useState<Form | null>(isNew ? EMPTY : null);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<{ id: string; name: string }[]>("/users/options").then(setUsers, () => setUsers([]));
    api<{ id: string; name: string }[]>("/roles/options").then(setRoles, () => setRoles([]));
    if (!isNew)
      api<
        Omit<Form, "approvers"> & {
          system?: boolean;
          usedBy?: [string, string] | null;
          approvers: (Omit<Approver, "who" | "label" | "minAmount"> & {
            userId: string | null;
            roleId: string | null;
            label: string | null;
            minAmount: string | null;
          })[];
        }
      >(`/approval-categories/${id}`).then(
        ({ system, usedBy: by, ...c }) => {
          setUsedBy(system && by ? by : null);
          setForm({
            ...c,
            description: c.description ?? "",
            approvers: c.approvers.map((a) => ({
              who: a.userId ? `u:${a.userId}` : `r:${a.roleId}`,
              label: a.label ?? "",
              required: a.required,
              minAmount: a.minAmount ? String(Number(a.minAmount)) : "",
            })),
          });
        },
        (e: Error) => setError(e.message),
      );
  }, [id, isNew]);

  if (!form) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f!, ...patch }));
  const setApprover = (i: number, patch: Partial<Approver>) =>
    set({ approvers: form.approvers.map((a, j) => (j === i ? { ...a, ...patch } : a)) });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setErrors({});
    setNotice(null);
    try {
      const saved = await api<{ id: string }>(isNew ? "/approval-categories" : `/approval-categories/${id}`, {
        method: isNew ? "POST" : "PUT",
        body: {
          ...form,
          description: form.description || null,
          approvers: form.approvers.map((a) => ({
            userId: a.who.startsWith("u:") ? a.who.slice(2) : null,
            roleId: a.who.startsWith("r:") ? a.who.slice(2) : null,
            label: a.label || null,
            required: a.required,
            minAmount: a.minAmount || null,
          })),
        },
      });
      if (isNew) router.replace(`/settings/approval-rules/categories/${saved.id}`);
      else setNotice(l("Tersimpan.", "Saved."));
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  async function remove() {
    if (!(await ask(l("Hapus kategori ini?", "Delete this category?")))) return;
    try {
      await api(`/approval-categories/${id}`, { method: "DELETE" });
      router.push("/settings/approval-rules?tab=categories");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  const err = (k: string) => errors[k] && <small className="error">{errors[k]}</small>;

  return (
    <form className="panel" onSubmit={save}>
      <header className="toolbar">
        <h1>{isNew ? l("Kategori baru", "New category") : `${form.code} — ${form.name}`}</h1>
        {!readOnly && (
          <>
            <button type="submit" className="primary">
              {l("Simpan", "Save")}
            </button>
            {!isNew && !usedBy && (
              <button type="button" className="link" onClick={remove}>
                {l("Hapus", "Delete")}
              </button>
            )}
          </>
        )}
      </header>
      <p>
        <Link href="/settings/approval-rules?tab=categories">
          ← {l("Aturan Persetujuan", "Approval Rules")}
        </Link>
      </p>
      {usedBy && (
        <p className="muted">
          {l("Kategori sistem — dipakai oleh", "System category — used by")}{" "}
          <strong>{l(usedBy[0], usedBy[1])}</strong>.{" "}
          {l(
            "Kode dan prefix tetap; atur penyetuju dan batas nominal di bawah.",
            "The code and prefix are fixed; set approvers and amount thresholds below.",
          )}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      <fieldset
        disabled={readOnly}
        className="stack-wide"
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <div className="grid-2">
          <label className="field">
            <span>{l("Kode", "Code")} *</span>
            <input
              value={form.code}
              readOnly={!!usedBy}
              className={usedBy ? "locked" : undefined}
              onChange={(e) => set({ code: e.target.value.toUpperCase() })}
              required
            />
            {err("code")}
          </label>
          <label className="field">
            <span>{l("Nama", "Name")} *</span>
            <input value={form.name} onChange={(e) => set({ name: e.target.value })} required />
            {err("name")}
          </label>
          <label className="field">
            <span>{l("Prefix nomor", "Number prefix")} *</span>
            <input
              value={form.prefix}
              readOnly={!!usedBy}
              className={usedBy ? "locked" : undefined}
              onChange={(e) => set({ prefix: e.target.value })}
              required
            />
            <small className="muted">
              {l("Contoh: FPK → FPK/2026/0001", "Example: FPK → FPK/2026/0001")}
            </small>
          </label>
          <label className="field">
            <span>{l("Urutan", "Sequence")}</span>
            <input
              type="number"
              min="0"
              value={form.sequence}
              onChange={(e) => set({ sequence: Number(e.target.value) })}
            />
          </label>
        </div>
        <label className="field">
          <span>{l("Deskripsi", "Description")}</span>
          <textarea
            rows={2}
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>{l("Alur persetujuan", "Approval flow")}</span>
            <select
              value={form.approvalMode}
              onChange={(e) => set({ approvalMode: e.target.value as Form["approvalMode"] })}
            >
              <option value="sequential">{l("Berurutan (berjenjang)", "Sequential (tiered)")}</option>
              <option value="parallel">{l("Paralel", "Parallel")}</option>
            </select>
          </label>
          <label className="field">
            <span>{l("Minimum persetujuan (0 = semua)", "Minimum approvals (0 = all)")}</span>
            <input
              type="number"
              min="0"
              max="20"
              value={form.minApprovals}
              onChange={(e) => set({ minApprovals: Number(e.target.value) })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.managerFirst}
              onChange={(e) => set({ managerFirst: e.target.checked })}
            />
            {l("Atasan langsung pemohon menyetujui lebih dulu", "The requester's manager approves first")}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set({ active: e.target.checked })}
            />
            {l("Aktif", "Active")}
          </label>
        </div>

        <h2>{l("Field permintaan", "Request fields")}</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              {(Object.keys(FIELD_LABEL) as FieldKey[]).map((k) => (
                <tr key={k}>
                  <td>{tx(FIELD_LABEL[k])}</td>
                  <td>
                    <select
                      aria-label={tx(FIELD_LABEL[k])}
                      value={form.fields[k] ?? "none"}
                      onChange={(e) => set({ fields: { ...form.fields, [k]: e.target.value as FieldMode } })}
                    >
                      <option value="required">{l("Wajib", "Required")}</option>
                      <option value="optional">{l("Opsional", "Optional")}</option>
                      <option value="none">{l("Tidak ada", "None")}</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>{l("Penyetuju & batas nominal", "Approvers & amount thresholds")}</h2>
        <p className="muted">
          {l(
            "Contoh matriks otorisasi: Manajer (tanpa batas) → Direktur (≥ Rp10.000.000) → Direksi Holding (≥ Rp100.000.000).",
            "Authority matrix example: Manager (no threshold) → Director (≥ IDR 10,000,000) → Holding Board (≥ IDR 100,000,000).",
          )}
        </p>
        <div className="table-wrap">
          <table className="lines">
            <thead>
              <tr>
                <th>#</th>
                <th>{l("User / peran", "User / role")}</th>
                <th>{l("Label", "Label")}</th>
                <th>{l("Wajib", "Required")}</th>
                <th>{l("Berlaku bila nominal ≥", "Applies when amount ≥")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {form.approvers.map((a, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <select
                      aria-label={l("User / peran", "User / role")}
                      value={a.who}
                      onChange={(e) => setApprover(i, { who: e.target.value })}
                      required
                    >
                      <option value="">—</option>
                      <optgroup label={l("Pengguna", "Users")}>
                        {users.map((u) => (
                          <option key={u.id} value={`u:${u.id}`}>
                            {u.name}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label={l("Peran (semua pemegangnya)", "Role (any holder)")}>
                        {roles.map((r) => (
                          <option key={r.id} value={`r:${r.id}`}>
                            {r.name}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    {err(`approvers.${i}.userId`)}
                  </td>
                  <td>
                    <input
                      aria-label={l("Label", "Label")}
                      value={a.label}
                      placeholder={l("mis. Direktur", "e.g. Director")}
                      onChange={(e) => setApprover(i, { label: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={l("Wajib", "Required")}
                      checked={a.required}
                      onChange={(e) => setApprover(i, { required: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      aria-label={l("Batas nominal", "Amount threshold")}
                      value={a.minAmount}
                      placeholder={l("selalu", "always")}
                      onChange={(e) => setApprover(i, { minAmount: e.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={() => set({ approvers: form.approvers.filter((_, j) => j !== i) })}
                    >
                      {l("Hapus", "Remove")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <button
            type="button"
            onClick={() =>
              set({
                approvers: [...form.approvers, { who: "", label: "", required: true, minAmount: "" }],
              })
            }
          >
            {l("Tambah penyetuju", "Add approver")}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
