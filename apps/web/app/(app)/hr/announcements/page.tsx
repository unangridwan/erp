"use client";

import { useEffect, useState } from "react";
import { errorText } from "../../../../components/hr/hr-panels";
import { useMe } from "../../../../components/me-context";
import { RefSelect } from "../../../../components/ref-select";
import { api } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

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
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Judul", "Title")}</th>
              <th>{l("Audiens", "Audience")}</th>
              <th>{l("Terbit", "Published")}</th>
              <th className="num">{l("Dibaca", "Reads")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
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
            {!rows.length && (
              <tr>
                <td colSpan={5} className="muted">
                  {l("Belum ada pengumuman.", "No announcements yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
