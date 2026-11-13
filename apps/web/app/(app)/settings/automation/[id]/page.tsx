"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ACTIVITY_TYPES_AUTOMATION,
  AUTOMATION_ACTION_LABEL,
  AUTOMATION_TRIGGER_LABEL,
  AUTOMATION_TRIGGERS,
  CONDITION_OP_LABEL,
  CONDITION_OPS,
  CUSTOM_FIELD_MODELS,
  type AutomationAction,
  type AutomationCondition,
  type AutomationField,
  type AutomationTrigger,
  type ConditionOp,
  type CustomFieldModel,
} from "@erp/shared";
import { ask, toast } from "../../../../../components/feedback";
import { api, ApiError } from "../../../../../lib/api";
import { useI18n } from "../../../../../lib/i18n";
import { RUN_STATUS } from "../../../../../components/automation/run-status";

type ActionType = AutomationAction["type"];
interface Option {
  id: string;
  name: string;
}
interface Run {
  id: string;
  resId: string | null;
  trigger: string;
  status: "success" | "failed" | "skipped";
  message: string | null;
  results: { type: string; ok: boolean; detail?: string }[];
  createdAt: string;
}
interface Rule {
  id?: string;
  name: string;
  description: string;
  model: CustomFieldModel;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  onlyWhenChanges: boolean;
  dateField: string;
  offsetDays: number;
  frequency: "daily" | "weekly" | "monthly";
  hour: number;
  weekday: number;
  monthday: number;
  actions: AutomationAction[];
  active: boolean;
  hasWebhookSecret?: boolean;
}

const MODELS = Object.keys(CUSTOM_FIELD_MODELS) as CustomFieldModel[];
const ACTION_TYPES = Object.keys(AUTOMATION_ACTION_LABEL) as ActionType[];
const NO_VALUE: ConditionOp[] = ["empty", "notEmpty"];
const WEEKDAYS: [string, string][] = [
  ["Senin", "Monday"],
  ["Selasa", "Tuesday"],
  ["Rabu", "Wednesday"],
  ["Kamis", "Thursday"],
  ["Jumat", "Friday"],
  ["Sabtu", "Saturday"],
  ["Minggu", "Sunday"],
];
const ACTIVITY_LABEL: Record<string, [string, string]> = {
  todo: ["Tugas", "To-do"],
  call: ["Telepon", "Call"],
  meeting: ["Rapat", "Meeting"],
  email: ["Email", "Email"],
};

const EMPTY: Rule = {
  name: "",
  description: "",
  model: "sale_order",
  trigger: "updated",
  conditions: [],
  onlyWhenChanges: true,
  dateField: "",
  offsetDays: 0,
  frequency: "daily",
  hour: 7,
  weekday: 1,
  monthday: 1,
  actions: [],
  active: true,
};

function newAction(type: ActionType): AutomationAction {
  switch (type) {
    case "notify":
      return { type, users: [], roleIds: [], responsible: true, creator: false, title: "{{name}}", body: "" };
    case "email":
      return { type, to: "partner", address: null, subject: "{{name}}", body: "" };
    case "set_field":
      return { type, field: "", value: "" };
    case "activity":
      return {
        type,
        activityType: "todo",
        summary: "{{name}}",
        note: "",
        dueInDays: 1,
        assignTo: "responsible",
        userId: null,
      };
    case "approval":
      return { type, categoryId: "", description: "{{name}}", amountField: null };
    case "webhook":
      return { type, url: "" };
  }
}

