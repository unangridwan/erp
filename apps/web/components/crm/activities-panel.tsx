"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { formatDate, today } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { ACTIVITY_TYPES } from "../../lib/resources";
import { useOptions } from "../accounting/use-options";

interface Activity {
  id: string;
  activityType: string;
  summary: string;
  note: string | null;
  dueDate: string;
  userName: string | null;
}

/** Aktivitas terjadwal sebuah dokumen: jadwalkan, tandai selesai (hasil masuk ke riwayat). */
export function ActivitiesPanel(props: {
  resModel: "crm_lead" | "sale_order" | "partner";
  resId: string;
  editable: boolean;
  onChange?: () => void;
}) {
  const { l, tx, locale } = useI18n();
  const users = useOptions<{ id: string; name: string }>("/users/options");
  const [items, setItems] = useState<Activity[]>([]);
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ activityType: "call", summary: "", dueDate: today(), userId: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Activity[]>(`/activities?resModel=${props.resModel}&resId=${props.resId}`)
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, [props.resModel, props.resId, version]);

  const refresh = () => {
    setVersion((v) => v + 1);
    props.onChange?.();
  };

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/activities", {
        method: "POST",
        body: {
          resModel: props.resModel,
          resId: props.resId,
          activityType: form.activityType,
          summary: form.summary,
          dueDate: form.dueDate,
          userId: form.userId || undefined,
        },
      });
      setForm((f) => ({ ...f, summary: "" }));
      setAdding(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function done(a: Activity) {
    const feedback = prompt(l("Catatan hasil (opsional)", "Feedback (optional)"), "");
    if (feedback === null) return;
    await api(`/activities/${a.id}/done`, { method: "POST", body: { feedback } }).catch((e: Error) =>
      setError(e.message),
    );
    refresh();
  }

  const typeLabel = (t: string) => {
    const found = ACTIVITY_TYPES.find(([v]) => v === t);
    return found ? tx(found[1]) : t;
  };

  return (
    <section className="panel">
      <header className="toolbar">
        <h2>{l("Aktivitas terjadwal", "Planned activities")}</h2>
        {props.editable && !adding && (
          <button type="button" onClick={() => setAdding(true)}>
            + {l("Jadwalkan", "Schedule")}
          </button>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {adding && (
        <form className="inline-panel" onSubmit={add}>
          <label className="field">
            <span>{l("Jenis", "Type")}</span>
            <select
              value={form.activityType}
              onChange={(e) => setForm((f) => ({ ...f, activityType: e.target.value }))}
            >
              {ACTIVITY_TYPES.map(([v, label]) => (
                <option key={v} value={v}>
                  {tx(label)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Ringkasan *", "Summary *")}</span>
            <input
              required
              value={form.summary}
              onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>{l("Tenggat *", "Due *")}</span>
            <input
              type="date"
              required
              value={form.dueDate}
              onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>{l("Ditugaskan ke", "Assigned to")}</span>
            <select value={form.userId} onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))}>
              <option value="">{l("Saya", "Me")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary">{l("Simpan", "Save")}</button>
          <button type="button" className="link" onClick={() => setAdding(false)}>
            {l("Batal", "Cancel")}
          </button>
        </form>
      )}
      {items.length === 0 ? (
        <p className="muted">{l("Tidak ada aktivitas terjadwal.", "No planned activities.")}</p>
      ) : (
        <ul className="activity-list">
          {items.map((a) => (
            <li key={a.id}>
              <span className={a.dueDate < today() ? "overdue" : ""}>{formatDate(a.dueDate, locale)}</span>
              <strong>{typeLabel(a.activityType)}</strong>
              <span>{a.summary}</span>
              <small className="muted">{a.userName}</small>
              {props.editable && (
                <>
                  <button type="button" className="link" onClick={() => done(a)}>
                    ✓ {l("Selesai", "Done")}
                  </button>
                  <button
                    type="button"
                    aria-label="Hapus baris / Remove"
                    className="link"
                    onClick={async () => {
                      await api(`/activities/${a.id}`, { method: "DELETE" }).catch(() => undefined);
                      refresh();
                    }}
                  >
                    ✕
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
