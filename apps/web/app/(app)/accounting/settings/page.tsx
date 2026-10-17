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
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