/** Editor aturan otomatis: 1. Kapan (pemicu) → 2. Jika (syarat) → 3. Lakukan (aksi), lalu uji coba & log. */
export default function AutomationRulePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { l, locale } = useI18n();
  const i = locale === "id" ? 0 : 1;
  const [id, setId] = useState(params.id === "new" ? null : params.id);
  const [rule, setRule] = useState<Rule | null>(params.id === "new" ? EMPTY : null);
  const [fields, setFields] = useState<AutomationField[]>([]);
  const [responsible, setResponsible] = useState<string | null>(null);
  const [users, setUsers] = useState<Option[]>([]);
  const [roles, setRoles] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [records, setRecords] = useState<{ id: string; label: string }[]>([]);
  const [q, setQ] = useState("");
  const [resId, setResId] = useState("");
  const fmt = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
    dateStyle: "short",
    timeStyle: "medium",
  });

  useEffect(() => {
    api<Option[]>("/users/options").then(setUsers, () => setUsers([]));
    api<Option[]>("/roles/options").then(setRoles, () => setRoles([]));
    api<Option[]>("/approval-categories?active=1").then(setCategories, () => setCategories([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    api<Rule & { description: string | null; dateField: string | null }>(`/automation-rules/${id}`)
      .then((r) =>
        setRule({
          ...EMPTY,
          ...r,
          description: r.description ?? "",
          dateField: r.dateField ?? "",
          frequency: r.frequency ?? "daily",
          weekday: r.weekday ?? 1,
          monthday: r.monthday ?? 1,
        }),
      )
      .catch((e: Error) => toast.error(e.message));
  }, [id]);

  const model = rule?.model;
  useEffect(() => {
    if (!model) return;
    api<{ fields: AutomationField[]; responsible: string | null }>(`/automation-rules/fields?model=${model}`)
      .then((r) => {
        setFields(r.fields);
        setResponsible(r.responsible);
      })
      .catch(() => setFields([]));
  }, [model]);

  const loadRuns = useCallback(() => {
    if (id) api<Run[]>(`/automation-rules/${id}/runs`).then(setRuns, () => setRuns([]));
  }, [id]);
  useEffect(loadRuns, [loadRuns]);

  useEffect(() => {
    if (!id) return;
    const t = setTimeout(() => {
      api<{ id: string; label: string }[]>(`/automation-rules/${id}/records?q=${encodeURIComponent(q)}`).then(
        setRecords,
        () => setRecords([]),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [id, q]);

  if (!rule) return <p className="muted">{l("Memuat…", "Loading…")}</p>;

  const set = <K extends keyof Rule>(k: K, v: Rule[K]) => setRule((r) => (r ? { ...r, [k]: v } : r));
  const setAction = (idx: number, patch: Partial<AutomationAction>) =>
    set(
      "actions",
      rule.actions.map((a, j) => (j === idx ? ({ ...a, ...patch } as AutomationAction) : a)),
    );
  const setCond = (idx: number, patch: Partial<AutomationCondition>) =>
    set(
      "conditions",
      rule.conditions.map((c, j) => (j === idx ? { ...c, ...patch } : c)),
    );
  const err = (k: string) => (errors[k] ? <small className="error">{errors[k]}</small> : null);
  const fieldLabel = (f: AutomationField) => f.label[i];
  const fieldOf = (key: string) => fields.find((f) => f.key === key);
  const dateFields = fields.filter((f) => f.type === "date");
  const numberFields = fields.filter((f) => f.type === "number");
  const settable = fields.filter((f) => f.key.startsWith("custom.") || f.key === responsible);
  const hasPartner = [
    "partner",
    "crm_lead",
    "sale_order",
    "purchase_order",
    "account_move",
    "stock_picking",
  ].includes(rule.model);
  const placeholders = fields.map((f) => `{{${f.key}}}`).concat(["{{link}}", "{{rule}}"]);

  async function save() {
    if (!rule) return;
    setBusy(true);
    setErrors({});
    const body = {
      name: rule.name,
      description: rule.description || null,
      model: rule.model,
      trigger: rule.trigger,
      conditions: rule.conditions,
      onlyWhenChanges: rule.onlyWhenChanges,
      dateField: rule.dateField || null,
      offsetDays: Number(rule.offsetDays) || 0,
      frequency: rule.trigger === "scheduled" ? rule.frequency : null,
      hour: Number(rule.hour) || 0,
      weekday: rule.weekday,
      monthday: rule.monthday,
      actions: rule.actions,
      active: rule.active,
    };
    try {
      const saved = await api<Rule & { id: string; webhookSecret: string | null }>(
        id ? `/automation-rules/${id}` : "/automation-rules",
        { method: id ? "PUT" : "POST", body },
      );
      if (saved.webhookSecret) setSecret(saved.webhookSecret);
      toast.success(l("Aturan disimpan.", "Rule saved."));
      setRule((r) => (r ? { ...r, hasWebhookSecret: saved.hasWebhookSecret } : r));
      if (!id) {
        // Ganti URL tanpa memuat ulang agar rahasia webhook yang tampil sekali tidak hilang.
        window.history.replaceState(null, "", `/settings/automation/${saved.id}`);
        setId(saved.id);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setErrors(e.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!id || !rule) return;
    const ok = await ask({
      title: l("Hapus aturan?", "Delete rule?"),
      message: l(
        `Aturan "${rule.name}" dan lognya akan dihapus.`,
        `"${rule.name}" and its log will be deleted.`,
      ),
      confirmLabel: l("Hapus", "Delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/automation-rules/${id}`, { method: "DELETE" });
      router.push("/settings/automation");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function run() {
    if (!id || !rule) return;
    const event = rule.trigger === "created" || rule.trigger === "updated";
    if (event && !resId) return toast.error(l("Pilih data untuk diuji.", "Pick a record to test."));
    const ok = await ask({
      title: l("Jalankan sekarang?", "Run now?"),
      message: l(
        "Aksi benar-benar dijalankan (notifikasi, email, perubahan data, webhook). Simpan perubahan aturan dulu.",
        "Actions really run (notifications, email, data changes, webhook). Save rule changes first.",
      ),
      confirmLabel: l("Jalankan", "Run"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{ executed: number; status?: string; message?: string | null }>(
        `/automation-rules/${id}/run`,
        { method: "POST", body: resId ? { resId } : {} },
      );
      if (r.status === "failed") toast.error(r.message ?? l("Gagal", "Failed"));
      else toast.success(l(`${r.executed} data diproses.`, `${r.executed} record(s) processed.`));
      loadRuns();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    if (!id) return;
    const ok = await ask({
      title: l("Buat ulang rahasia webhook?", "Regenerate webhook secret?"),
      message: l(
        "Penerima webhook harus memakai rahasia baru untuk memverifikasi tanda tangan.",
        "The webhook receiver must use the new secret to verify signatures.",
      ),
      confirmLabel: l("Buat ulang", "Regenerate"),
    });
    if (!ok) return;
    const r = await api<{ webhookSecret: string }>(`/automation-rules/${id}/webhook-secret`, {
      method: "POST",
    });
    setSecret(r.webhookSecret);
  }

  const multi = (selected: string[], options: Option[], onChange: (v: string[]) => void, label: string) => (
    <select
      multiple
      aria-label={label}
      value={selected}
      size={Math.min(5, Math.max(2, options.length))}
      onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );

  const valueInput = (c: AutomationCondition, idx: number) => {
    const f = fieldOf(c.field);
    if (NO_VALUE.includes(c.op)) return null;
    const common = {
      "aria-label": l("Nilai", "Value"),
      value: c.value,
    };
    if (f?.options && c.op !== "in" && c.op !== "contains")
      return (
        <select {...common} onChange={(e) => setCond(idx, { value: e.target.value })}>
          <option value="">—</option>
          {f.options.map(([v, lab]) => (
            <option key={v} value={v}>
              {lab[i]}
            </option>
          ))}
        </select>
      );
    if (f?.type === "boolean")
      return (
        <select {...common} onChange={(e) => setCond(idx, { value: e.target.value })}>
          <option value="">—</option>
          <option value="true">{l("Ya", "Yes")}</option>
          <option value="false">{l("Tidak", "No")}</option>
        </select>
      );
    if (f?.type === "user")
      return (
        <select {...common} onChange={(e) => setCond(idx, { value: e.target.value })}>
          <option value="">—</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      );
    return (
      <input
        {...common}
        type={f?.type === "number" ? "number" : f?.type === "date" ? "date" : "text"}
        placeholder={c.op === "in" ? l("nilai1, nilai2", "value1, value2") : ""}
        onChange={(e) => setCond(idx, { value: e.target.value })}
      />
    );
  };

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <nav className="breadcrumb">
            <Link href="/settings/automation">{l("Aturan Otomatis", "Automation Rules")}</Link> /{" "}
            {rule.name || l("Baru", "New")}
          </nav>
        </div>
        <div className="cp-right">
          {id && (
            <button type="button" className="danger" onClick={remove} disabled={busy}>
              {l("Hapus", "Delete")}
            </button>
          )}
          <button type="button" className="primary" onClick={save} disabled={busy} aria-busy={busy}>
            {l("Simpan", "Save")}
          </button>
        </div>
      </header>

      {secret && (
        <div className="notice secret-box" role="status">
          {l(
            "Rahasia webhook (simpan sekarang, hanya tampil sekali). Tanda tangan dikirim di header X-ERP-Signature: t=<unix>,v1=HMAC-SHA256(rahasia, t + '.' + body).",
            "Webhook secret (save it now, shown once). The signature is sent in the X-ERP-Signature header: t=<unix>,v1=HMAC-SHA256(secret, t + '.' + body).",
          )}
          <pre className="secret">{secret}</pre>
        </div>
      )}

      <section className="panel">
        <div className="fields">
          <label className="field" data-field="name">
            <span>{l("Nama aturan", "Rule name")} *</span>
            <input value={rule.name} maxLength={120} onChange={(e) => set("name", e.target.value)} />
            {err("name")}
          </label>
          <label className="field" data-field="description">
            <span>{l("Keterangan", "Description")}</span>
            <input
              value={rule.description}
              maxLength={500}
              onChange={(e) => set("description", e.target.value)}
            />
          </label>
          <label className="field check">
            <span>{l("Aktif", "Active")}</span>
            <input type="checkbox" checked={rule.active} onChange={(e) => set("active", e.target.checked)} />
          </label>
        </div>
      </section>

      <section className="panel automation-step">
        <h2>
          <span className="step-no">1</span> {l("Kapan", "When")}
        </h2>
        <div className="fields">
          <label className="field" data-field="model">
            <span>{l("Data", "Record")} *</span>
            <select
              value={rule.model}
              onChange={(e) =>
                setRule((r) =>
                  r ? { ...r, model: e.target.value as CustomFieldModel, conditions: [], dateField: "" } : r,
                )
              }
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {CUSTOM_FIELD_MODELS[m].label[i]}
                </option>
              ))}
            </select>
          </label>
          <label className="field" data-field="trigger">
            <span>{l("Pemicu", "Trigger")} *</span>
            <select
              value={rule.trigger}
              onChange={(e) => set("trigger", e.target.value as AutomationTrigger)}
            >
              {AUTOMATION_TRIGGERS.map((t) => (
                <option key={t} value={t}>
                  {AUTOMATION_TRIGGER_LABEL[t][i]}
                </option>
              ))}
            </select>
          </label>
          {rule.trigger === "updated" && (
            <label className="field check">
              <span>
                {l(
                  "Hanya saat syarat baru terpenuhi (mis. status berubah menjadi …)",
                  "Only when the conditions become true (e.g. status changes to …)",
                )}
              </span>
              <input
                type="checkbox"
                checked={rule.onlyWhenChanges}
                onChange={(e) => set("onlyWhenChanges", e.target.checked)}
              />
            </label>
          )}
          {rule.trigger === "date" && (
            <>
              <label className="field" data-field="dateField">
                <span>{l("Kolom tanggal", "Date field")} *</span>
                <select value={rule.dateField} onChange={(e) => set("dateField", e.target.value)}>
                  <option value="">—</option>
                  {dateFields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {fieldLabel(f)}
                    </option>
                  ))}
                </select>
                {err("dateField")}
              </label>
              <label className="field" data-field="offsetDays">
                <span>{l("Selisih hari", "Offset (days)")}</span>
                <input
                  type="number"
                  min={-365}
                  max={365}
                  value={rule.offsetDays}
                  onChange={(e) => set("offsetDays", Number(e.target.value))}
                />
                <small className="muted">
                  {rule.offsetDays < 0
                    ? l(
                        `${-rule.offsetDays} hari sebelum tanggal`,
                        `${-rule.offsetDays} day(s) before the date`,
                      )
                    : rule.offsetDays > 0
                      ? l(
                          `${rule.offsetDays} hari setelah tanggal`,
                          `${rule.offsetDays} day(s) after the date`,
                        )
                      : l("Pada tanggal itu", "On the date")}
                  {l(" — diperiksa setiap hari, sekali per data.", " — checked daily, once per record.")}
                </small>
              </label>
            </>
          )}
          {rule.trigger === "scheduled" && (
            <>
              <label className="field" data-field="frequency">
                <span>{l("Frekuensi", "Frequency")} *</span>
                <select
                  value={rule.frequency}
                  onChange={(e) => set("frequency", e.target.value as Rule["frequency"])}
                >
                  <option value="daily">{l("Harian", "Daily")}</option>
                  <option value="weekly">{l("Mingguan", "Weekly")}</option>
                  <option value="monthly">{l("Bulanan", "Monthly")}</option>
                </select>
              </label>
              {rule.frequency === "weekly" && (
                <label className="field" data-field="weekday">
                  <span>{l("Hari", "Day")}</span>
                  <select value={rule.weekday} onChange={(e) => set("weekday", Number(e.target.value))}>
                    {WEEKDAYS.map((d, n) => (
                      <option key={n} value={n + 1}>
                        {d[i]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {rule.frequency === "monthly" && (
                <label className="field" data-field="monthday">
                  <span>{l("Tanggal", "Day of month")}</span>
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={rule.monthday}
                    onChange={(e) => set("monthday", Number(e.target.value))}
                  />
                </label>
              )}
              <label className="field" data-field="hour">
                <span>{l("Jam", "Hour")}</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={rule.hour}
                  onChange={(e) => set("hour", Number(e.target.value))}
                />
                <small className="muted">
                  {l(
                    "Aksi dijalankan untuk setiap data yang memenuhi syarat.",
                    "Actions run for every record matching the conditions.",
                  )}
                </small>
              </label>
            </>
          )}
        </div>
      </section>

      <section className="panel automation-step">
        <h2>
          <span className="step-no">2</span> {l("Jika", "If")}
        </h2>
        {rule.conditions.length === 0 && (
          <p className="muted">
            {l("Tanpa syarat: berlaku untuk semua data.", "No conditions: applies to all records.")}
          </p>
        )}
        {rule.conditions.map((c, idx) => (
          <div className="automation-row" key={idx}>
            {idx > 0 && <span className="muted">{l("dan", "and")}</span>}
            <select
              aria-label={l("Field", "Field")}
              value={c.field}
              onChange={(e) => setCond(idx, { field: e.target.value, value: "" })}
            >
              <option value="">—</option>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {fieldLabel(f)}
                </option>
              ))}
            </select>
            <select
              aria-label={l("Operator", "Operator")}
              value={c.op}
              onChange={(e) => setCond(idx, { op: e.target.value as ConditionOp })}
            >
              {CONDITION_OPS.map((o) => (
                <option key={o} value={o}>
                  {CONDITION_OP_LABEL[o][i]}
                </option>
              ))}
            </select>
            {valueInput(c, idx)}
            <button
              type="button"
              aria-label={l("Hapus syarat", "Remove condition")}
              onClick={() =>
                set(
                  "conditions",
                  rule.conditions.filter((_, j) => j !== idx),
                )
              }
            >
              ×
            </button>
            {err(`conditions.${idx}.field`)}
          </div>
        ))}
        <button
          type="button"
          onClick={() => set("conditions", [...rule.conditions, { field: "", op: "eq", value: "" }])}
        >
          {l("Tambah syarat", "Add condition")}
        </button>
      </section>

      <section className="panel automation-step">
        <h2>
          <span className="step-no">3</span> {l("Lakukan", "Do")}
        </h2>
        {err("actions")}
        <details className="muted">
          <summary>{l("Isian template", "Template placeholders")}</summary>
          <p>
            {l(
              "Teks judul, isi, ringkasan, dan nilai bisa memakai isian berikut:",
              "Titles, bodies, summaries and values can use these placeholders:",
            )}{" "}
            {placeholders.map((p) => (
              <code key={p} className="chip">
                {p}
              </code>
            ))}
          </p>
        </details>
        {rule.actions.map((a, idx) => (
          <div className="automation-action" key={idx}>
            <div className="automation-row">
              <strong>
                {idx + 1}. {AUTOMATION_ACTION_LABEL[a.type][i]}
              </strong>
              <span className="grow" />
              <button
                type="button"
                aria-label={l("Naik", "Move up")}
                disabled={idx === 0}
                onClick={() => {
                  const next = [...rule.actions];
                  [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
                  set("actions", next);
                }}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={l("Hapus aksi", "Remove action")}
                onClick={() =>
                  set(
                    "actions",
                    rule.actions.filter((_, j) => j !== idx),
                  )
                }
              >
                ×
              </button>
            </div>
            <div className="fields">
              {a.type === "notify" && (
                <>
                  <label className="field">
                    <span>{l("Pengguna", "Users")}</span>
                    {multi(a.users, users, (v) => setAction(idx, { users: v }), l("Pengguna", "Users"))}
                    {err(`actions.${idx}.users`)}
                  </label>
                  <label className="field">
                    <span>{l("Peran", "Roles")}</span>
                    {multi(a.roleIds, roles, (v) => setAction(idx, { roleIds: v }), l("Peran", "Roles"))}
                  </label>
                  {responsible && (
                    <label className="field check">
                      <span>{l("Penanggung jawab data", "Record's responsible user")}</span>
                      <input
                        type="checkbox"
                        checked={a.responsible}
                        onChange={(e) => setAction(idx, { responsible: e.target.checked })}
                      />
                    </label>
                  )}
                  <label className="field check">
                    <span>{l("Pembuat data", "Record creator")}</span>
                    <input
                      type="checkbox"
                      checked={a.creator}
                      onChange={(e) => setAction(idx, { creator: e.target.checked })}
                    />
                  </label>
                  <label className="field">
                    <span>{l("Judul", "Title")} *</span>
                    <input
                      value={a.title}
                      maxLength={200}
                      onChange={(e) => setAction(idx, { title: e.target.value })}
                    />
                    {err(`actions.${idx}.title`)}
                  </label>
                  <label className="field wide">
                    <span>{l("Isi", "Body")}</span>
                    <textarea
                      value={a.body}
                      rows={2}
                      onChange={(e) => setAction(idx, { body: e.target.value })}
                    />
                  </label>
                </>
              )}
              {a.type === "email" && (
                <>
                  <label className="field">
                    <span>{l("Kepada", "To")}</span>
                    <select
                      value={a.to}
                      onChange={(e) => setAction(idx, { to: e.target.value as "partner" | "address" })}
                    >
                      {hasPartner && (
                        <option value="partner">{l("Email kontak data", "Record's contact email")}</option>
                      )}
                      <option value="address">{l("Alamat tertentu", "Specific address")}</option>
                    </select>
                    {err(`actions.${idx}.to`)}
                  </label>
                  {a.to === "address" && (
                    <label className="field">
                      <span>{l("Alamat email", "Email address")} *</span>
                      <input
                        type="email"
                        value={a.address ?? ""}
                        onChange={(e) => setAction(idx, { address: e.target.value })}
                      />
                      {err(`actions.${idx}.address`)}
                    </label>
                  )}
                  <label className="field">
                    <span>{l("Subjek", "Subject")} *</span>
                    <input
                      value={a.subject}
                      maxLength={200}
                      onChange={(e) => setAction(idx, { subject: e.target.value })}
                    />
                    {err(`actions.${idx}.subject`)}
                  </label>
                  <label className="field wide">
                    <span>{l("Isi email", "Email body")} *</span>
                    <textarea
                      value={a.body}
                      rows={4}
                      onChange={(e) => setAction(idx, { body: e.target.value })}
                    />
                    {err(`actions.${idx}.body`)}
                  </label>
                </>
              )}
              {a.type === "set_field" && (
                <>
                  <label className="field">
                    <span>{l("Field", "Field")} *</span>
                    <select
                      value={a.field}
                      onChange={(e) => setAction(idx, { field: e.target.value, value: "" })}
                    >
                      <option value="">—</option>
                      {settable.map((f) => (
                        <option key={f.key} value={f.key}>
                          {fieldLabel(f)}
                        </option>
                      ))}
                    </select>
                    {err(`actions.${idx}.field`) ??
                      (!settable.length ? (
                        <small className="muted">
                          {l(
                            "Tambahkan field kustom untuk data ini agar bisa diisi otomatis.",
                            "Add custom fields to this record type to fill them automatically.",
                          )}
                        </small>
                      ) : null)}
                  </label>
                  <label className="field">
                    <span>{l("Nilai", "Value")}</span>
                    {a.field === responsible ? (
                      <select value={a.value} onChange={(e) => setAction(idx, { value: e.target.value })}>
                        <option value="">—</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    ) : fieldOf(a.field)?.options ? (
                      <select value={a.value} onChange={(e) => setAction(idx, { value: e.target.value })}>
                        <option value="">—</option>
                        {fieldOf(a.field)!.options!.map(([v, lab]) => (
                          <option key={v} value={v}>
                            {lab[i]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input value={a.value} onChange={(e) => setAction(idx, { value: e.target.value })} />
                    )}
                  </label>
                </>
              )}
              {a.type === "activity" && (
                <>
                  <label className="field">
                    <span>{l("Jenis", "Type")}</span>
                    <select
                      value={a.activityType}
                      onChange={(e) =>
                        setAction(idx, {
                          activityType: e.target.value as (typeof ACTIVITY_TYPES_AUTOMATION)[number],
                        })
                      }
                    >
                      {ACTIVITY_TYPES_AUTOMATION.map((t) => (
                        <option key={t} value={t}>
                          {ACTIVITY_LABEL[t]?.[i] ?? t}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>{l("Ringkasan", "Summary")} *</span>
                    <input
                      value={a.summary}
                      maxLength={200}
                      onChange={(e) => setAction(idx, { summary: e.target.value })}
                    />
                    {err(`actions.${idx}.summary`)}
                  </label>
                  <label className="field">
                    <span>{l("Tenggat (hari)", "Due in (days)")}</span>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={a.dueInDays}
                      onChange={(e) => setAction(idx, { dueInDays: Number(e.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>{l("Ditugaskan ke", "Assign to")}</span>
                    <select
                      value={a.assignTo}
                      onChange={(e) => setAction(idx, { assignTo: e.target.value as "responsible" | "user" })}
                    >
                      <option value="responsible">
                        {l("Penanggung jawab / pembuat data", "Responsible user / creator")}
                      </option>
                      <option value="user">{l("Pengguna tertentu", "Specific user")}</option>
                    </select>
                  </label>
                  {a.assignTo === "user" && (
                    <label className="field">
                      <span>{l("Pengguna", "User")} *</span>
                      <select
                        value={a.userId ?? ""}
                        onChange={(e) => setAction(idx, { userId: e.target.value || null })}
                      >
                        <option value="">—</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                      {err(`actions.${idx}.userId`)}
                    </label>
                  )}
                  <label className="field wide">
                    <span>{l("Catatan", "Note")}</span>
                    <textarea
                      value={a.note}
                      rows={2}
                      onChange={(e) => setAction(idx, { note: e.target.value })}
                    />
                  </label>
                </>
              )}
              {a.type === "approval" && (
                <>
                  <label className="field">
                    <span>{l("Kategori persetujuan", "Approval category")} *</span>
                    <select
                      value={a.categoryId}
                      onChange={(e) => setAction(idx, { categoryId: e.target.value })}
                    >
                      <option value="">—</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {err(`actions.${idx}.categoryId`)}
                  </label>
                  <label className="field">
                    <span>{l("Nominal dari", "Amount from")}</span>
                    <select
                      value={a.amountField ?? ""}
                      onChange={(e) => setAction(idx, { amountField: e.target.value || null })}
                    >
                      <option value="">—</option>
                      {numberFields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {fieldLabel(f)}
                        </option>
                      ))}
                    </select>
                    {err(`actions.${idx}.amountField`)}
                  </label>
                  <label className="field wide">
                    <span>{l("Uraian", "Description")} *</span>
                    <textarea
                      value={a.description}
                      rows={2}
                      onChange={(e) => setAction(idx, { description: e.target.value })}
                    />
                    {err(`actions.${idx}.description`)}
                  </label>
                </>
              )}
              {a.type === "webhook" && (
                <label className="field wide">
                  <span>URL *</span>
                  <input
                    type="url"
                    value={a.url}
                    placeholder="https://"
                    onChange={(e) => setAction(idx, { url: e.target.value })}
                  />
                  {err(`actions.${idx}.url`) ?? (
                    <small className="muted">
                      {l(
                        "POST JSON {id, rule, model, record, occurredAt} dengan header X-ERP-Signature (HMAC-SHA256).",
                        "POST JSON {id, rule, model, record, occurredAt} with an X-ERP-Signature header (HMAC-SHA256).",
                      )}{" "}
                      {id && rule.hasWebhookSecret && (
                        <button type="button" className="link" onClick={rotate}>
                          {l("Buat ulang rahasia", "Regenerate secret")}
                        </button>
                      )}
                    </small>
                  )}
                </label>
              )}
            </div>
          </div>
        ))}
        <div className="automation-row">
          {ACTION_TYPES.map((t) => (
            <button key={t} type="button" onClick={() => set("actions", [...rule.actions, newAction(t)])}>
              + {AUTOMATION_ACTION_LABEL[t][i]}
            </button>
          ))}
        </div>
      </section>

      {id && (
        <section className="panel">
          <h2>{l("Uji coba", "Test run")}</h2>
          <div className="automation-row">
            <input
              aria-label={l("Cari data", "Search records")}
              placeholder={l("Cari nama/nomor…", "Search name/number…")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select aria-label={l("Data", "Record")} value={resId} onChange={(e) => setResId(e.target.value)}>
              <option value="">
                {rule.trigger === "date" || rule.trigger === "scheduled"
                  ? l("Semua data yang memenuhi syarat", "All matching records")
                  : "—"}
              </option>
              {records.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <button type="button" onClick={run} disabled={busy}>
              {l("Jalankan sekarang", "Run now")}
            </button>
          </div>
        </section>
      )}

      {id && (
        <section className="panel">
          <h2>{l("Log eksekusi", "Execution log")}</h2>
          {runs.length === 0 ? (
            <p className="muted">{l("Belum pernah dijalankan.", "Not run yet.")}</p>
          ) : (
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>{l("Waktu", "Time")}</th>
                    <th>{l("Pemicu", "Trigger")}</th>
                    <th>{l("Status", "Status")}</th>
                    <th>{l("Hasil aksi", "Action results")}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td>{fmt.format(new Date(r.createdAt))}</td>
                      <td>
                        {r.trigger === "manual"
                          ? l("Manual", "Manual")
                          : (AUTOMATION_TRIGGER_LABEL[r.trigger as AutomationTrigger]?.[i] ?? r.trigger)}
                      </td>
                      <td>
                        <span className={`badge ${RUN_STATUS[r.status]?.[2] ?? ""}`}>
                          {RUN_STATUS[r.status]?.[i] ?? r.status}
                        </span>
                        {r.message && <div className="muted">{r.message}</div>}
                      </td>
                      <td>
                        {r.results.map((x, n) => (
                          <div key={n} className={x.ok ? "" : "error"}>
                            {x.ok ? "✓" : "✗"} {AUTOMATION_ACTION_LABEL[x.type as ActionType]?.[i] ?? x.type}
                            {x.detail ? ` — ${x.detail}` : ""}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
