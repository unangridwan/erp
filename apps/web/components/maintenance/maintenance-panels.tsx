"use client";

import { EQUIPMENT_STATE_LABEL, METER_UNIT_LABEL, PRIORITY_LABEL, REQUEST_STATE_LABEL } from "@erp/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatDate, today } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { can } from "../../lib/resources";
import { toast } from "../feedback";
import { useMe } from "../me-context";

export const STATE_BADGE: Record<string, string> = {
  new: "",
  scheduled: "",
  in_progress: "warn",
  done: "success",
  cancelled: "",
  operational: "success",
  down: "danger",
  retired: "",
};

export function StateBadge({ state }: { state: string }) {
  const { locale } = useI18n();
  const i = locale === "id" ? 0 : 1;
  const label = REQUEST_STATE_LABEL[state]?.[i] ?? EQUIPMENT_STATE_LABEL[state]?.[i] ?? state;
  return <span className={`badge ${STATE_BADGE[state] ?? ""}`}>{label}</span>;
}

export const priorityLabel = (p: string, locale: string) => PRIORITY_LABEL[p]?.[locale === "id" ? 0 : 1] ?? p;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface EquipmentOverview {
  equipment: { id: string; name: string; meter: string; meterUnit: string | null; state: string };
  plans: {
    id: string;
    name: string;
    intervalDays: number | null;
    intervalMeter: string | null;
    active: boolean;
    next: { dueDate: string | null; dueMeter: number | null; due: boolean };
  }[];
  readings: { id: string; date: string; value: string }[];
  requests: {
    id: string;
    name: string;
    title: string;
    kind: string;
    state: string;
    createdAt: string;
    downtimeHours: string | null;
  }[];
}

