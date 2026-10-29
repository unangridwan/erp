"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { formatDate, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { ACTIVITY_TYPES } from "../../../../lib/resources";

interface Activity {
  id: string;
  resModel: string;
  resId: string;
  recordName: string;
  activityType: string;
  summary: string;
  dueDate: string;
}

const HREF: Record<string, (id: string) => string> = {
  crm_lead: (id) => `/crm/leads/${id}`,
  sale_order: (id) => `/sales/orders/${id}`,
  partner: (id) => `/partners/${id}`,
};

/** Aktivitas terbuka milik user, dikelompokkan: terlambat, hari ini, mendatang. */
export default function MyActivitiesPage() {
  const { l, tx, locale } = useI18n();
  const [items, setItems] = useState<Activity[] | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Activity[]>("/activities/mine")
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, [version]);

  const now = today();
  const groups = [
    { label: l("Terlambat", "Overdue"), rows: items?.filter((a) => a.dueDate < now) ?? [] },
    { label: l("Hari ini", "Today"), rows: items?.filter((a) => a.dueDate === now) ?? [] },
    { label: l("Mendatang", "Upcoming"), rows: items?.filter((a) => a.dueDate > now) ?? [] },
  ];
  const typeLabel = (t: string) => {
    const found = ACTIVITY_TYPES.find(([v]) => v === t);
    return found ? tx(found[1]) : t;
  };

  async function done(a: Activity) {
    const feedback = prompt(l("Catatan hasil (opsional)", "Feedback (optional)"), "");
    if (feedback === null) return;
    await api(`/activities/${a.id}/done`, { method: "POST", body: { feedback } }).catch((e: Error) =>
      setError(e.message),
    );
    setVersion((v) => v + 1);
  }

  return (
    <>
      <header className="toolbar">
        <h1>{l("Aktivitas Saya", "My Activities")}</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {items?.length === 0 && (
        <p className="muted">{l("Tidak ada aktivitas terbuka.", "No open activities.")}</p>
      )}
      {groups
        .filter((g) => g.rows.length)
        .map((g) => (
          <section key={g.label} className="panel">
            <h2>
              {g.label} ({g.rows.length})
            </h2>
            <div className="table-scroll">
              <table>
                <tbody>
                  {g.rows.map((a) => (
                    <tr key={a.id}>
                      <td className={a.dueDate < now ? "overdue" : ""}>{formatDate(a.dueDate, locale)}</td>
                      <td>{typeLabel(a.activityType)}</td>
                      <td>{a.summary}</td>
                      <td>
                        <Link href={HREF[a.resModel]?.(a.resId) ?? "#"}>{a.recordName}</Link>
                      </td>
                      <td>
                        <button type="button" className="link" onClick={() => done(a)}>
                          ✓ {l("Selesai", "Done")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
    </>
  );
}
