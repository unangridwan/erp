"use client";

import { useEffect, useState } from "react";
import { ask, toast } from "../../../../components/feedback";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Article {
  id: string;
  title: string;
  category: string | null;
  body: string;
  published: boolean;
  publishedAt: string | null;
  views: number;
  updatedAt: string;
}

/** Basis pengetahuan: artikel bantuan; yang terbit tampil di portal pelanggan. */
export default function ArticlesPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const editable = can(me.permissions, "support.manage");
  const [items, setItems] = useState<Article[]>([]);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Partial<Article> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api<{ items: Article[] }>("/support/articles?limit=1000")
      .then((d) => setItems(d.items))
      .catch((e: Error) => setError(e.message));
  }, [version]);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(
        e instanceof ApiError && Object.keys(e.fieldErrors).length
          ? Object.values(e.fieldErrors).join("; ")
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  }
  const term = q.trim().toLowerCase();
  const shown = items.filter(
    (a) => !term || `${a.title} ${a.category ?? ""} ${a.body}`.toLowerCase().includes(term),
  );

  return (
    <>
      <header className="toolbar">
        <h1>{l("Basis Pengetahuan", "Knowledge Base")}</h1>
        <input
          aria-label={l("Cari artikel", "Search articles")}
          placeholder={l("Cari artikel…", "Search articles…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {editable && (
          <button
            className="primary"
            onClick={() => setDraft({ title: "", category: "", body: "", published: false })}
          >
            {l("Baru", "New")}
          </button>
        )}
      </header>
      <p className="muted">
        {l(
          "Artikel yang diterbitkan tampil di portal pelanggan (menu Bantuan), sehingga pelanggan bisa mencari jawaban sebelum membuat tiket.",
          "Published articles appear in the customer portal (Help), so customers can find answers before opening a ticket.",
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {draft && (
        <section className="panel stack">
          <div className="fields">
            <label className="field">
              <span>{l("Judul *", "Title *")}</span>
              <input
                value={draft.title ?? ""}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("Kategori", "Category")}</span>
              <input
                value={draft.category ?? ""}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("Terbitkan di portal", "Publish to portal")}</span>
              <input
                type="checkbox"
                checked={Boolean(draft.published)}
                onChange={(e) => setDraft({ ...draft, published: e.target.checked })}
              />
            </label>
          </div>
          <label className="field">
            <span>{l("Isi *", "Body *")}</span>
            <textarea
              rows={10}
              value={draft.body ?? ""}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </label>
          <div className="filters">
            <button
              className="primary"
              disabled={!draft.title?.trim() || !draft.body?.trim()}
              onClick={() =>
                run(async () => {
                  const body = {
                    title: draft.title,
                    category: draft.category || null,
                    body: draft.body,
                    published: Boolean(draft.published),
                  };
                  if (draft.id) await api(`/support/articles/${draft.id}`, { method: "PATCH", body });
                  else await api("/support/articles", { method: "POST", body });
                  toast.success(l("Artikel tersimpan", "Article saved"));
                  setDraft(null);
                })
              }
            >
              {l("Simpan", "Save")}
            </button>
            <button className="link" onClick={() => setDraft(null)}>
              {l("Batal", "Cancel")}
            </button>
          </div>
        </section>
      )}
      <section className="panel">
        {shown.length === 0 ? (
          <p className="muted">{l("Belum ada artikel.", "No articles yet.")}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{l("Judul", "Title")}</th>
                  <th>{l("Kategori", "Category")}</th>
                  <th>{l("Status", "Status")}</th>
                  <th className="num">{l("Dilihat", "Views")}</th>
                  <th>{l("Diubah", "Updated")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.id}>
                    <td>{a.title}</td>
                    <td>{a.category ?? "—"}</td>
                    <td>
                      <span className={`badge ${a.published ? "state-won" : ""}`}>
                        {a.published ? l("Terbit", "Published") : l("Draf", "Draft")}
                      </span>
                    </td>
                    <td className="num">{a.views}</td>
                    <td>{formatDate(a.updatedAt, locale)}</td>
                    <td>
                      {editable && (
                        <>
                          <button className="link" onClick={() => setDraft(a)}>
                            {l("Ubah", "Edit")}
                          </button>{" "}
                          <button
                            className="link"
                            onClick={() =>
                              run(async () => {
                                if (
                                  !(await ask(
                                    l(`Hapus artikel "${a.title}"?`, `Delete article "${a.title}"?`),
                                  ))
                                )
                                  return;
                                await api(`/support/articles/${a.id}`, { method: "DELETE" });
                              })
                            }
                          >
                            {l("Hapus", "Delete")}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