/** Panel di form peralatan: status, meter, rencana & jatuh tempo, riwayat permintaan. */
export function EquipmentPanel({ id }: { id: string }) {
  const { l, locale } = useI18n();
  const me = useMe();
  const [data, setData] = useState<EquipmentOverview | null>(null);
  const [meter, setMeter] = useState("");
  const load = useCallback(
    () => api<EquipmentOverview>(`/equipment/${id}/overview`).then(setData, () => setData(null)),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!data) return null;
  const unit = data.equipment.meterUnit
    ? METER_UNIT_LABEL[data.equipment.meterUnit]?.[locale === "id" ? 0 : 1]
    : null;
  const canWrite = can(me.permissions, "maintenance.write");

  async function addMeter() {
    try {
      await api(`/equipment/${id}/meter`, { method: "POST", body: { date: today(), value: meter } });
      toast.success(l("Meter dicatat.", "Meter recorded."));
      setMeter("");
      void load();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <>
      <section className="panel">
        <h2>
          {l("Status", "Status")} <StateBadge state={data.equipment.state} />
        </h2>
        {unit && (
          <div className="automation-row">
            <span>
              {l("Meter sekarang", "Current meter")}: <strong>{Number(data.equipment.meter)}</strong> {unit}
            </span>
            {canWrite && (
              <>
                <input
                  type="number"
                  min={0}
                  aria-label={l("Meter baru", "New meter")}
                  placeholder={l("Meter baru", "New meter")}
                  value={meter}
                  onChange={(e) => setMeter(e.target.value)}
                />
                <button type="button" onClick={addMeter} disabled={!meter}>
                  {l("Catat meter", "Record meter")}
                </button>
              </>
            )}
          </div>
        )}
        {canWrite && (
          <p>
            <Link className="button" href={`/maintenance/requests/new?equipmentId=${id}`}>
              {l("Buat permintaan perawatan", "Create maintenance request")}
            </Link>
          </p>
        )}
      </section>
      <section className="panel">
        <h2>{l("Rencana perawatan", "Maintenance plans")}</h2>
        {data.plans.length === 0 ? (
          <p className="muted">
            {l("Belum ada rencana.", "No plans yet.")}{" "}
            <Link href="/maintenance-plans/new">{l("Buat rencana", "Create a plan")}</Link>
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>{l("Rencana", "Plan")}</th>
                  <th>{l("Interval", "Interval")}</th>
                  <th>{l("Jatuh tempo berikutnya", "Next due")}</th>
                </tr>
              </thead>
              <tbody>
                {data.plans.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/maintenance-plans/${p.id}`}>{p.name}</Link>
                      {!p.active && <span className="badge">{l("Nonaktif", "Inactive")}</span>}
                    </td>
                    <td>
                      {[
                        p.intervalDays ? l(`${p.intervalDays} hari`, `${p.intervalDays} days`) : null,
                        p.intervalMeter ? `${Number(p.intervalMeter)} ${unit ?? ""}` : null,
                      ]
                        .filter(Boolean)
                        .join(" / ")}
                    </td>
                    <td>
                      {[
                        p.next.dueDate ? formatDate(p.next.dueDate, locale) : null,
                        p.next.dueMeter !== null ? `${p.next.dueMeter} ${unit ?? ""}` : null,
                      ]
                        .filter(Boolean)
                        .join(" / ")}{" "}
                      {p.next.due && <span className="badge warn">{l("Jatuh tempo", "Due")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>{l("Riwayat perawatan", "Maintenance history")}</h2>
        {data.requests.length === 0 ? (
          <p className="muted">{l("Belum ada.", "None yet.")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>{l("Nomor", "Number")}</th>
                  <th>{l("Judul", "Title")}</th>
                  <th>{l("Jenis", "Type")}</th>
                  <th>{l("Tanggal", "Date")}</th>
                  <th>{l("Downtime (jam)", "Downtime (h)")}</th>
                  <th>{l("Status", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/maintenance/requests/${r.id}`}>{r.name}</Link>
                    </td>
                    <td>{r.title}</td>
                    <td>
                      {r.kind === "preventive" ? l("Preventif", "Preventive") : l("Korektif", "Corrective")}
                    </td>
                    <td>{formatDate(r.createdAt.slice(0, 10), locale)}</td>
                    <td>{r.downtimeHours ? Number(r.downtimeHours) : "—"}</td>
                    <td>
                      <StateBadge state={r.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/** Panel di form rencana: daftar tugas (checklist) yang disalin ke setiap permintaan preventif. */
export function PlanTasksPanel({ id }: { id: string }) {
  const { l } = useI18n();
  const me = useMe();
  const [tasks, setTasks] = useState<{ label: string }[] | null>(null);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    void api<{ tasks: { label: string }[] }>(`/maintenance-plans/${id}`).then(
      (p) => setTasks(p.tasks),
      () => setTasks([]),
    );
  }, [id]);
  if (!tasks) return null;
  const canEdit = can(me.permissions, "maintenance.manage");
  async function save(next: { label: string }[]) {
    try {
      await api(`/maintenance-plans/${id}`, { method: "PATCH", body: { tasks: next } });
      setTasks(next);
    } catch (e) {
      toast.error(errorText(e));
    }
  }
  return (
    <section className="panel">
      <h2>{l("Tugas (checklist)", "Tasks (checklist)")}</h2>
      {tasks.length === 0 && <p className="muted">{l("Belum ada tugas.", "No tasks yet.")}</p>}
      <ol>
        {tasks.map((t, i) => (
          <li key={i}>
            {t.label}{" "}
            {canEdit && (
              <button
                type="button"
                className="link"
                aria-label={l("Hapus tugas", "Remove task")}
                onClick={() => void save(tasks.filter((_, j) => j !== i))}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ol>
      {canEdit && (
        <div className="automation-row">
          <input
            aria-label={l("Tugas baru", "New task")}
            placeholder={l("mis. Cek oli & kebocoran", "e.g. Check oil & leaks")}
            value={draft}
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="button"
            disabled={!draft.trim()}
            onClick={() => {
              void save([...tasks, { label: draft.trim() }]);
              setDraft("");
            }}
          >
            {l("Tambah tugas", "Add task")}
          </button>
        </div>
      )}
    </section>
  );
}

/** Panel di form tim: anggota (penerima notifikasi permintaan). */
export function TeamMembersPanel({ id }: { id: string }) {
  const { l } = useI18n();
  const me = useMe();
  const [members, setMembers] = useState<string[] | null>(null);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    void api<{ memberIds: string[] }>(`/maintenance-teams/${id}`).then(
      (t) => setMembers(t.memberIds),
      () => setMembers([]),
    );
    void api<{ id: string; name: string }[]>("/users/options").then(setUsers, () => setUsers([]));
  }, [id]);
  if (!members) return null;
  const canEdit = can(me.permissions, "maintenance.manage");
  async function toggle(userId: string, on: boolean) {
    const next = on ? [...members!, userId] : members!.filter((m) => m !== userId);
    try {
      await api(`/maintenance-teams/${id}`, { method: "PATCH", body: { memberIds: next } });
      setMembers(next);
    } catch (e) {
      toast.error(errorText(e));
    }
  }
  return (
    <section className="panel">
      <h2>{l("Anggota tim", "Team members")}</h2>
      <p className="muted">
        {l(
          "Anggota menerima notifikasi permintaan perawatan baru untuk tim ini.",
          "Members are notified of new maintenance requests for this team.",
        )}
      </p>
      <div className="fields">
        {users.map((u) => (
          <label key={u.id} className="field check">
            <span>{u.name}</span>
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={members.includes(u.id)}
              onChange={(e) => void toggle(u.id, e.target.checked)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}

/** Portal: lapor kerusakan peralatan & pantau status laporan sendiri. */
export function MyBreakdownPanel() {
  const { l, locale } = useI18n();
  const [equipment, setEquipment] = useState<
    { id: string; code: string; name: string; location: string | null }[]
  >([]);
  const [mine, setMine] = useState<
    {
      id: string;
      name: string;
      title: string;
      state: string;
      equipment: string;
      createdAt: string;
      resolution: string | null;
    }[]
  >([]);
  const [form, setForm] = useState({
    equipmentId: "",
    title: "",
    description: "",
    priority: "normal",
    stopped: true,
  });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    void api<typeof mine>("/me/maintenance-requests").then(setMine, () => setMine([]));
  }, []);
  useEffect(() => {
    void api<typeof equipment>("/me/maintenance-requests/equipment").then(setEquipment, () =>
      setEquipment([]),
    );
    load();
  }, [load]);
  if (!equipment.length && !mine.length) return null;

  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ name: string }>("/me/maintenance-requests", { method: "POST", body: form });
      toast.success(
        l(`Laporan ${r.name} terkirim ke tim perawatan.`, `Report ${r.name} sent to maintenance.`),
      );
      setForm({ equipmentId: "", title: "", description: "", priority: "normal", stopped: true });
      load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>{l("Lapor kerusakan peralatan", "Report an equipment breakdown")}</h2>
      {equipment.length > 0 && (
        <div className="fields">
          <label className="field">
            <span>{l("Peralatan", "Equipment")} *</span>
            <select
              value={form.equipmentId}
              onChange={(e) => setForm({ ...form, equipmentId: e.target.value })}
            >
              <option value="">—</option>
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code} — {e.name}
                  {e.location ? ` (${e.location})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Masalah", "Problem")} *</span>
            <input
              value={form.title}
              maxLength={200}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Prioritas", "Priority")}</span>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {Object.keys(PRIORITY_LABEL).map((p) => (
                <option key={p} value={p}>
                  {priorityLabel(p, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="field check">
            <span>{l("Mesin berhenti beroperasi", "The machine has stopped")}</span>
            <input
              type="checkbox"
              checked={form.stopped}
              onChange={(e) => setForm({ ...form, stopped: e.target.checked })}
            />
          </label>
          <label className="field wide">
            <span>{l("Keterangan", "Details")}</span>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
        </div>
      )}
      {equipment.length > 0 && (
        <button
          type="button"
          className="primary"
          onClick={submit}
          disabled={busy || !form.equipmentId || !form.title.trim()}
          aria-busy={busy}
        >
          {l("Kirim laporan", "Send report")}
        </button>
      )}
      {mine.length > 0 && (
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th>{l("Nomor", "Number")}</th>
                <th>{l("Peralatan", "Equipment")}</th>
                <th>{l("Masalah", "Problem")}</th>
                <th>{l("Tanggal", "Date")}</th>
                <th>{l("Status", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.equipment}</td>
                  <td>
                    {r.title}
                    {r.resolution && <div className="muted">{r.resolution}</div>}
                  </td>
                  <td>{formatDate(r.createdAt.slice(0, 10), locale)}</td>
                  <td>
                    <StateBadge state={r.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
