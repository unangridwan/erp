"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { useOptions, type AccountOption } from "../../../../components/accounting/use-options";
import { ask } from "../../../../components/feedback";

interface Settings {
  lockDate: string | null;
  purchaseApprovalAmount: string | null;
  deferredRevenueAccountId: string | null;
  deferredExpenseAccountId: string | null;
  wipAccountId: string | null;
  productionAbsorptionAccountId: string | null;
  costCenterRequired: boolean;
}

export default function AccountingSettingsPage() {
  const { l } = useI18n();
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [lockDate, setLockDate] = useState("");
  const [approval, setApproval] = useState("");
  const [deferredRevenue, setDeferredRevenue] = useState("");
  const [deferredExpense, setDeferredExpense] = useState("");
  const [costCenterRequired, setCostCenterRequired] = useState(false);
  const [wip, setWip] = useState("");
  const [absorption, setAbsorption] = useState("");
  const accounts = useOptions<AccountOption>("/accounts");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<Settings | null>("/accounting/settings").then((s) => {
      setSettings(s);
      setLockDate(s?.lockDate ?? "");
      setApproval(s?.purchaseApprovalAmount ? String(Number(s.purchaseApprovalAmount)) : "");
      setDeferredRevenue(s?.deferredRevenueAccountId ?? "");
      setDeferredExpense(s?.deferredExpenseAccountId ?? "");
      setCostCenterRequired(Boolean(s?.costCenterRequired));
      setWip(s?.wipAccountId ?? "");
      setAbsorption(s?.productionAbsorptionAccountId ?? "");
    });

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await api("/accounting/settings", {
        method: "PATCH",
        body: {
          lockDate: lockDate || null,
          purchaseApprovalAmount: approval || null,
          deferredRevenueAccountId: deferredRevenue || null,
          deferredExpenseAccountId: deferredExpense || null,
          costCenterRequired,
          wipAccountId: wip || null,
          productionAbsorptionAccountId: absorption || null,
        },
      });
      setNotice(l("Pengaturan disimpan.", "Settings saved."));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function install() {
    setError(null);
    try {
      await api("/accounting/setup", { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const [fiscalYear, setFiscalYear] = useState(String(new Date().getFullYear() - 1));

  async function closeYear() {
    setError(null);
    setNotice(null);
    if (
      !(await ask(
        l(
          `Tutup buku tahun fiskal ${fiscalYear}? Saldo laba rugi dipindah ke saldo laba dan periode dikunci.`,
          `Close fiscal year ${fiscalYear}? P&L balances move to retained earnings and the period is locked.`,
        ),
      ))
    )
      return;
    try {
      const r = await api<{ name: string; netProfit: string }>("/accounting/close-year", {
        method: "POST",
        body: { fiscalYear: Number(fiscalYear) },
      });
      setNotice(
        l(
          `Tahun ${fiscalYear} ditutup (${r.name}); laba bersih ${r.netProfit}.`,
          `Year ${fiscalYear} closed (${r.name}); net profit ${r.netProfit}.`,
        ),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (settings === undefined) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;

  return (
    <div className="panel narrow">
      <h1>{l("Pengaturan akuntansi", "Accounting settings")}</h1>
      {settings === null ? (
        <div className="stack">
          <p>
            {l(
              "Akuntansi belum disiapkan untuk perusahaan ini.",
              "Accounting is not set up for this company yet.",
            )}
          </p>
          <button className="primary" onClick={install}>
            {l("Pasang bagan akun standar Indonesia", "Install the standard Indonesian chart of accounts")}
          </button>
        </div>
      ) : (
        <form className="stack" onSubmit={save}>
          <label className="field">
            <span>{l("Kunci periode sampai tanggal", "Lock entries up to")}</span>
            <input type="date" value={lockDate} onChange={(e) => setLockDate(e.target.value)} />
          </label>
          <p className="muted">
            {l(
              "Entri bertanggal pada atau sebelum tanggal ini tidak bisa diposting (tutup buku).",
              "Entries dated on or before this date cannot be posted (period close).",
            )}
          </p>
          <label className="field">
            <span>{l("Batas persetujuan PO", "Purchase approval limit")}</span>
            <input
              className="num"
              inputMode="decimal"
              value={approval}
              onChange={(e) => setApproval(e.target.value)}
            />
          </label>
          <p className="muted">
            {l(
              "Batas default: PO dengan total di atas nilai ini (mata uang perusahaan) harus disetujui user ber-hak purchase.approve. Kosong = tanpa persetujuan. Batas per peran/pengguna dan alur bertingkat diatur di Pengaturan › Aturan Persetujuan.",
              "Default limit: purchase orders above this total (company currency) need approval by a user with purchase.approve. Empty = no approval. Per-role/user limits and tiered flows are set in Settings › Approval Rules.",
            )}
          </p>
          <label className="field">
            <span>{l("Akun pendapatan diterima di muka", "Deferred revenue account")}</span>
            <select value={deferredRevenue} onChange={(e) => setDeferredRevenue(e.target.value)}>
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Akun biaya dibayar di muka", "Prepaid expense account")}</span>
            <select value={deferredExpense} onChange={(e) => setDeferredExpense(e.target.value)}>
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            {l(
              "Baris faktur/tagihan yang diberi periode penangguhan dicatat ke akun ini saat diposting, lalu diakui prorata per bulan.",
              "Invoice/bill lines with a deferral period are booked to these accounts on posting, then recognized pro rata each month.",
            )}
          </p>
          <label className="field">
            <span>{l("Akun barang dalam proses (WIP)", "Work-in-progress account")}</span>
            <select value={wip} onChange={(e) => setWip(e.target.value)}>
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>
              {l("Akun biaya konversi produksi dibebankan", "Applied production conversion cost account")}
            </span>
            <select value={absorption} onChange={(e) => setAbsorption(e.target.value)}>
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            {l(
              "Order produksi: bahan keluar ke WIP, biaya tenaga kerja & overhead (jam × tarif stasiun kerja) dibebankan ke WIP lewat akun biaya konversi, lalu barang jadi masuk persediaan sebesar total biaya.",
              "Production orders: components move into WIP, labor & overhead (hours × work center rate) are applied to WIP via the conversion cost account, then finished goods enter inventory at total cost.",
            )}
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={costCenterRequired}
              onChange={(e) => setCostCenterRequired(e.target.checked)}
            />
            {l(
              "Cost center wajib untuk baris akun beban (operasional & penyusutan)",
              "Require a cost center on expense account lines (operating & depreciation)",
            )}
          </label>
          <p className="muted">
            {l(
              "Entri tidak bisa diposting bila baris beban tanpa cost center. Isi cost center di baris, atau atur cost center bawaan di akun, departemen, karyawan, aset, dan kendaraan agar terisi otomatis.",
              "Entries cannot be posted while an expense line has no cost center. Fill it on the line, or set default cost centers on accounts, departments, employees, assets, and vehicles so it is filled automatically.",
            )}
          </p>
          <button className="primary">{l("Simpan", "Save")}</button>
        </form>
      )}
      {settings !== null && (
        <section className="stack close-year">
          <h2>{l("Tutup buku akhir tahun", "Year-end closing")}</h2>
          <p className="muted">
            {l(
              "Membuat entri penutup yang memindahkan saldo pendapatan & beban ke Saldo Laba, lalu mengunci periode sampai akhir tahun fiskal.",
              "Creates a closing entry moving income & expense balances to Retained Earnings, then locks the period up to fiscal year end.",
            )}
          </p>
          <label className="field">
            <span>{l("Tahun fiskal (tahun berakhirnya)", "Fiscal year (ending year)")}</span>
            <input
              type="number"
              min={2000}
              max={2100}
              value={fiscalYear}
              onChange={(e) => setFiscalYear(e.target.value)}
            />
          </label>
          <button className="danger" onClick={closeYear}>
            {l("Tutup buku", "Close year")}
          </button>
        </section>
      )}
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
