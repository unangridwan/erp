"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../../../components/hr/hr-panels";
import { api } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Cycle {
  id: string;
  name: string;
  dateStart: string;
  dateEnd: string;
  state: string;
  total: number;
  done: number;
}

/** Siklus penilaian kinerja. */
export default function AppraisalCyclesPage() {
  const { l, locale } = useI18n();
  const y = new Date().getFullYear();
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [form, setForm] = useState({
    name: `Penilaian Kinerja ${y}`,
    dateStart: `${y}-01-01`,
    dateEnd: `${y}-12-31`,
  });
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Cycle[]>("/appraisal-cycles").then(setCycles, (e) => setError(errorText(e)));
  }, [version]);
  const create = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    api("/appraisal-cycles", { method: "POST", body: form }).then(
      () => setVersion((v) => v + 1),
      (err) => setError(errorText(err)),
    );
  };
  const STATE: Record<string, string> = {
    draft: l("Draft", "Draft"),
    open: l("Berjalan", "Open"),
    closed: l("Ditutup", "Closed"),
  };
  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Penilaian Kinerja", "Performance Appraisals")}</h1>
        <Link href="/hr/appraisal-templates">{l("Template KPI", "KPI templates")}</Link>
      </header>
      {error && <p className="error">{error}</p>}
      <form className="inline-panel" onSubmit={create}>
        <label className="field">
          <span>{l("Nama siklus", "Cycle name")}</span>
          <input
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Mulai", "Start")}</span>
          <input
            type="date"
            value={form.dateStart}
            onChange={(e) => setForm((f) => ({ ...f, dateStart: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Selesai", "End")}</span>
          <input
            type="date"
            value={form.dateEnd}
            onChange={(e) => setForm((f) => ({ ...f, dateEnd: e.target.value }))}
          />
        </label>
        <button className="primary">{l("Buat siklus", "Create cycle")}</button>
      </form>
      <div className="table-scroll">
        <table>
          <tbody>
            {cycles.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/hr/appraisals/${c.id}`}>{c.name}</Link>
                </td>
                <td>
                  {formatDate(c.dateStart, locale)} – {formatDate(c.dateEnd, locale)}
                </td>
                <td>{STATE[c.state]}</td>
                <td>
                  <progress max={Math.max(c.total, 1)} value={c.done} /> {c.done}/{c.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
