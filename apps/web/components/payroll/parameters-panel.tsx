"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { formatDate, money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { ask, toast } from "../feedback";

interface Parameter {
  id: string;
  effectiveFrom: string;
  kesWageCap: string;
  jpWageCap: string;
  jkkRate: string;
  note: string | null;
}

const EMPTY = { effectiveFrom: "", kesWageCap: "", jpWageCap: "", jkkRate: "0.24", note: "" };

/**
 * Batas upah BPJS & tarif JKK per tanggal berlaku: payroll dihitung dengan nilai yang berlaku pada awal periodenya,
 * sehingga hitung ulang periode lama tidak berubah saat batas JP naik (tiap Maret) atau tarif berganti.
 */
export function PayrollParametersPanel({ onChange }: { onChange: () => void }) {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Parameter[]>([]);
  const [form, setForm] = useState<typeof EMPTY & { id?: string }>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const load = useCallback(
    () => api<Parameter[]>("/payroll-parameters").then(setRows, (e: Error) => toast.error(e.message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const today = new Date().toISOString().slice(0, 10);
  const current = rows.find((r) => r.effectiveFrom <= today)?.id;

  const save = async () => {
    setErrors({});
    try {
      const body = {
        effectiveFrom: form.effectiveFrom,
        kesWageCap: form.kesWageCap,
        jpWageCap: form.jpWageCap,
        jkkRate: Number(form.jkkRate).toFixed(2),
        note: form.note || null,
      };
      const next = await api<Parameter[]>(
        form.id ? `/payroll-parameters/${form.id}` : "/payroll-parameters",
        {
          method: form.id ? "PUT" : "POST",
          body,
        },
      );
      setRows(next);
      setForm(EMPTY);
      toast.success(l("Parameter disimpan.", "Parameter saved."));
      onChange();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      else toast.error((e as Error).message);
    }
  };
  const remove = async (r: Parameter) => {
    if (
      !(await ask(
        l(
          `Hapus parameter mulai ${formatDate(r.effectiveFrom, locale)}?`,
          `Delete the parameter from ${formatDate(r.effectiveFrom, locale)}?`,
        ),
      ))
    )
      return;
    try {
      setRows(await api<Parameter[]>(`/payroll-parameters/${r.id}`, { method: "DELETE" }));
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const fe = (k: string) => errors[k] && <small className="error">{errors[k]}</small>;

  return (
    <section className="panel narrow stack">
      <h2>
        {l("Batas upah BPJS & tarif JKK per tanggal berlaku", "BPJS wage caps & JKK rate by effective date")}
      </h2>
      <p className="muted small">
        {l(
          "Payroll memakai nilai yang berlaku pada awal periodenya, jadi menghitung ulang bulan lama tidak memakai batas baru. Tambahkan baris baru saat batas Jaminan Pensiun naik (biasanya Maret) atau tarif JKK berubah.",
          "Payroll uses the values in effect at the start of its period, so recomputing an old month keeps the old caps. Add a row when the pension (JP) cap rises (usually in March) or the JKK rate changes.",
        )}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Berlaku mulai", "Effective from")}</th>
              <th className="num">{l("Batas BPJS Kesehatan", "BPJS Health cap")}</th>
              <th className="num">{l("Batas JP", "JP cap")}</th>
              <th className="num">JKK</th>
              <th>{l("Catatan", "Note")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.effectiveFrom === "2000-01-01"
                    ? l("Awal", "Initial")
                    : formatDate(r.effectiveFrom, locale)}{" "}
                  {r.id === current && <span className="pill ok">{l("Berlaku", "Current")}</span>}
                </td>
                <td className="num">{money(r.kesWageCap, locale)}</td>
                <td className="num">{money(r.jpWageCap, locale)}</td>
                <td className="num">{Number(r.jkkRate)}%</td>
                <td>{r.note}</td>
                <td className="actions">
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      setForm({
                        id: r.id,
                        effectiveFrom: r.effectiveFrom,
                        kesWageCap: String(Number(r.kesWageCap)),
                        jpWageCap: String(Number(r.jpWageCap)),
                        jkkRate: String(Number(r.jkkRate)),
                        note: r.note ?? "",
                      })
                    }
                  >
                    {l("Ubah", "Edit")}
                  </button>
                  {rows.length > 1 && (
                    <button type="button" className="link danger" onClick={() => void remove(r)}>
                      {l("Hapus", "Delete")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <fieldset className="fields">
        <label className="field">
          <span>{l("Berlaku mulai *", "Effective from *")}</span>
          <input
            type="date"
            value={form.effectiveFrom}
            onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
          />
          {fe("effectiveFrom")}
        </label>
        <label className="field">
          <span>{l("Batas upah BPJS Kesehatan *", "BPJS Health wage cap *")}</span>
          <input
            className="num"
            inputMode="decimal"
            value={form.kesWageCap}
            onChange={(e) => setForm((f) => ({ ...f, kesWageCap: e.target.value }))}
          />
          {fe("kesWageCap")}
        </label>
        <label className="field">
          <span>{l("Batas upah Jaminan Pensiun *", "Pension (JP) wage cap *")}</span>
          <input
            className="num"
            inputMode="decimal"
            value={form.jpWageCap}
            onChange={(e) => setForm((f) => ({ ...f, jpWageCap: e.target.value }))}
          />
          {fe("jpWageCap")}
        </label>
        <label className="field">
          <span>{l("Tarif JKK", "JKK rate")}</span>
          <select value={form.jkkRate} onChange={(e) => setForm((f) => ({ ...f, jkkRate: e.target.value }))}>
            {["0.24", "0.54", "0.89", "1.27", "1.74"].map((r) => (
              <option key={r} value={String(Number(r))}>
                {r}%
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{l("Catatan", "Note")}</span>
          <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </label>
      </fieldset>
      <div className="toolbar">
        <button type="button" className="primary" onClick={() => void save()}>
          {form.id ? l("Simpan perubahan", "Save changes") : l("Tambah parameter", "Add parameter")}
        </button>
        {form.id && (
          <button type="button" onClick={() => setForm(EMPTY)}>
            {l("Batal", "Cancel")}
          </button>
        )}
      </div>
    </section>
  );
}
