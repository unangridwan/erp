"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

interface Settings {
  lockDate: string | null;
}

export default function AccountingSettingsPage() {
  const { l } = useI18n();
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [lockDate, setLockDate] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<Settings | null>("/accounting/settings").then((s) => {
      setSettings(s);
      setLockDate(s?.lockDate ?? "");
    });

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await api("/accounting/settings", { method: "PATCH", body: { lockDate: lockDate || null } });
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
      !confirm(
        l(
          `Tutup buku tahun fiskal ${fiscalYear}? Saldo laba rugi dipindah ke saldo laba dan periode dikunci.`,
          `Close fiscal year ${fiscalYear}? P&L balances move to retained earnings and the period is locked.`,
        ),
      )
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
