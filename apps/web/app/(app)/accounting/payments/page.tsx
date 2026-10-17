"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useOptions, type JournalOption } from "../../../../components/accounting/use-options";
import { useMe } from "../../../../components/me-context";
import { RefSelect } from "../../../../components/ref-select";
import { api } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Payment {
  id: string;
  date: string;
  paymentType: string;
  amount: string;
  currencyCode: string;
  memo: string | null;
  partnerName: string;
  journalName: string;
  moveId: string;
  moveName: string;
}

export default function PaymentsPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const journals = useOptions<JournalOption>("/journals").filter(
    (j) => j.journalType === "bank" || j.journalType === "cash",
  );
  const [payments, setPayments] = useState<Payment[]>([]);
  const [reload, setReload] = useState(0);
  const [form, setForm] = useState({
    paymentType: "inbound",
    partnerId: "",
    journalId: "",
    amount: "",
    date: today(),
    memo: "",
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Payment[]>("/payments")
      .then(setPayments)
      .catch((e: Error) => setError(e.message));
  }, [reload]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/payments", {
        method: "POST",
        body: { ...form, journalId: form.journalId || journals[0]?.id, memo: form.memo || null },
      });
      setForm((f) => ({ ...f, amount: "", memo: "" }));
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <header className="toolbar">
        <h1>{l("Pembayaran", "Payments")}</h1>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Tanggal", "Date")}</th>
              <th>{l("Jurnal", "Journal entry")}</th>
              <th>{l("Partner", "Partner")}</th>
              <th>{l("Arah", "Direction")}</th>
              <th>{l("Kas/bank", "Bank/cash")}</th>
              <th className="num">{l("Jumlah", "Amount")}</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>{formatDate(p.date, locale)}</td>
                <td>
                  <Link href={`/accounting/moves/${p.moveId}`}>{p.moveName}</Link>
                </td>
                <td>{p.partnerName}</td>
                <td>{p.paymentType === "inbound" ? l("Masuk", "Received") : l("Keluar", "Sent")}</td>
                <td>{p.journalName}</td>
                <td className="num">
                  {p.currencyCode} {money(p.amount, locale)}
                </td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {l("Belum ada pembayaran.", "No payments yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {can(me.permissions, "accounting.post") && (
        <form className="panel stack invite" onSubmit={submit}>
          <h2>{l("Pembayaran tanpa faktur (uang muka, dsb.)", "Payment without invoice (advance, etc.)")}</h2>
          <p className="muted">
            {l(
              "Untuk melunasi faktur atau tagihan, buka dokumennya lalu pilih Terima/Bayar.",
              "To settle an invoice or bill, open it and use Register payment.",
            )}
          </p>
          <div className="fields">
            <label className="field">
              <span>{l("Arah", "Direction")}</span>
              <select
                value={form.paymentType}
                onChange={(e) => setForm((f) => ({ ...f, paymentType: e.target.value }))}
              >
                <option value="inbound">{l("Terima dari pelanggan", "Receive from customer")}</option>
                <option value="outbound">{l("Bayar ke pemasok", "Pay vendor")}</option>
              </select>
            </label>
            <label className="field">
              <span>{l("Partner *", "Partner *")}</span>
              <RefSelect
                name="partnerId"
                resource="partners"
                display="name"
                value={form.partnerId}
                required
                onChange={(v) => setForm((f) => ({ ...f, partnerId: v }))}
              />
            </label>
            <label className="field">
              <span>{l("Jurnal kas/bank", "Bank/cash journal")}</span>
              <select
                value={form.journalId}
                onChange={(e) => setForm((f) => ({ ...f, journalId: e.target.value }))}
              >
                {journals.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.code} — {j.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Jumlah *", "Amount *")}</span>
              <input
                className="num"
                inputMode="decimal"
                required
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>{l("Tanggal", "Date")}</span>
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>{l("Memo", "Memo")}</span>
              <input value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} />
            </label>
          </div>
          <button className="primary">{l("Catat pembayaran", "Create payment")}</button>
          {error && <p className="error">{error}</p>}
        </form>
      )}
    </>
  );
}
