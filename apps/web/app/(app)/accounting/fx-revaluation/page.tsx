"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Line {
  accountId: string;
  accountCode: string;
  accountName: string;
  partnerName: string | null;
  currencyCode: string;
  amountCurrency: string;
  bookValue: string;
  rate: string;
  revalued: string;
  difference: string;
}
interface Preview {
  date: string;
  currencyCode: string;
  lines: Line[];
  gain: string;
  loss: string;
}
interface Revaluation {
  id: string;
  date: string;
  moveId: string | null;
  reversalMoveId: string | null;
  moveName: string | null;
  lines: Line[];
}

const lastMonthEnd = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 0)).toISOString().slice(0, 10);
};

/** Revaluasi selisih kurs belum terealisasi akhir bulan atas saldo valas (dibalik otomatis keesokan harinya). */
export default function FxRevaluationPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const [date, setDate] = useState(lastMonthEnd());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<Revaluation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const m = (v: string) => money(v, locale);

  const loadHistory = useCallback(() => {
    api<Revaluation[]>("/accounting/fx-revaluations")
      .then(setHistory)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(loadHistory, [loadHistory]);
  useEffect(() => {
    setError(null);
    setPreview(null);
    api<Preview>(`/accounting/fx-revaluations/preview?date=${date}`)
      .then(setPreview)
      .catch((e: Error) => setError(e.message));
  }, [date, history]);

  const done = history.some((h) => h.date === date);

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <h1>{l("Revaluasi Kurs", "Currency Revaluation")}</h1>
        </div>
        <div className="cp-right">
          <label className="field inline">
            <span>{l("Per tanggal", "As of")}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {can(me.permissions, "accounting.post") && (
            <button
              className="primary"
              disabled={busy || done || !preview?.lines.length}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api("/accounting/fx-revaluations", { method: "POST", body: { date } });
                  loadHistory();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {done ? l("Sudah diposting", "Already posted") : l("Posting revaluasi", "Post revaluation")}
            </button>
          )}
        </div>
      </header>
      <p className="muted">
        {l(
          "Sisa piutang/utang valas yang masih terbuka dan saldo rekening berdenominasi valas dinilai ulang dengan Kurs Harian per tanggal itu. Selisihnya dicatat ke akun selisih kurs belum terealisasi (4-9110 / 7-1110) dan dibalik otomatis keesokan harinya, sehingga selisih kurs saat pelunasan tetap dihitung dari nilai transaksi awal.",
          "Open foreign-currency receivables/payables and foreign-currency account balances are revalued at the daily rate on that date. Differences go to the unrealized exchange difference accounts (4-9110 / 7-1110) and are reversed automatically the next day, so realized differences on payment are still measured against the original transaction value.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {preview && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Akun", "Account")}</th>
                <th>{l("Partner", "Partner")}</th>
                <th className="num">{l("Sisa valas", "Foreign balance")}</th>
                <th className="num">{l("Kurs", "Rate")}</th>
                <th className="num">{l("Nilai buku", "Book value")}</th>
                <th className="num">{l("Nilai kini", "Revalued")}</th>
                <th className="num">{l("Selisih", "Difference")}</th>
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((x, i) => (
                <tr key={i}>
                  <td>
                    {x.accountCode} {x.accountName}
                  </td>
                  <td>{x.partnerName ?? "—"}</td>
                  <td className="num">
                    {x.currencyCode} {m(x.amountCurrency)}
                  </td>
                  <td className="num">
                    {Number(x.rate).toLocaleString(locale === "id" ? "id-ID" : "en-US")}
                  </td>
                  <td className="num">{m(x.bookValue)}</td>
                  <td className="num">{m(x.revalued)}</td>
                  <td className={`num ${Number(x.difference) < 0 ? "error" : "success"}`}>
                    {m(x.difference)}
                  </td>
                </tr>
              ))}
              {preview.lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    {l(
                      "Tidak ada saldo valas yang perlu dinilai ulang.",
                      "No foreign-currency balances to revalue.",
                    )}
                  </td>
                </tr>
              )}
              {preview.lines.length > 0 && (
                <tr className="subtotal">
                  <td colSpan={6}>
                    {l("Laba / rugi selisih kurs belum terealisasi", "Unrealized exchange gain / loss")}
                  </td>
                  <td className="num">
                    {m(preview.gain)} / {m(preview.loss)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <h2>{l("Riwayat", "History")}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Tanggal", "Date")}</th>
              <th>{l("Jurnal", "Entry")}</th>
              <th className="num">{l("Baris", "Lines")}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td>{formatDate(h.date, locale)}</td>
                <td>
                  {h.moveId && <Link href={`/accounting/moves/${h.moveId}`}>{h.moveName}</Link>}
                  {h.reversalMoveId && (
                    <>
                      {" "}
                      ·{" "}
                      <Link href={`/accounting/moves/${h.reversalMoveId}`}>
                        {l("pembalikan", "reversal")}
                      </Link>
                    </>
                  )}
                </td>
                <td className="num">{h.lines.length}</td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  {l("Belum ada revaluasi.", "No revaluations yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
