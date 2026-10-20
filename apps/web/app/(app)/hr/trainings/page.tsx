"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../../../components/hr/hr-panels";
import { api } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Training {
  id: string;
  name: string;
  provider: string | null;
  dateStart: string;
  dateEnd: string;
  cost: string;
  state: string;
  participants: number;
  completed: number;
}

/** Katalog pelatihan & sertifikasi. */
export default function TrainingsPage() {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Training[]>([]);
  const [form, setForm] = useState({
    name: "",
    provider: "",
    dateStart: "",
    dateEnd: "",
    cost: "0",
    certificateValidMonths: "",
  });
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Training[]>("/trainings").then(setRows, (e) => setError(errorText(e)));
  }, [version]);
  const create = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    api("/trainings", {
      method: "POST",
      body: {
        ...form,
        provider: form.provider || null,
        certificateValidMonths: form.certificateValidMonths ? Number(form.certificateValidMonths) : null,
      },
    }).then(
      () => {
        setForm({
          name: "",
          provider: "",
          dateStart: "",
          dateEnd: "",
          cost: "0",
          certificateValidMonths: "",
        });
        setVersion((v) => v + 1);
      },
      (err) => setError(errorText(err)),
    );
  };
  const STATE: Record<string, string> = {
    planned: l("Direncanakan", "Planned"),
    done: l("Selesai", "Done"),
    cancel: l("Batal", "Cancelled"),
  };
  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Pelatihan & Sertifikasi", "Training & Certification")}</h1>
      </header>
      {error && <p className="error">{error}</p>}
      <form className="inline-panel" onSubmit={create}>
        <label className="field">
          <span>{l("Nama pelatihan *", "Training name *")}</span>
          <input
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Penyelenggara", "Provider")}</span>
          <input
            value={form.provider}
            onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Mulai", "Start")}</span>
          <input
            type="date"
            required
            value={form.dateStart}
            onChange={(e) => setForm((f) => ({ ...f, dateStart: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Selesai", "End")}</span>
          <input
            type="date"
            required
            value={form.dateEnd}
            onChange={(e) => setForm((f) => ({ ...f, dateEnd: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Biaya", "Cost")}</span>
          <input
            className="num"
            inputMode="decimal"
            value={form.cost}
            onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Sertifikat berlaku (bulan)", "Certificate valid (months)")}</span>
          <input
            className="num"
            inputMode="numeric"
            value={form.certificateValidMonths}
            onChange={(e) => setForm((f) => ({ ...f, certificateValidMonths: e.target.value }))}
          />
        </label>
        <button className="primary">{l("Tambah", "Add")}</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Pelatihan", "Training")}</th>
              <th>{l("Tanggal", "Date")}</th>
              <th className="num">{l("Biaya", "Cost")}</th>
              <th>{l("Peserta", "Participants")}</th>
              <th>{l("Status", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link href={`/hr/trainings/${t.id}`}>{t.name}</Link>
                  {t.provider && <small className="muted"> · {t.provider}</small>}
                </td>
                <td>
                  {formatDate(t.dateStart, locale)} – {formatDate(t.dateEnd, locale)}
                </td>
                <td className="num">{money(t.cost, locale)}</td>
                <td>
                  {t.completed}/{t.participants} {l("lulus", "completed")}
                </td>
                <td>{STATE[t.state]}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {l("Belum ada pelatihan.", "No trainings yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
