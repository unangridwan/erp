"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useOptions, type JournalOption } from "../../../../components/accounting/use-options";
import { toast } from "../../../../components/feedback";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { RUN_STATE } from "../../../../components/accounting/payment-run-state";

interface RunRow {
  id: string;
  name: string;
  paymentDate: string;
  dueUntil: string;
  state: string;
  total: string;
  vendors: number;
  bills: number;
}

/** Daftar payment run + buat usulan baru dari tagihan jatuh tempo. */
export default function PaymentRunsPage() {
  const me = useMe();
  const router = useRouter();
  const { l, locale } = useI18n();
  const journals = useOptions<JournalOption>("/journals").filter((j) => j.journalType === "bank");
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [form, setForm] = useState({ paymentDate: today(), dueUntil: today(), journalId: "" });
  const [busy, setBusy] = useState(false);
  const writable = can(me.permissions, "accounting.write");

  useEffect(() => {
    api<RunRow[]>("/payment-runs")
      .then(setRows)
      .catch((e: Error) => toast.error(e.message));
  }, []);
  useEffect(() => {
    if (!form.journalId && journals[0]) setForm((f) => ({ ...f, journalId: journals[0]!.id }));
  }, [journals, form.journalId]);

  const create = async () => {
    setBusy(true);
    try {
      const run = await api<{ id: string }>("/payment-runs", { method: "POST", body: form });
      router.push(`/accounting/payment-runs/${run.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="toolbar">
        <h1>{l("Pembayaran Massal", "Payment runs")}</h1>
      </header>
      <p className="muted">
        {l(
          "Bayar tagihan pemasok yang jatuh tempo sekaligus: usulan dibuat otomatis, diajukan untuk persetujuan, lalu dieksekusi menjadi pembayaran per pemasok dan file transfer massal bank.",
          "Pay due vendor bills in one go: the proposal is built automatically, submitted for approval, then executed into one payment per vendor and a bank bulk-transfer file.",
        )}
      </p>
      {writable && (
        <div className="panel filters">
          <label className="field">
            <span>{l("Tagihan jatuh tempo s.d.", "Bills due by")}</span>
            <input
              type="date"
              value={form.dueUntil}
              onChange={(e) => setForm({ ...form, dueUntil: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Tanggal bayar", "Payment date")}</span>
            <input
              type="date"
              value={form.paymentDate}
              onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Bank", "Bank")}</span>
            <select value={form.journalId} onChange={(e) => setForm({ ...form, journalId: e.target.value })}>
              {journals.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code} {j.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={busy || !form.journalId} aria-busy={busy} onClick={create}>
            {l("Buat usulan", "Create proposal")}
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Nomor", "Number")}</th>
              <th>{l("Tanggal bayar", "Payment date")}</th>
              <th>{l("Jatuh tempo s.d.", "Due by")}</th>
              <th className="num">{l("Pemasok", "Vendors")}</th>
              <th className="num">{l("Tagihan", "Bills")}</th>
              <th className="num">{l("Total", "Total")}</th>
              <th>{l("Status", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {l("Belum ada payment run.", "No payment runs yet.")}
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/accounting/payment-runs/${r.id}`}>{r.name}</Link>
                </td>
                <td>{formatDate(r.paymentDate, locale)}</td>
                <td>{formatDate(r.dueUntil, locale)}</td>
                <td className="num">{r.vendors}</td>
                <td className="num">{r.bills}</td>
                <td className="num">{money(r.total, locale)}</td>
                <td>{l(...(RUN_STATE[r.state] ?? [r.state, r.state]))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
