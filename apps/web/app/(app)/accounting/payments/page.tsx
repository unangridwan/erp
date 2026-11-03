"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { DataTable, type DataColumn } from "../../../../components/data-table";
import { useOptions, type JournalOption } from "../../../../components/accounting/use-options";
import { useMe } from "../../../../components/me-context";
import { RefSelect } from "../../../../components/ref-select";
import { api } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { useListData } from "../../../../lib/use-list-data";

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
  const list = useListData<Payment>("/payments");
  const [form, setForm] = useState({
    paymentType: "inbound",
    partnerId: "",
    journalId: "",
    amount: "",
    date: today(),
    memo: "",
  });
  const [error, setError] = useState<string | null>(null);

  const columns = useMemo<DataColumn<Payment>[]>(
    () => [
      {
        key: "date",
        label: l("Tanggal", "Date"),
        type: "date",
        value: (p) => p.date,
        text: (p) => formatDate(p.date, locale),
      },
      {
        key: "move",
        label: l("Jurnal", "Journal entry"),
        value: (p) => p.moveName,
        render: (p) => <Link href={`/accounting/moves/${p.moveId}`}>{p.moveName}</Link>,
      },
      { key: "partner", label: l("Partner", "Partner"), value: (p) => p.partnerName },
      {
        key: "paymentType",
        label: l("Arah", "Direction"),
        type: "enum",
        value: (p) => p.paymentType,
        text: (p) => (p.paymentType === "inbound" ? l("Masuk", "Received") : l("Keluar", "Sent")),
      },
      { key: "journal", label: l("Kas/bank", "Bank/cash"), type: "enum", value: (p) => p.journalName },
      { key: "memo", label: l("Memo", "Memo"), value: (p) => p.memo, hidden: true },
      {
        key: "amount",
        label: l("Jumlah", "Amount"),
        type: "number",
        className: "num",
        value: (p) => Number(p.amount),
        text: (p) => `${p.currencyCode} ${money(p.amount, locale)}`,
      },
    ],
    [l, locale],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/payments", {
        method: "POST",
        body: { ...form, journalId: form.journalId || journals[0]?.id, memo: form.memo || null },
      });
      setForm((f) => ({ ...f, amount: "", memo: "" }));
      list.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <header className="toolbar">
        <h1>{l("Pembayaran", "Payments")}</h1>
      </header>
      {list.error && <p className="error">{list.error}</p>}
      <DataTable
        rows={list.rows}
        columns={columns}
        storageKey="payments"
        rowKey={(p) => p.id}
        defaultSort={{ key: "date", dir: "desc" }}
        empty={l("Belum ada pembayaran.", "No payments yet.")}
      />

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
