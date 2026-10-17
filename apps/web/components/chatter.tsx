"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Entry {
  id: string;
  action: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  message: string | null;
  createdAt: string;
  userName: string | null;
}

const ACTION_LABEL: Record<string, string> = { create: "membuat", update: "mengubah", delete: "menghapus" };
const dateFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });

/** Riwayat perubahan dokumen (mirip chatter Odoo). */
export function Chatter(props: {
  model: string;
  id: string;
  version: number;
  labels: Record<string, string>;
}) {
  const { model, id, version, labels } = props;
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    api<Entry[]>(`/activity/${model}/${id}`)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [model, id, version]);

  return (
    <aside className="panel chatter">
      <h2>Aktivitas</h2>
      {entries.length === 0 && <p className="muted">Belum ada aktivitas.</p>}
      <ol>
        {entries.map((e) => (
          <li key={e.id}>
            <strong>{e.userName ?? "Sistem"}</strong> {ACTION_LABEL[e.action] ?? e.action}
            <time className="muted"> · {dateFmt.format(new Date(e.createdAt))}</time>
            {e.changes && (
              <ul>
                {Object.entries(e.changes).map(([field, c]) => (
                  <li key={field} className="muted">
                    {labels[field] ?? field}: {String(c.from ?? "—")} → {String(c.to ?? "—")}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}
