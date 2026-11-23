"use client";

import { TICKET_STATUS_LABEL } from "@erp/shared";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "../../../../lib/i18n";
import { portalApi, portalSession } from "../../../../lib/portal-api";
import { PortalHeader } from "../../portal-header";

interface Ticket {
  id: string;
  number: string;
  subject: string;
  description: string | null;
  status: string;
  createdAt: string;
  satisfaction: number | null;
  satisfactionNote: string | null;
  messages: { kind: "public" | "customer"; body: string; authorName: string | null; createdAt: string }[];
}

/** Portal: percakapan tiket, balasan pelanggan, dan penilaian setelah selesai. */
export default function PortalTicketPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { l, locale } = useI18n();
  const [t, setT] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [rating, setRating] = useState({ satisfaction: 5, note: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!portalSession.token()) return router.replace("/portal/login");
    portalApi<Ticket>(`/portal/tickets/${id}`)
      .then(setT)
      .catch((e: Error) => setError(e.message));
  }, [id, router]);

  async function act(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      setT(await portalApi<Ticket>(path, { method: "POST", body }));
      setReply("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const when = (v: string) =>
    new Date(v).toLocaleString(locale === "id" ? "id-ID" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const done = t && (t.status === "resolved" || t.status === "closed");

  return (
    <main className="shell">
      <PortalHeader title={t?.number} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!t ? (
        !error && <p className="muted">{l("Memuat…", "Loading…")}</p>
      ) : (
        <section className="panel stack">
          <h1>{t.subject}</h1>
          <p>
            <span className="badge">{l(...TICKET_STATUS_LABEL[t.status]!)}</span>{" "}
            <small className="muted">{when(t.createdAt)}</small>
          </p>
          {t.description && <p style={{ whiteSpace: "pre-wrap" }}>{t.description}</p>}
          <ul className="plain-list ticket-thread">
            {t.messages.map((m, i) => (
              <li key={i} className={`ticket-message ticket-${m.kind}`}>
                <strong>
                  {m.kind === "customer" ? l("Anda", "You") : (m.authorName ?? l("Tim kami", "Our team"))}
                </strong>{" "}
                <small className="muted">{when(m.createdAt)}</small>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
              </li>
            ))}
          </ul>
          {t.status !== "closed" && (
            <>
              <label className="field">
                <span>{l("Balas", "Reply")}</span>
                <textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} />
              </label>
              <div>
                <button
                  className="primary"
                  disabled={busy || !reply.trim()}
                  onClick={() => act(`/portal/tickets/${id}/messages`, { body: reply })}
                >
                  {l("Kirim balasan", "Send reply")}
                </button>
              </div>
            </>
          )}
          {done &&
            (t.satisfaction ? (
              <p>
                {l("Penilaian Anda", "Your rating")}: {"★".repeat(t.satisfaction)}
                {t.satisfactionNote ? ` — ${t.satisfactionNote}` : ""}
              </p>
            ) : (
              <div className="inline-panel">
                <label className="field">
                  <span>{l("Seberapa puas Anda?", "How satisfied are you?")}</span>
                  <select
                    value={rating.satisfaction}
                    onChange={(e) => setRating({ ...rating, satisfaction: Number(e.target.value) })}
                  >
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {"★".repeat(n)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{l("Komentar", "Comment")}</span>
                  <input
                    value={rating.note}
                    onChange={(e) => setRating({ ...rating, note: e.target.value })}
                  />
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
                    act(`/portal/tickets/${id}/rating`, {
                      satisfaction: rating.satisfaction,
                      note: rating.note || null,
                    })
                  }
                >
                  {l("Kirim penilaian", "Submit rating")}
                </button>
              </div>
            ))}
        </section>
      )}
    </main>
  );
}
