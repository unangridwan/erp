"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { errorText } from "../../../../components/hr/hr-panels";
import { api } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

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
  const columns = useMemo<ViewColumn<Training>[]>(
    () => [
      {
        key: "name",
        label: l("Pelatihan", "Training"),
        value: (t) => t.name,
        text: (t) => `${t.name} ${t.provider ?? ""}`,
      },
      { key: "dateStart", label: l("Tanggal", "Date"), type: "date", value: (t) => t.dateStart },
      { key: "cost", label: l("Biaya", "Cost"), type: "number", value: (t) => Number(t.cost) },
      {
        key: "participants",
        label: l("Peserta", "Participants"),
        type: "number",
        value: (t) => t.participants,
      },
      {
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (t) => t.state,
        optionLabel: (v) =>
          ({
            planned: l("Direncanakan", "Planned"),
            done: l("Selesai", "Done"),
            cancel: l("Batal", "Cancelled"),
          })[v] ?? v,
      },
      {
        key: "provider",
        label: l("Penyelenggara", "Provider"),
        type: "enum",
        value: (t) => t.provider,
        hidden: true,
      },
    ],
    [l],
  );
  const table = useTableView(rows, columns, {
    storageKey: "trainings",
    defaultSort: { key: "dateStart", dir: "desc" },
  });

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Pelatihan & Sertifikasi", "Training & Certification")}</h1>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
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
      <TableTools view={table} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <SortTh view={table} col="name">
                {l("Pelatihan", "Training")}
              </SortTh>
              <SortTh view={table} col="dateStart">
                {l("Tanggal", "Date")}
              </SortTh>
              <SortTh view={table} col="cost" className="num">
                {l("Biaya", "Cost")}
              </SortTh>
              <SortTh view={table} col="participants">
                {l("Peserta", "Participants")}
              </SortTh>
              <SortTh view={table} col="state">
                {l("Status", "Status")}
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((t) => (
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
            {table.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {rows.length
                    ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                    : l("Belum ada pelatihan.", "No trainings yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <TablePager view={table} />
    </div>
  );
}
