"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../../../components/hr/hr-panels";
import { api, ApiError } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { useMe } from "../../../../components/me-context";
import { can } from "../../../../lib/resources";

type Kind = "national" | "collective" | "company";
interface Holiday {
  id: string;
  date: string;
  name: string;
  kind: Kind;
  source: "manual" | "import";
  companyId: string | null;
  companyName: string | null;
}
interface List {
  year: number;
  available: number[];
  items: Holiday[];
}

const KIND_LABEL: Record<Kind, [string, string]> = {
  national: ["Libur nasional", "National holiday"],
  collective: ["Cuti bersama", "Collective leave"],
  company: ["Libur perusahaan", "Company holiday"],
};
const KIND_PILL: Record<Kind, string> = { national: "bad", collective: "warn", company: "" };

const empty = { id: "", date: "", name: "", kind: "national" as Kind, companyId: "" };

/**
 * Kalender hari libur: libur nasional, cuti bersama, dan libur khusus perusahaan per tahun. Hari libur tidak dihitung
 * sebagai hari cuti maupun hari kerja payroll; hari kerja lainnya mengikuti jadwal kerja tiap karyawan.
 */
export default function HolidaysPage() {
  const { l, locale } = useI18n();
  const me = useMe();
  const canManage = can(me.permissions, "hr.manage");
  const [year, setYear] = useState(new Date().getFullYear());
  const [companyId, setCompanyId] = useState("");
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [d, setD] = useState<List | null>(null);
  const [form, setForm] = useState<typeof empty | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api<List>(`/work-calendar/holidays?year=${year}${companyId ? `&companyId=${companyId}` : ""}`).then(
      setD,
      (e) => setError(errorText(e)),
    );
  }, [year, companyId]);
  useEffect(load, [load]);
  useEffect(() => {
    api<{ items: { id: string; name: string }[] }>("/companies?limit=200").then(
      (r) => setCompanies(r.items),
      () => setCompanies([]),
    );
  }, []);

  const importNational = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ created: number; skipped: number }>("/work-calendar/holidays/import-national", {
        method: "POST",
        body: { year, companyId: companyId || null },
      });
      setNotice(
        l(
          `${r.created} tanggal ditambahkan, ${r.skipped} sudah ada. Periksa kembali tanggal hari besar keagamaan dengan SKB terbaru.`,
          `${r.created} dates added, ${r.skipped} already existed. Double-check religious holidays against the latest official decree.`,
        ),
      );
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const body = { date: form.date, name: form.name, kind: form.kind, companyId: form.companyId || null };
      if (form.id) await api(`/public-holidays/${form.id}`, { method: "PATCH", body });
      else await api("/public-holidays", { method: "POST", body });
      setForm(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (h: Holiday) => {
    if (!confirm(l(`Hapus "${h.name}"?`, `Delete "${h.name}"?`))) return;
    try {
      await api(`/public-holidays/${h.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const months = new Map<string, Holiday[]>();
  for (const h of d?.items ?? []) {
    const key = h.date.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), h]);
  }
  const monthName = (key: string) =>
    new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { month: "long" }).format(
      new Date(`${key}-15T12:00:00`),
    );
  const count = (kind: Kind) => d?.items.filter((h) => h.kind === kind).length ?? 0;

  return (
    <div className="stack-wide">
      <section className="panel">
        <header className="toolbar">
          <h1>{l("Hari Libur", "Holidays")}</h1>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label={l("Tahun", "Year")}
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() + 1 - i).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
          {companies.length > 1 && (
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              aria-label={l("Perusahaan", "Company")}
            >
              <option value="">{l("Semua perusahaan", "All companies")}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {canManage && (
            <>
              <button type="button" onClick={() => setForm({ ...empty, date: `${year}-01-01`, companyId })}>
                {l("Tambah", "Add")}
              </button>
              <button
                type="button"
                disabled={busy || !d?.available.includes(year)}
                title={
                  d && !d.available.includes(year)
                    ? l(
                        "Data bawaan belum tersedia untuk tahun ini — impor dari berkas",
                        "No built-in data for this year — import a file",
                      )
                    : undefined
                }
                onClick={importNational}
              >
                {l(`Impor libur nasional ${year}`, `Import ${year} national holidays`)}
              </button>
              <Link href="/public-holidays" className="button">
                {l("Impor/ekspor berkas", "Import/export file")}
              </Link>
            </>
          )}
        </header>
        <p className="muted">
          {l(
            "Hari libur tidak dihitung sebagai hari cuti maupun hari kerja payroll. Selain itu hari kerja mengikuti jadwal kerja tiap karyawan (mis. Senin–Sabtu atau shift). Cuti bersama yang memotong cuti tahunan dicatat lewat Cuti massal.",
            "Holidays are not counted as leave days or payroll working days. Other working days follow each employee's work schedule (e.g. Monday–Saturday or shifts). Collective leave that reduces annual leave is recorded via Bulk leave.",
          )}{" "}
          <Link href="/hr/leaves">{l("Cuti massal", "Bulk leave")}</Link>
        </p>
        {error && <p className="error">{error}</p>}
        {notice && <p className="success">{notice}</p>}
        {d && (
          <ul className="grid">
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <li key={k} className="card">
                <span>{l(...KIND_LABEL[k])}</span>
                <strong>{count(k)}</strong>
              </li>
            ))}
          </ul>
        )}
        {form && (
          <form className="inline-panel" onSubmit={save}>
            <label className="field">
              <span>{l("Tanggal", "Date")}</span>
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("Nama", "Name")}</span>
              <input
                required
                maxLength={100}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("Jenis", "Type")}</span>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}>
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                  <option key={k} value={k}>
                    {l(...KIND_LABEL[k])}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Berlaku untuk", "Applies to")}</span>
              <select
                value={form.companyId}
                onChange={(e) => setForm({ ...form, companyId: e.target.value })}
              >
                <option value="">{l("Semua perusahaan", "All companies")}</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" disabled={busy}>
              {l("Simpan", "Save")}
            </button>
            <button type="button" onClick={() => setForm(null)}>
              {l("Batal", "Cancel")}
            </button>
          </form>
        )}
      </section>
      {d && (
        <section className="panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{l("Tanggal", "Date")}</th>
                  <th>{l("Nama", "Name")}</th>
                  <th>{l("Jenis", "Type")}</th>
                  <th>{l("Berlaku untuk", "Applies to")}</th>
                  {canManage && <th />}
                </tr>
              </thead>
              {[...months.entries()].map(([key, rows]) => (
                <tbody key={key}>
                  <tr>
                    <th colSpan={canManage ? 5 : 4}>{monthName(key)}</th>
                  </tr>
                  {rows.map((h) => (
                    <tr key={h.id}>
                      <td>{formatDate(h.date, locale)}</td>
                      <td>{h.name}</td>
                      <td>
                        <span className={`pill ${KIND_PILL[h.kind]}`}>{l(...KIND_LABEL[h.kind])}</span>
                      </td>
                      <td>{h.companyName ?? l("Semua perusahaan", "All companies")}</td>
                      {canManage && (
                        <td className="actions">
                          <button
                            type="button"
                            onClick={() =>
                              setForm({
                                id: h.id,
                                date: h.date,
                                name: h.name,
                                kind: h.kind,
                                companyId: h.companyId ?? "",
                              })
                            }
                          >
                            {l("Ubah", "Edit")}
                          </button>
                          <button type="button" className="danger" onClick={() => remove(h)}>
                            {l("Hapus", "Delete")}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              ))}
              {!d.items.length && (
                <tbody>
                  <tr>
                    <td colSpan={canManage ? 5 : 4} className="muted">
                      {l(`Belum ada hari libur ${year}.`, `No holidays for ${year} yet.`)}
                    </td>
                  </tr>
                </tbody>
              )}
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
