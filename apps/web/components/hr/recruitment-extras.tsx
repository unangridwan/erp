"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { download } from "../accounting/download";
import { api } from "../../lib/api";
import { formatDate, money, today } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { errorText } from "./hr-panels";

interface Reason {
  id: string;
  name: string;
  active: boolean;
}

/** Tolak pelamar dengan alasan dari master alasan penolakan + catatan opsional. */
export function RefuseForm({
  onRefuse,
  open: initiallyOpen = false,
}: {
  onRefuse: (body: object) => Promise<void>;
  /** Langsung terbuka (mis. dari kanban saat kartu ditarik ke kolom Ditolak). */
  open?: boolean;
}) {
  const { l } = useI18n();
  const [open, setOpen] = useState(initiallyOpen);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (open) api<Reason[]>("/refuse-reasons?active=1").then(setReasons, () => setReasons([]));
  }, [open]);
  if (!open)
    return (
      <button type="button" className="danger" onClick={() => setOpen(true)}>
        {l("Tolak", "Refuse")}
      </button>
    );
  return (
    <div className="inline-panel refuse-form">
      <label className="field">
        <span>{l("Alasan penolakan", "Refusal reason")}</span>
        <select value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
          <option value="">—</option>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{l("Catatan", "Note")}</span>
        <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button
        type="button"
        className="danger"
        disabled={!reasonId}
        onClick={() =>
          void onRefuse({ stage: "refused", refuseReasonId: reasonId, refuseReason: note || null }).then(() =>
            setOpen(false),
          )
        }
      >
        {l("Tolak pelamar", "Refuse applicant")}
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        {l("Batal", "Cancel")}
      </button>
    </div>
  );
}

interface Offer {
  id: string;
  number: string | null;
  wage: string;
  benefits: string | null;
  contractType: "pkwt" | "pkwtt";
  contractEnd: string | null;
  startDate: string;
  validUntil: string;
  body: string;
  state: "draft" | "sent" | "accepted" | "declined" | "expired" | "cancel";
  responseNote: string | null;
}

const OFFER_STATE: Record<Offer["state"], [string, string, string]> = {
  draft: ["Draft", "Draft", "draft"],
  sent: ["Terkirim", "Sent", "posted"],
  accepted: ["Diterima", "Accepted", "sale"],
  declined: ["Ditolak pelamar", "Declined", "cancel"],
  expired: ["Kedaluwarsa", "Expired", "cancel"],
  cancel: ["Dibatalkan", "Cancelled", "cancel"],
};

