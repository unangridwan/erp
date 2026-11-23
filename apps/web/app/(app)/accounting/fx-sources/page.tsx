"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Settings {
  source: "manual" | "frankfurter";
  currencies: string[];
  daily: boolean;
  lastFetchAt?: string | null;
  lastError?: string | null;
}

/** Sumber kurs otomatis: kurs referensi ECB (Frankfurter) diambil manual atau harian. */
export default function FxSourcesPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const [form, setForm] = useState<Settings | null>(null);
  const [currencies, setCurrencies] = useState("");
  const [date, setDate] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const writable = can(me.permissions, "currency.write");

  const load = () =>
    api<Settings>("/fx/settings")
      .then((s) => {
        setForm(s);
        setCurrencies(s.currencies.join(", "));
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => void load(), []);

  async function run(fn: () => Promise<string>) {
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : String(e));
    }
    void load();
  }
  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api("/fx/settings", {
        method: "PUT",
        body: {
          source: form!.source,
          daily: form!.daily,
          currencies: currencies.split(/[\s,]+/).filter(Boolean),
        },
      });
      return l("Pengaturan disimpan.", "Settings saved.");
    });
  };
  const fetchNow = () =>
    run(async () => {
      const res = await api<{ rates: { currencyCode: string; rateDate: string; rate: string }[] }>(
        "/fx/fetch",
        {
          method: "POST",
          body: date ? { date } : {},
        },
      );
      return res.rates
        .map(
          (r) =>
            `${r.currencyCode} ${Number(r.rate).toLocaleString(locale === "id" ? "id-ID" : "en-US")} (${r.rateDate})`,
        )
        .join(" · ");
    });

  if (!form) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  return (
    <form className="panel narrow stack" onSubmit={save}>
      <h1>{l("Sumber Kurs Otomatis", "Automatic Exchange Rates")}</h1>
      <p className="muted">
        {l(
          "Kurs referensi Bank Sentral Eropa (lewat API Frankfurter) disimpan sebagai Kurs Harian (IDR per 1 unit). Untuk pajak (kurs KMK) tetap isi manual — Kemenkeu tidak menyediakan API resmi.",
          "European Central Bank reference rates (via the Frankfurter API) are stored as daily rates (IDR per unit). For tax purposes (KMK rates) enter them manually — the Ministry of Finance offers no official API.",
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="notice">{notice}</p>}
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }} disabled={!writable}>
        <label className="field">
          <span>{l("Sumber", "Source")}</span>
          <select
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value as Settings["source"] })}
          >
            <option value="manual">{l("Manual", "Manual")}</option>
            <option value="frankfurter">
              {l("Kurs referensi ECB (Frankfurter)", "ECB reference rates (Frankfurter)")}
            </option>
          </select>
        </label>
        <label className="field">
          <span>{l("Mata uang (pisahkan dengan koma)", "Currencies (comma separated)")}</span>
          <input
            value={currencies}
            onChange={(e) => setCurrencies(e.target.value)}
            placeholder="USD, EUR, SGD"
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={form.daily}
            onChange={(e) => setForm({ ...form, daily: e.target.checked })}
          />
          {l("Ambil otomatis setiap hari", "Fetch automatically every day")}
        </label>
        <button className="primary">{l("Simpan", "Save")}</button>
      </fieldset>
      {form.source !== "manual" && writable && (
        <div className="inline-panel">
          <label className="field">
            <span>{l("Tanggal (kosong = terbaru)", "Date (empty = latest)")}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button type="button" onClick={fetchNow}>
            {l("Ambil kurs sekarang", "Fetch rates now")}
          </button>
        </div>
      )}
      <p className="muted small">
        {form.lastFetchAt &&
          `${l("Terakhir diambil", "Last fetched")}: ${new Date(form.lastFetchAt).toLocaleString(locale === "id" ? "id-ID" : "en-GB")}`}
        {form.lastError && <span className="error"> · {form.lastError}</span>}
      </p>
    </form>
  );
}
