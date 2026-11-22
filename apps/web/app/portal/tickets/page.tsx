"use client";

import { TICKET_PRIORITY_LABEL, TICKET_PRIORITY_VALUES, TICKET_STATUS_LABEL } from "@erp/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { formatDate } from "../../../lib/format";
import { useI18n } from "../../../lib/i18n";
import { portalApi, portalSession } from "../../../lib/portal-api";
import { PortalHeader } from "../portal-header";

interface Ticket {
  id: string;
  number: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  companyName: string;
}

/** Portal: daftar tiket bantuan pelanggan dan formulir tiket baru. */
export default function PortalTicketsPage() {
  const router = useRouter();
  const { l, locale } = useI18n();
  const [items, setItems] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ subject: "", description: "", priority: "normal" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!portalSession.token()) return router.replace("/portal/login");
    portalApi<Ticket[]>("/portal/tickets")
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const t = await portalApi<{ id: string }>("/portal/tickets", { method: "POST", body: form });
      router.push(`/portal/tickets/${t.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <PortalHeader title={l("Tiket bantuan", "Support tickets")} />
      {error && <p className="error">{error}</p>}
      <form className="panel stack" onSubmit={submit}>
        <h2>{l("Ajukan pertanyaan atau keluhan", "Ask a question or report a problem")}</h2>
        <p className="muted">
          {l("Coba cari jawabannya dulu di", "Try searching for an answer first in")}{" "}
          <Link href="/portal/help">{l("halaman Bantuan", "the Help page")}</Link>.
        </p>
        <label className="field">
          <span>{l("Subjek *", "Subject *")}</span>
          <input
            required
            maxLength={200}
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
          />
        </label>
        <label className="field">
          <span>{l("Uraian *", "Description *")}</span>
          <textarea
            required
            rows={5}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label className="field">
          <span>{l("Tingkat urgensi", "Urgency")}</span>
          <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {TICKET_PRIORITY_VALUES.map((p) => (
              <option key={p} value={p}>
                {l(...TICKET_PRIORITY_LABEL[p]!)}
              </option>
            ))}
          </select>
        </label>
        <div>
          <button className="primary" disabled={busy}>
            {l("Kirim tiket", "Submit ticket")}
          </button>
        </div>
      </form>
      <h2>{l("Tiket saya", "My tickets")}</h2>
      {items === null ? (
        <p className="muted">{l("Memuat…", "Loading…")}</p>
      ) : items.length === 0 ? (
        <p className="muted">{l("Belum ada tiket.", "No tickets yet.")}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Nomor", "Number")}</th>
                <th>{l("Subjek", "Subject")}</th>
                <th>{l("Status", "Status")}</th>
                <th>{l("Dibuat", "Created")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/portal/tickets/${t.id}`}>{t.number}</Link>
                  </td>
                  <td>{t.subject}</td>
                  <td>
                    <span className="badge">{l(...TICKET_STATUS_LABEL[t.status]!)}</span>
                  </td>
                  <td>{formatDate(t.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
