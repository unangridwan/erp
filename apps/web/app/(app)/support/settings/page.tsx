"use client";

import { TICKET_PRIORITY_LABEL, TICKET_PRIORITY_VALUES, DEFAULT_SLA_HOURS } from "@erp/shared";
import { useEffect, useState } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { ask, toast } from "../../../../components/feedback";
import { useMe } from "../../../../components/me-context";
import { api, ApiError, API_URL } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Team {
  id: string;
  name: string;
  leaderId: string | null;
  memberIds: string[];
  autoAssign: boolean;
  active: boolean;
}
interface Policy {
  id: string;
  name: string;
  priority: string;
  teamId: string | null;
  firstResponseHours: string;
  resolutionHours: string;
  active: boolean;
}
interface Settings {
  defaultTeamId: string | null;
  autoCloseDays: number;
  inboundConfigured: boolean;
}

/** Pengaturan layanan: antrean (tim agen), kebijakan SLA, antrean bawaan, tutup otomatis, email masuk. */
export default function SupportSettingsPage() {
  const me = useMe();
  const { l } = useI18n();
  const editable = can(me.permissions, "support.manage");
  const users = useOptions<{ id: string; name: string }>("/users/options");
  const [teams, setTeams] = useState<Team[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [team, setTeam] = useState<Partial<Team> | null>(null);
  const [policy, setPolicy] = useState<Partial<Policy> | null>(null);
  const [inboundKey, setInboundKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api<{ items: Team[] }>("/support/teams?limit=200")
      .then((d) => setTeams(d.items))
      .catch(() => setTeams([]));
    api<{ items: Policy[] }>("/support/sla-policies?limit=200")
      .then((d) => setPolicies(d.items))
      .catch(() => setPolicies([]));
    api<Settings>("/support/settings")
      .then(setSettings)
      .catch((e: Error) => setError(e.message));
  }, [version]);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(
        e instanceof ApiError && Object.keys(e.fieldErrors).length
          ? Object.values(e.fieldErrors).join("; ")
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  }
  const userName = (id: string | null) => users.find((u) => u.id === id)?.name ?? "";
  const teamName = (id: string | null) =>
    teams.find((t) => t.id === id)?.name ?? l("Semua antrean", "All queues");

  return (
    <>
      <header className="toolbar">
        <h1>{l("Pengaturan Layanan", "Helpdesk Settings")}</h1>
      </header>
      {error && <p className="error">{error}</p>}

      <section className="panel">
        <header className="toolbar">
          <h2>{l("Antrean", "Queues")}</h2>
          {editable && (
            <button onClick={() => setTeam({ name: "", memberIds: [], autoAssign: true, active: true })}>
              {l("Antrean baru", "New queue")}
            </button>
          )}
        </header>
        {team && (
          <div className="stack inline-panel">
            <div className="filters">
              <label className="field">
                <span>{l("Nama", "Name")}</span>
                <input value={team.name ?? ""} onChange={(e) => setTeam({ ...team, name: e.target.value })} />
              </label>
              <label className="field">
                <span>{l("Pemimpin (menerima eskalasi)", "Leader (receives escalations)")}</span>
                <select
                  value={team.leaderId ?? ""}
                  onChange={(e) => setTeam({ ...team, leaderId: e.target.value || null })}
                >
                  <option value="">—</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{l("Bagi tiket otomatis", "Auto-assign tickets")}</span>
                <input
                  type="checkbox"
                  checked={team.autoAssign ?? true}
                  onChange={(e) => setTeam({ ...team, autoAssign: e.target.checked })}
                />
              </label>
            </div>
            <fieldset className="field">
              <legend>{l("Agen", "Agents")}</legend>
              <div className="filters">
                {users.map((u) => (
                  <label key={u.id}>
                    <input
                      type="checkbox"
                      checked={(team.memberIds ?? []).includes(u.id)}
                      onChange={(e) =>
                        setTeam({
                          ...team,
                          memberIds: e.target.checked
                            ? [...(team.memberIds ?? []), u.id]
                            : (team.memberIds ?? []).filter((x) => x !== u.id),
                        })
                      }
                    />{" "}
                    {u.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="filters">
              <button
                className="primary"
                disabled={!team.name?.trim()}
                onClick={() =>
                  run(async () => {
                    const body = {
                      name: team.name,
                      leaderId: team.leaderId ?? null,
                      memberIds: team.memberIds ?? [],
                      autoAssign: team.autoAssign ?? true,
                      active: team.active ?? true,
                    };
                    if (team.id) await api(`/support/teams/${team.id}`, { method: "PATCH", body });
                    else await api("/support/teams", { method: "POST", body });
                    setTeam(null);
                  })
                }
              >
                {l("Simpan", "Save")}
              </button>
              <button className="link" onClick={() => setTeam(null)}>
                {l("Batal", "Cancel")}
              </button>
            </div>
          </div>
        )}
        {teams.length === 0 ? (
          <p className="muted">{l("Belum ada antrean.", "No queues yet.")}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{l("Antrean", "Queue")}</th>
                  <th>{l("Pemimpin", "Leader")}</th>
                  <th>{l("Agen", "Agents")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.name}
                      {!t.autoAssign && <small className="muted"> · {l("manual", "manual")}</small>}
                    </td>
                    <td>{userName(t.leaderId) || "—"}</td>
                    <td>{t.memberIds.map(userName).filter(Boolean).join(", ") || "—"}</td>
                    <td>
                      {editable && (
                        <button className="link" onClick={() => setTeam(t)}>
                          {l("Ubah", "Edit")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <header className="toolbar">
          <h2>{l("Kebijakan SLA", "SLA policies")}</h2>
          {editable && (
            <button
              onClick={() =>
                setPolicy({
                  name: "",
                  priority: "normal",
                  firstResponseHours: "8",
                  resolutionHours: "72",
                  active: true,
                })
              }
            >
              {l("Kebijakan baru", "New policy")}
            </button>
          )}
        </header>
        <p className="muted">
          {l(
            "Target dalam jam kalender sejak tiket dibuat. Tanpa kebijakan, berlaku target bawaan: ",
            "Targets in calendar hours from ticket creation. Without a policy, defaults apply: ",
          )}
          {TICKET_PRIORITY_VALUES.map(
            (p) => `${l(...TICKET_PRIORITY_LABEL[p]!)} ${DEFAULT_SLA_HOURS[p][0]}/${DEFAULT_SLA_HOURS[p][1]}`,
          ).join(", ")}
          {l(
            " jam (respons/selesai). Pelanggaran memberi notifikasi ke agen dan pemimpin antrean.",
            " h (response/resolution). Breaches notify the agent and the queue leader.",
          )}
        </p>
        {policy && (
          <div className="filters inline-panel">
            <label className="field">
              <span>{l("Nama", "Name")}</span>
              <input
                value={policy.name ?? ""}
                onChange={(e) => setPolicy({ ...policy, name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("Prioritas", "Priority")}</span>
              <select
                value={policy.priority}
                onChange={(e) => setPolicy({ ...policy, priority: e.target.value })}
              >
                {TICKET_PRIORITY_VALUES.map((p) => (
                  <option key={p} value={p}>
                    {l(...TICKET_PRIORITY_LABEL[p]!)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Antrean", "Queue")}</span>
              <select
                value={policy.teamId ?? ""}
                onChange={(e) => setPolicy({ ...policy, teamId: e.target.value || null })}
              >
                <option value="">{l("Semua antrean", "All queues")}</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Respons pertama (jam)", "First response (h)")}</span>
              <input
                className="num"
                inputMode="decimal"
                style={{ width: 90 }}
                value={policy.firstResponseHours ?? ""}
                onChange={(e) => setPolicy({ ...policy, firstResponseHours: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("Penyelesaian (jam)", "Resolution (h)")}</span>
              <input
                className="num"
                inputMode="decimal"
                style={{ width: 90 }}
                value={policy.resolutionHours ?? ""}
                onChange={(e) => setPolicy({ ...policy, resolutionHours: e.target.value })}
              />
            </label>
            <button
              className="primary"
              disabled={!policy.name?.trim()}
              onClick={() =>
                run(async () => {
                  const body = {
                    name: policy.name,
                    priority: policy.priority,
                    teamId: policy.teamId ?? null,
                    firstResponseHours: policy.firstResponseHours,
                    resolutionHours: policy.resolutionHours,
                    active: policy.active ?? true,
                  };
                  if (policy.id) await api(`/support/sla-policies/${policy.id}`, { method: "PATCH", body });
                  else await api("/support/sla-policies", { method: "POST", body });
                  setPolicy(null);
                })
              }
            >
              {l("Simpan", "Save")}
            </button>
            <button className="link" onClick={() => setPolicy(null)}>
              {l("Batal", "Cancel")}
            </button>
          </div>
        )}
        {policies.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{l("Kebijakan", "Policy")}</th>
                  <th>{l("Prioritas", "Priority")}</th>
                  <th>{l("Antrean", "Queue")}</th>
                  <th className="num">{l("Respons", "Response")}</th>
                  <th className="num">{l("Selesai", "Resolution")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{l(...TICKET_PRIORITY_LABEL[p.priority]!)}</td>
                    <td>{teamName(p.teamId)}</td>
                    <td className="num">
                      {Number(p.firstResponseHours)} {l("jam", "h")}
                    </td>
                    <td className="num">
                      {Number(p.resolutionHours)} {l("jam", "h")}
                    </td>
                    <td>
                      {editable && (
                        <>
                          <button className="link" onClick={() => setPolicy(p)}>
                            {l("Ubah", "Edit")}
                          </button>{" "}
                          <button
                            className="link"
                            onClick={() =>
                              run(async () => {
                                if (
                                  !(await ask(
                                    l(`Hapus kebijakan "${p.name}"?`, `Delete policy "${p.name}"?`),
                                  ))
                                )
                                  return;
                                await api(`/support/sla-policies/${p.id}`, { method: "DELETE" });
                              })
                            }
                          >
                            {l("Hapus", "Delete")}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {settings && (
        <section className="panel">
          <h2>{l("Umum & email masuk", "General & inbound email")}</h2>
          <fieldset className="filters" style={{ border: 0, padding: 0, margin: 0 }} disabled={!editable}>
            <label className="field">
              <span>{l("Antrean bawaan tiket baru", "Default queue for new tickets")}</span>
              <select
                value={settings.defaultTeamId ?? ""}
                onChange={(e) => setSettings({ ...settings, defaultTeamId: e.target.value || null })}
              >
                <option value="">—</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>
                {l(
                  "Tutup otomatis setelah selesai (hari, 0 = mati)",
                  "Auto-close after resolved (days, 0 = off)",
                )}
              </span>
              <input
                className="num"
                inputMode="numeric"
                style={{ width: 90 }}
                value={String(settings.autoCloseDays)}
                onChange={(e) => setSettings({ ...settings, autoCloseDays: Number(e.target.value) || 0 })}
              />
            </label>
            <button
              className="primary"
              onClick={() =>
                run(async () => {
                  await api("/support/settings", {
                    method: "PUT",
                    body: { defaultTeamId: settings.defaultTeamId, autoCloseDays: settings.autoCloseDays },
                  });
                  toast.success(l("Pengaturan tersimpan", "Settings saved"));
                })
              }
            >
              {l("Simpan", "Save")}
            </button>
          </fieldset>
          <h3>{l("Email masuk", "Inbound email")}</h3>
          <p className="muted">
            {l(
              "Arahkan layanan penerus email (mis. Mailgun, SendGrid Inbound Parse, Postmark) untuk mengirim POST JSON {from, subject, text} ke URL webhook di bawah. Email baru menjadi tiket; balasan yang memuat nomor tiket di subjek masuk ke tiket itu.",
              "Point your inbound email service (e.g. Mailgun, SendGrid Inbound Parse, Postmark) to POST JSON {from, subject, text} to the webhook URL below. New emails become tickets; replies with the ticket number in the subject go to that ticket.",
            )}
          </p>
          <p>
            {settings.inboundConfigured
              ? l("Webhook aktif.", "Webhook is active.")
              : l("Belum dikonfigurasi.", "Not configured yet.")}{" "}
            {editable && (
              <button
                onClick={() =>
                  run(async () => {
                    if (
                      settings.inboundConfigured &&
                      !(await ask(
                        l(
                          "Buat kunci baru? URL lama langsung tidak berlaku.",
                          "Create a new key? The old URL stops working.",
                        ),
                      ))
                    )
                      return;
                    const r = await api<{ key: string }>("/support/settings/inbound-key", {
                      method: "POST",
                      body: {},
                    });
                    setInboundKey(r.key);
                  })
                }
              >
                {settings.inboundConfigured
                  ? l("Buat URL baru", "New URL")
                  : l("Buat URL webhook", "Create webhook URL")}
              </button>
            )}
          </p>
          {inboundKey && (
            <label className="field">
              <span>
                {l(
                  "URL webhook (simpan sekarang, hanya ditampilkan sekali)",
                  "Webhook URL (save it now, shown only once)",
                )}
              </span>
              <input
                readOnly
                value={`${API_URL}/public/support/inbound/${inboundKey}`}
                onFocus={(e) => e.target.select()}
              />
            </label>
          )}
        </section>
      )}
    </>
  );
}
