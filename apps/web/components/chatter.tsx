"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useI18n, type MessageKey } from "../lib/i18n";

interface Entry {
  id: string;
  action: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  message: string | null;
  createdAt: string;
  userName: string | null;
}

/** Riwayat perubahan dokumen (mirip chatter Odoo). */
export function Chatter(props: {
  model: string;
  id: string;
  version: number;
  labels: Record<string, string>;
}) {
  const { model, id, version, labels } = props;
  const { t, locale } = useI18n();
  const dateFmt = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const action = (a: string) =>
    ["create", "update", "delete", "comment"].includes(a) ? t(`chatter.${a}` as MessageKey) : a;
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    api<Entry[]>(`/activity/${model}/${id}`)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [model, id, version]);

  return (
    <aside className="panel chatter">
      <h2>{t("chatter.title")}</h2>
      {entries.length === 0 && <p className="muted">{t("chatter.empty")}</p>}
      <ol>
        {entries.map((e) => (
          <li key={e.id}>
            <strong>{e.userName ?? t("chatter.system")}</strong> {action(e.action)}
            <time className="muted"> · {dateFmt.format(new Date(e.createdAt))}</time>
            {e.message && <span className="muted"> · {e.message}</span>}
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
