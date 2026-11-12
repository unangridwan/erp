"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { formatDate, money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { can } from "../../lib/resources";
import { toast } from "../feedback";
import { openPdf } from "../hr/contract-document";
import { useMe } from "../me-context";

export interface CreditStatus {
  creditLimit: string | null;
  overdueWarnDays: number | null;
  dunningExcluded: boolean;
  note: string | null;
  currencyCode: string;
  receivable: string;
  uninvoicedOrders: string;
  draftInvoices: string;
  orderAmount: string;
  exposure: string;
  available: string | null;
  usedPercent: number | null;
  exceeded: boolean;
  overdueWarning: boolean;
  oldestOverdueDays: number;
  warnings?: string[];
}

interface LetterRow {
  id: string;
  name: string;
  date: string;
  levelName: string;
  state: "sent" | "failed" | "printed";
  totalOverdue: string;
  currencyCode: string;
}

export const LETTER_STATE: Record<LetterRow["state"], [string, string]> = {
  sent: ["Terkirim", "Sent"],
  failed: ["Gagal kirim", "Failed"],
  printed: ["Dicetak", "Printed"],
};

/** Batas kredit & penagihan pelanggan di perusahaan aktif (panel form kontak). */
export function CreditPanel({ id }: { id: string }) {
  const me = useMe();
  const { l, locale } = useI18n();
  const [status, setStatus] = useState<CreditStatus | null>(null);
  const [letters, setLetters] = useState<LetterRow[]>([]);
  const [form, setForm] = useState({
    creditLimit: "",
    overdueWarnDays: "",
    dunningExcluded: false,
    note: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const canRead = can(me.permissions, "accounting.read");
  const writable = can(me.permissions, "accounting.manage");

  const load = useCallback(async () => {
    const s = await api<CreditStatus>(`/partners/${id}/credit`);
    setStatus(s);
    setForm({
      creditLimit: s.creditLimit === null ? "" : s.creditLimit.replace(/\.00$/, ""),
      overdueWarnDays: s.overdueWarnDays === null ? "" : String(s.overdueWarnDays),
      dunningExcluded: s.dunningExcluded,
      note: s.note ?? "",
    });
    if (canRead) setLetters(await api<LetterRow[]>(`/dunning-letters?partnerId=${id}`).catch(() => []));
  }, [id, canRead]);

  useEffect(() => {
    load().catch(() => setStatus(null));
  }, [load]);

  if (!status) return null;

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      await api(`/partners/${id}/credit`, {
        method: "PUT",
        body: {
          creditLimit: form.creditLimit.trim() === "" ? null : form.creditLimit.trim(),
          overdueWarnDays: form.overdueWarnDays.trim() === "" ? null : Number(form.overdueWarnDays),
          dunningExcluded: form.dunningExcluded,
          note: form.note.trim() || null,
        },
      });
      toast.success(l("Batas kredit disimpan", "Credit limit saved"));
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors) setErrors(e.fieldErrors);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const cur = status.currencyCode;
  const pct = status.usedPercent === null ? null : Math.min(100, status.usedPercent);

  return (
    <section className="panel">
      <h2>{l("Kredit & penagihan", "Credit & collections")}</h2>
      <p className="muted">
        {l(
          "Berlaku untuk perusahaan aktif. Batas kredit hanya memberi peringatan saat pesanan dikonfirmasi; tidak memblokir.",
          "Applies to the active company. The credit limit only warns when an order is confirmed; it does not block.",
        )}
      </p>
      {(status.exceeded || status.overdueWarning) && (
        <p className="error" role="alert">
          {status.exceeded &&
            l(
              `Paparan melebihi batas kredit (${money(status.exposure, locale)} dari ${money(status.creditLimit, locale)} ${cur}).`,
              `Exposure exceeds the credit limit (${money(status.exposure, locale)} of ${money(status.creditLimit, locale)} ${cur}).`,
            )}{" "}
          {status.overdueWarning &&
            l(
              `Ada faktur menunggak ${status.oldestOverdueDays} hari.`,
              `An invoice is ${status.oldestOverdueDays} days overdue.`,
            )}
        </p>
      )}
      <div className="credit-summary">
        <div>
          <span className="muted">{l("Piutang terbuka", "Open receivables")}</span>
          <strong>{money(status.receivable, locale)}</strong>
        </div>
        <div>
          <span className="muted">{l("SO belum ditagih", "Uninvoiced orders")}</span>
          <strong>{money(status.uninvoicedOrders, locale)}</strong>
        </div>
        <div>
          <span className="muted">{l("Faktur draft", "Draft invoices")}</span>
          <strong>{money(status.draftInvoices, locale)}</strong>
        </div>
        <div>
          <span className="muted">
            {l("Total paparan", "Total exposure")} ({cur})
          </span>
          <strong>{money(status.exposure, locale)}</strong>
        </div>
        <div>
          <span className="muted">{l("Sisa batas", "Available")}</span>
          <strong className={status.exceeded ? "credit-neg" : undefined}>
            {status.available === null ? l("Tanpa batas", "No limit") : money(status.available, locale)}
          </strong>
        </div>
        <div>
          <span className="muted">{l("Tunggakan tertua", "Oldest overdue")}</span>
          <strong>
            {status.oldestOverdueDays > 0 ? `${status.oldestOverdueDays} ${l("hari", "days")}` : "—"}
          </strong>
        </div>
      </div>
      {pct !== null && (
        <div
          className={`meter${status.exceeded ? " meter-over" : ""}`}
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={l("Batas kredit terpakai", "Credit limit used")}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="fields credit-form">
        <label className="field">
          <span>
            {l("Batas kredit", "Credit limit")} ({cur})
          </span>
          <input
            inputMode="decimal"
            value={form.creditLimit}
            disabled={!writable}
            placeholder={l("Kosong = tanpa batas", "Empty = no limit")}
            aria-invalid={Boolean(errors.creditLimit)}
            onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
          />
          {errors.creditLimit && <small className="error">{errors.creditLimit}</small>}
        </label>
        <label className="field">
          <span>{l("Peringatan tunggakan lebih dari (hari)", "Warn when overdue more than (days)")}</span>
          <input
            type="number"
            min={0}
            value={form.overdueWarnDays}
            disabled={!writable}
            placeholder={l("Kosong = tidak diperiksa", "Empty = not checked")}
            aria-invalid={Boolean(errors.overdueWarnDays)}
            onChange={(e) => setForm({ ...form, overdueWarnDays: e.target.value })}
          />
          {errors.overdueWarnDays && <small className="error">{errors.overdueWarnDays}</small>}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={form.dunningExcluded}
            disabled={!writable}
            onChange={(e) => setForm({ ...form, dunningExcluded: e.target.checked })}
          />
          {l("Jangan kirim surat teguran (dunning)", "Exclude from dunning letters")}
        </label>
        <label className="field">
          <span>{l("Catatan", "Note")}</span>
          <input
            value={form.note}
            maxLength={300}
            disabled={!writable}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </label>
      </div>
      {writable && (
        <div className="cp-right">
          <button type="button" className="primary" disabled={busy} aria-busy={busy} onClick={save}>
            {l("Simpan", "Save")}
          </button>
        </div>
      )}

      {canRead && letters.length > 0 && (
        <>
          <h3>{l("Riwayat surat teguran", "Dunning letter history")}</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Nomor", "Number")}</th>
                  <th>{l("Tanggal", "Date")}</th>
                  <th>{l("Tingkat", "Level")}</th>
                  <th className="num">{l("Tertunggak", "Overdue")}</th>
                  <th>{l("Status", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {letters.slice(0, 10).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href="#" onClick={(e) => void openLetterPdf(e, r.id, r.name)}>
                        {r.name}
                      </a>
                    </td>
                    <td>{formatDate(r.date, locale)}</td>
                    <td>{r.levelName}</td>
                    <td className="num">{money(r.totalOverdue, locale)}</td>
                    <td>{l(...LETTER_STATE[r.state])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <Link href={`/accounting/dunning?partnerId=${id}`}>{l("Lihat semua", "See all")}</Link>
          </p>
        </>
      )}
    </section>
  );
}

/** Buka PDF surat teguran di tab baru (endpoint butuh token). */
export async function openLetterPdf(
  e: { preventDefault(): void } | null,
  id: string,
  name = "surat-teguran",
) {
  e?.preventDefault();
  await openPdf(`/dunning-letters/${id}/pdf`, `${name.replace(/[^\w.-]+/g, "_")}.pdf`).catch((err: unknown) =>
    toast.error(err instanceof Error ? err.message : String(err)),
  );
}

/** Peringatan kredit di form pesanan penjualan (tidak memblokir). */
export function OrderCreditBanner({ orderId, refreshKey }: { orderId: string; refreshKey?: unknown }) {
  const { l } = useI18n();
  const [check, setCheck] = useState<CreditStatus | null>(null);
  useEffect(() => {
    api<CreditStatus>(`/sale-orders/${orderId}/credit-check`)
      .then(setCheck)
      .catch(() => setCheck(null));
  }, [orderId, refreshKey]);
  if (!check?.warnings?.length) return null;
  return (
    <div className="error credit-banner" role="status">
      <strong>{l("Peringatan kredit pelanggan", "Customer credit warning")}</strong>
      <ul>
        {check.warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}
