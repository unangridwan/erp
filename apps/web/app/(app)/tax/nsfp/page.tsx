"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Range {
  id: string;
  start: string;
  end: string;
  used: number;
  remaining: number;
  note: string | null;
}

const show = (n: string) => `${n.slice(0, 3)}-${n.slice(3, 5)}.${n.slice(5)}`;

/** Rentang NSFP e-Faktur 3.x (pra-Coretax) dari DJP, dipakai berurutan saat ekspor CSV e-Faktur lama. */
export default function NsfpPage() {
  const me = useMe();
  const { l } = useI18n();
  const [rows, setRows] = useState<Range[] | null>(null);
  const [form, setForm] = useState({ start: "", end: "", note: "" });
  const [error, setError] = useState<string | null>(null);
  const manage = can(me.permissions, "tax.manage");

  useEffect(() => {
    api<Range[]>("/tax/nsfp-ranges")
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setRows(
        await api<Range[]>("/tax/nsfp-ranges", {
          method: "POST",
          body: { ...form, note: form.note || null },
        }),
      );
      setForm({ start: "", end: "", note: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  async function remove(id: string) {
    setError(null);
    try {
      await api(`/tax/nsfp-ranges/${id}`, { method: "DELETE" });
      setRows((r) => r?.filter((x) => x.id !== id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <header className="toolbar">
        <h1>{l("NSFP e-Faktur Lama", "Legacy e-Faktur Serial Numbers")}</h1>
      </header>
      <p className="muted">
        {l(
          "Hanya untuk PKP yang masih memakai aplikasi e-Faktur 3.x (pra-Coretax) atau membetulkan faktur masa lalu. Daftarkan rentang Nomor Seri Faktur Pajak (13 digit) dari DJP; nomor dipakai berurutan saat mengekspor CSV e-Faktur lama dari menu Faktur Keluaran.",
          "Only for taxpayers still on the e-Faktur 3.x desktop app (pre-Coretax) or correcting past invoices. Register the 13-digit serial-number ranges from DJP; numbers are used in order when exporting the legacy CSV from Output Invoices.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {manage && (
        <form className="inline-panel" onSubmit={submit}>
          <label className="field">
            <span>{l("Awal", "Start")}</span>
            <input
              required
              placeholder="010-26.00000001"
              value={form.start}
              onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>{l("Akhir", "End")}</span>
            <input
              required
              placeholder="010-26.00000100"
              value={form.end}
              onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>{l("Catatan", "Note")}</span>
            <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          </label>
          <button className="primary">{l("Tambah rentang", "Add range")}</button>
        </form>
      )}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Awal", "Start")}</th>
                <th>{l("Akhir", "End")}</th>
                <th className="num">{l("Terpakai", "Used")}</th>
                <th className="num">{l("Sisa", "Remaining")}</th>
                <th>{l("Catatan", "Note")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{show(r.start)}</td>
                  <td>{show(r.end)}</td>
                  <td className="num">{r.used}</td>
                  <td className="num">{r.remaining}</td>
                  <td>{r.note}</td>
                  <td>
                    {manage && r.used === 0 && (
                      <button type="button" className="link danger" onClick={() => remove(r.id)}>
                        {l("Hapus", "Delete")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {l("Belum ada rentang NSFP.", "No ranges yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
