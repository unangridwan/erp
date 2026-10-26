"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { formatDate, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Delegation {
  id: string;
  userId: string;
  userName: string;
  delegateUserId: string;
  delegateName: string;
  dateFrom: string;
  dateTo: string;
  reason: string | null;
}

/** Delegasi penyetuju: selama periode, delegasi memutuskan persetujuan atas nama user (mis. saat cuti). */
export default function ApprovalDelegationsPage() {
  const { l, locale } = useI18n();
  const me = useMe();
  const hr = can(me.permissions, "hr.manage");
  const [all, setAll] = useState(false);
  const [rows, setRows] = useState<Delegation[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    userId: "",
    delegateUserId: "",
    dateFrom: today(),
    dateTo: today(),
    reason: "",
  });
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ id: string; name: string }[]>("/users/options").then(setUsers, () => setUsers([]));
  }, []);
  useEffect(() => {
    api<Delegation[]>(`/approval-delegations${all ? "?all=1" : ""}`).then(setRows, (e: Error) =>
      setError(e.message),
    );
  }, [all, version]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/approval-delegations", {
        method: "POST",
        body: {
          ...(form.userId ? { userId: form.userId } : {}),
          delegateUserId: form.delegateUserId,
          dateFrom: form.dateFrom,
          dateTo: form.dateTo,
          reason: form.reason || null,
        },
      });
      setForm((f) => ({ ...f, delegateUserId: "", reason: "" }));
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : String(err));
    }
  }
  async function remove(id: string) {
    if (!confirm(l("Hapus delegasi ini?", "Delete this delegation?"))) return;
    await api(`/approval-delegations/${id}`, { method: "DELETE" }).then(
      () => setVersion((v) => v + 1),
      (e: Error) => setError(e.message),
    );
  }
  const active = (d: Delegation) => d.dateFrom <= today() && d.dateTo >= today();

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Delegasi Persetujuan", "Approval Delegations")}</h1>
        {hr && (
          <label className="check">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            {l("Semua user", "All users")}
          </label>
        )}
      </header>
      <p className="muted">
        {l(
          "Selama periode delegasi, user pengganti dapat menyetujui atau menolak permintaan, cuti, lembur, dan klaim atas nama Anda.",
          "During the delegation period, the substitute can approve or refuse requests, time off, overtime and claims on your behalf.",
        )}
      </p>
      <form className="inline-panel" onSubmit={save}>
        {hr && (
          <label className="field">
            <span>{l("Penyetuju", "Approver")}</span>
            <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
              <option value="">{l("Saya sendiri", "Myself")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>{l("Didelegasikan kepada", "Delegate to")}</span>
          <select
            value={form.delegateUserId}
            onChange={(e) => setForm({ ...form, delegateUserId: e.target.value })}
            required
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
          <span>{l("Mulai", "From")}</span>
          <input
            type="date"
            value={form.dateFrom}
            onChange={(e) => setForm({ ...form, dateFrom: e.target.value })}
          />
        </label>
        <label className="field">
          <span>{l("Selesai", "To")}</span>
          <input
            type="date"
            value={form.dateTo}
            onChange={(e) => setForm({ ...form, dateTo: e.target.value })}
          />
        </label>
        <label className="field">
          <span>{l("Alasan", "Reason")}</span>
          <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </label>
        <button type="submit" className="primary">
          {l("Tambah delegasi", "Add delegation")}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Penyetuju", "Approver")}</th>
              <th>{l("Delegasi", "Delegate")}</th>
              <th>{l("Periode", "Period")}</th>
              <th>{l("Alasan", "Reason")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>{d.userName}</td>
                <td>{d.delegateName}</td>
                <td>
                  {formatDate(d.dateFrom, locale)} – {formatDate(d.dateTo, locale)}{" "}
                  {active(d) && <span className="badge state-sale">{l("aktif", "active")}</span>}
                </td>
                <td>{d.reason}</td>
                <td>
                  {(d.userId === me.userId || hr) && (
                    <button type="button" className="link" onClick={() => remove(d.id)}>
                      {l("Hapus", "Delete")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {l("Belum ada delegasi.", "No delegations yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
