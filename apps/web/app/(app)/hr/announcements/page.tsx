"use client";

import { useEffect, useMemo, useState } from "react";
import { errorText } from "../../../../components/hr/hr-panels";
import { useMe } from "../../../../components/me-context";
import { RefSelect } from "../../../../components/ref-select";
import { api } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface Announcement {
  id: string;
  title: string;
  body: string;
  departmentId: string | null;
  departmentName: string | null;
  pinned: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  reads: number;
}

const EMPTY = { id: "", title: "", body: "", departmentId: "", pinned: false, expiresAt: "", publish: true };

/** Pengumuman perusahaan untuk portal karyawan (semua atau per departemen). */
export default function AnnouncementsPage() {
  const { l, locale } = useI18n();
  const manage = can(useMe().permissions, "hr.manage");
  const [rows, setRows] = useState<Announcement[]>([]);
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<Announcement[]>("/announcements").then(setRows, (e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);
  const columns = useMemo<ViewColumn<Announcement>[]>(
    () => [
      {
        key: "title",
        label: l("Judul", "Title"),
        value: (a) => a.title,
        text: (a) => `${a.title} ${a.body}`,
      },
      {
        key: "audience",
        label: l("Audiens", "Audience"),
        type: "enum",
        value: (a) => a.departmentName ?? l("Semua karyawan", "Everyone"),
      },
      { key: "publishedAt", label: l("Terbit", "Published"), type: "date", value: (a) => a.publishedAt },
      { key: "reads", label: l("Dibaca", "Reads"), type: "number", value: (a) => a.reads },
      {
        key: "pinned",
        label: l("Disematkan", "Pinned"),
        type: "enum",
        value: (a) => (a.pinned ? "1" : "0"),
        optionLabel: (v) => (v === "1" ? l("Ya", "Yes") : l("Tidak", "No")),
        hidden: true,
      },
    ],
    [l],
  );
  const table = useTableView(rows, columns, {
    storageKey: "announcements",
    defaultSort: { key: "publishedAt", dir: "desc" },
  });

  async function save() {
    if (!form) return;
    setError(null);
    try {
      const body = {
        title: form.title,
        body: form.body,
        departmentId: form.departmentId || null,
        pinned: form.pinned,
        expiresAt: form.expiresAt || null,
        publish: form.publish,
      };
      await api(form.id ? `/announcements/${form.id}` : "/announcements", {
        method: form.id ? "PUT" : "POST",
        body,
      });
      setForm(null);
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section className="panel">
      <header className="toolbar">
        <h1>{l("Pengumuman", "Announcements")}</h1>
        {manage && !form && (
          <button type="button" className="primary" onClick={() => setForm(EMPTY)}>
            {l("Pengumuman baru", "New announcement")}
          </button>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {form && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="field">
            <span>{l("Judul", "Title")}</span>
            <input
              required
              maxLength={200}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Isi", "Body")}</span>
            <textarea
              required
              rows={6}
              maxLength={20000}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{l("Departemen (kosong = semua karyawan)", "Department (empty = everyone)")}</span>
            <RefSelect
              name="departmentId"
              resource="departments"
              display="name"
              value={form.departmentId}
              onChange={(v) => setForm({ ...form, departmentId: v })}
            />
          </label>
          <label className="field">
            <span>{l("Berlaku sampai", "Expires on")}</span>
            <input
              type="date"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.pinned}
              onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
            />
            {l("Sematkan di atas", "Pin to top")}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.publish}
              onChange={(e) => setForm({ ...form, publish: e.target.checked })}
            />
            {l("Terbitkan", "Publish")}
          </label>
          <div className="toolbar">
            <button className="primary">{l("Simpan", "Save")}</button>
            <button type="button" onClick={() => setForm(null)}>
              {l("Batal", "Cancel")}
            </button>
          </div>
        </form>
      )}
      <TableTools view={table} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <SortTh view={table} col="title">
                {l("Judul", "Title")}
              </SortTh>
              <SortTh view={table} col="audience">
                {l("Audiens", "Audience")}
              </SortTh>
              <SortTh view={table} col="publishedAt">
                {l("Terbit", "Published")}
              </SortTh>
              <SortTh view={table} col="reads" className="num">
                {l("Dibaca", "Reads")}
              </SortTh>
              <th />
            </tr>
          </thead>
          <tbody>
            {table.rows.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.pinned ? "📌 " : ""}
                  {a.title}
                </td>
                <td>{a.departmentName ?? l("Semua karyawan", "Everyone")}</td>
                <td>
                  {a.publishedAt ? (
                    formatDate(a.publishedAt.slice(0, 10), locale)
                  ) : (
                    <span className="muted">{l("draft", "draft")}</span>
                  )}
                </td>
                <td className="num">{a.reads}</td>
                <td>
                  {manage && (
                    <>
                      <button
                        type="button"
                        className="link"
                        onClick={() =>
                          setForm({
                            id: a.id,
                            title: a.title,
                            body: a.body,
                            departmentId: a.departmentId ?? "",
                            pinned: a.pinned,
                            expiresAt: a.expiresAt ?? "",
                            publish: !!a.publishedAt,
                          })
                        }
                      >
                        {l("Ubah", "Edit")}
                      </button>{" "}
                      <button
                        type="button"
                        className="link"
                        onClick={() =>
                          confirm(l("Hapus pengumuman ini?", "Delete this announcement?")) &&
                          api(`/announcements/${a.id}`, { method: "DELETE" }).then(load, (e) =>
                            setError(errorText(e)),
                          )
                        }
                      >
                        {l("Hapus", "Delete")}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!table.rows.length && (
              <tr>
                <td colSpan={5} className="muted">
                  {rows.length
                    ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                    : l("Belum ada pengumuman.", "No announcements yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <TablePager view={table} />
    </section>
  );
}
