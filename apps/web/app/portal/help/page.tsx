"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "../../../lib/i18n";
import { portalApi, portalSession } from "../../../lib/portal-api";
import { PortalHeader } from "../portal-header";

interface Article {
  id: string;
  title: string;
  category: string | null;
  body: string;
}

/** Portal: basis pengetahuan (artikel terbit) dengan pencarian. */
export default function PortalHelpPage() {
  const router = useRouter();
  const { l } = useI18n();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Article[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!portalSession.token()) return router.replace("/portal/login");
    const handle = setTimeout(() => {
      portalApi<Article[]>(`/portal/articles${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`)
        .then(setItems)
        .catch((e: Error) => setError(e.message));
    }, 250);
    return () => clearTimeout(handle);
  }, [q, router]);

  const toggle = (id: string) => {
    setOpen(open === id ? null : id);
    if (open !== id) void portalApi(`/portal/articles/${id}/view`, { method: "POST" }).catch(() => undefined);
  };

  return (
    <main className="shell">
      <PortalHeader title={l("Bantuan", "Help")} />
      {error && <p className="error">{error}</p>}
      <section className="panel stack">
        <input
          aria-label={l("Cari bantuan", "Search help")}
          placeholder={l("Cari, mis. reset sensor", "Search, e.g. reset sensor")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {items === null ? (
          <p className="muted">{l("Memuat…", "Loading…")}</p>
        ) : items.length === 0 ? (
          <p className="muted">
            {l("Tidak ada artikel yang cocok.", "No matching articles.")}{" "}
            <Link href="/portal/tickets">{l("Ajukan tiket", "Open a ticket")}</Link>
          </p>
        ) : (
          <ul className="plain-list stack">
            {items.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="link"
                  aria-expanded={open === a.id}
                  onClick={() => toggle(a.id)}
                >
                  {a.title}
                </button>
                {a.category && <small className="muted"> · {a.category}</small>}
                {open === a.id && <div style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{a.body}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