/** Surat penawaran kerja: buat dari template, kirim, catat jawaban pelamar, unduh PDF. */
export function OffersPanel({
  applicantId,
  closed,
  onChange,
}: {
  applicantId: string;
  closed: boolean;
  onChange: () => void;
}) {
  const { l, locale } = useI18n();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [form, setForm] = useState({
    templateId: "",
    wage: "",
    benefits: "",
    contractType: "pkwtt",
    contractEnd: "",
    startDate: today(),
    validUntil: today(),
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () => api<Offer[]>(`/applicants/${applicantId}/offers`).then(setOffers, (e) => setError(errorText(e))),
    [applicantId],
  );
  useEffect(() => {
    void load();
    api<{ id: string; name: string; active: boolean }[]>("/offer-templates").then(
      (t) => {
        setTemplates(t.filter((x) => x.active));
        setForm((f) => ({ ...f, templateId: f.templateId || (t.find((x) => x.active)?.id ?? "") }));
      },
      () => setTemplates([]),
    );
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
      onChange();
    } catch (e) {
      setError(errorText(e));
    }
  }
  const active = offers.find((o) => ["draft", "sent", "accepted"].includes(o.state));

  return (
    <section className="panel">
      <h2>{l("Penawaran kerja", "Job offer")}</h2>
      {error && <p className="error">{error}</p>}
      {offers.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Nomor", "Number")}</th>
                <th className="num">{l("Gaji", "Wage")}</th>
                <th>{l("Mulai", "Start")}</th>
                <th>{l("Berlaku s.d.", "Valid until")}</th>
                <th>{l("Status", "Status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id}>
                  <td>{o.number}</td>
                  <td className="num">{money(o.wage, locale)}</td>
                  <td>{formatDate(o.startDate, locale)}</td>
                  <td>{formatDate(o.validUntil, locale)}</td>
                  <td>
                    <span className={`badge state-${OFFER_STATE[o.state][2]}`}>
                      {l(OFFER_STATE[o.state][0], OFFER_STATE[o.state][1])}
                    </span>
                    {o.responseNote && <small className="muted"> {o.responseNote}</small>}
                  </td>
                  <td className="offer-actions">
                    <button
                      type="button"
                      className="link"
                      onClick={() => setPreview(preview === o.body ? null : o.body)}
                    >
                      {l("Lihat", "View")}
                    </button>
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        download(`/job-offers/${o.id}/pdf`, `penawaran-${o.number ?? o.id}.pdf`).catch(
                          (e: Error) => setError(e.message),
                        )
                      }
                    >
                      PDF
                    </button>
                    {o.state === "draft" && (
                      <button
                        type="button"
                        className="link"
                        onClick={() => run(() => api(`/job-offers/${o.id}/send`, { method: "POST" }))}
                      >
                        {l("Tandai terkirim", "Mark sent")}
                      </button>
                    )}
                    {o.state === "sent" && (
                      <>
                        <button
                          type="button"
                          className="link"
                          onClick={() => {
                            const note = prompt(l("Catatan jawaban (opsional)", "Response note (optional)"));
                            if (note !== null)
                              void run(() =>
                                api(`/job-offers/${o.id}/accept`, {
                                  method: "POST",
                                  body: { note: note || null },
                                }),
                              );
                          }}
                        >
                          {l("Diterima pelamar", "Accepted")}
                        </button>
                        <button
                          type="button"
                          className="link"
                          onClick={() => {
                            const note = prompt(l("Alasan pelamar menolak", "Reason the applicant declined"));
                            if (note !== null)
                              void run(() =>
                                api(`/job-offers/${o.id}/decline`, {
                                  method: "POST",
                                  body: { note: note || null },
                                }),
                              );
                          }}
                        >
                          {l("Ditolak pelamar", "Declined")}
                        </button>
                      </>
                    )}
                    {(o.state === "draft" || o.state === "sent") && (
                      <button
                        type="button"
                        className="link"
                        onClick={() => run(() => api(`/job-offers/${o.id}/cancel`, { method: "POST" }))}
                      >
                        {l("Batalkan", "Cancel")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview && <pre className="offer-letter">{preview}</pre>}
      {!closed && !active && (
        <div className="inline-panel">
          <label className="field">
            <span>{l("Template", "Template")}</span>
            <select
              value={form.templateId}
              onChange={(e) => setForm({ ...form, templateId: e.target.value })}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Gaji pokok", "Base wage")}</span>
            <input
              className="num"
              inputMode="decimal"
              value={form.wage}
              onChange={(e) => setForm({ ...form, wage: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Tunjangan & fasilitas", "Benefits")}</span>
            <input
              value={form.benefits}
              maxLength={2000}
              onChange={(e) => setForm({ ...form, benefits: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Jenis kontrak", "Contract type")}</span>
            <select
              value={form.contractType}
              onChange={(e) => setForm({ ...form, contractType: e.target.value })}
            >
              <option value="pkwtt">PKWTT</option>
              <option value="pkwt">PKWT</option>
            </select>
          </label>
          {form.contractType === "pkwt" && (
            <label className="field">
              <span>{l("Kontrak berakhir", "Contract end")}</span>
              <input
                type="date"
                value={form.contractEnd}
                onChange={(e) => setForm({ ...form, contractEnd: e.target.value })}
              />
            </label>
          )}
          <label className="field">
            <span>{l("Mulai bekerja", "Start date")}</span>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Berlaku s.d.", "Valid until")}</span>
            <input
              type="date"
              value={form.validUntil}
              onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
            />
          </label>
          <button
            type="button"
            className="primary"
            disabled={!form.wage || !form.templateId}
            onClick={() =>
              run(() =>
                api(`/applicants/${applicantId}/offers`, {
                  method: "POST",
                  body: {
                    ...form,
                    benefits: form.benefits || null,
                    contractEnd: form.contractType === "pkwt" ? form.contractEnd || null : null,
                  },
                }),
              )
            }
          >
            {l("Buat penawaran", "Create offer")}
          </button>
        </div>
      )}
    </section>
  );
}

/** Permintaan FPK yang disetujui → buat lowongan. */
export function FpkOpeningButton({ requestId }: { requestId: string }) {
  const { l } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="primary"
        onClick={async () => {
          setError(null);
          try {
            const o = await api<{ id: string }>(`/job-openings/from-fpk/${requestId}`, { method: "POST" });
            router.push(`/job-openings/${o.id}`);
          } catch (e) {
            setError(errorText(e));
          }
        }}
      >
        {l("Buat lowongan", "Create job opening")}
      </button>
      {error && <span className="error">{error}</span>}
    </>
  );
}
