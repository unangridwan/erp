"use client";

import { mentionQuery, splitMentions, type CommentMeta } from "@erp/shared";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiError } from "../lib/api";
import { useI18n, type MessageKey } from "../lib/i18n";
import { toast } from "./feedback";

interface Entry {
  id: string;
  action: string;
  changes: (Record<string, { from: unknown; to: unknown }> & CommentMeta) | null;
  message: string | null;
  createdAt: string;
  userId: string | null;
  userName: string | null;
}

interface Person {
  id: string;
  name: string;
  department: string | null;
}

/**
 * Riwayat dokumen (mirip chatter Odoo): komentar & diskusi dengan @mention (yang disebut, pemilik dokumen, dan peserta
 * diskusi mendapat notifikasi) berurutan bersama riwayat perubahan & catatan sistem.
 */
export function Chatter(props: {
  model: string;
  id: string;
  version: number;
  labels: Record<string, string>;
}) {
  const { model, id, version, labels } = props;
  const { t, l, locale } = useI18n();
  const dateFmt = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const action = (a: string) =>
    ["create", "update", "delete", "comment"].includes(a) ? t(`chatter.${a}` as MessageKey) : a;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [tick, setTick] = useState(0);
  const [onlyMessages, setOnlyMessages] = useState(false);

  useEffect(() => {
    api<Entry[]>(`/activity/${model}/${id}`)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [model, id, version, tick]);

  const shown = onlyMessages ? entries.filter((e) => e.action === "message") : entries;
  const messages = entries.filter((e) => e.action === "message").length;
  return (
    <aside className="panel chatter">
      <h2>{t("chatter.title")}</h2>
      <CommentBox model={model} id={id} onPosted={() => setTick((n) => n + 1)} />
      {messages > 0 && (
        <div className="chatter-filter" role="group" aria-label={l("Tampilkan", "Show")}>
          <button
            type="button"
            className={!onlyMessages ? "active" : ""}
            aria-pressed={!onlyMessages}
            onClick={() => setOnlyMessages(false)}
          >
            {l("Semua", "All")}
          </button>
          <button
            type="button"
            className={onlyMessages ? "active" : ""}
            aria-pressed={onlyMessages}
            onClick={() => setOnlyMessages(true)}
          >
            {l(`Diskusi (${messages})`, `Discussion (${messages})`)}
          </button>
        </div>
      )}
      {shown.length === 0 && <p className="muted">{t("chatter.empty")}</p>}
      <ol>
        {shown.map((e) =>
          e.action === "message" ? (
            <li key={e.id} className={`chatter-msg${e.changes?.reminder ? " reminder" : ""}`}>
              <div>
                <strong>{e.userName ?? t("chatter.system")}</strong>
                {e.changes?.reminder && <span className="badge warn">{l("Pengingat", "Reminder")}</span>}
                <time className="muted"> · {dateFmt.format(new Date(e.createdAt))}</time>
              </div>
              <p>
                {splitMentions(e.message ?? "", e.changes?.mentions?.map((m) => m.name) ?? []).map((p, i) =>
                  p.mention ? (
                    <mark key={i} className="mention">
                      {p.text}
                    </mark>
                  ) : (
                    <span key={i}>{p.text}</span>
                  ),
                )}
              </p>
            </li>
          ) : (
            <li key={e.id}>
              <strong>{e.userName ?? t("chatter.system")}</strong> {action(e.action)}
              <time className="muted"> · {dateFmt.format(new Date(e.createdAt))}</time>
              {e.message && <span className="muted"> · {e.message}</span>}
              {e.changes && (
                <ul>
                  {Object.entries(e.changes).map(([field, c]) => (
                    <li key={field} className="muted">
                      {labels[field] ?? field}: {String(c.from ?? "—")} → {String(c.to ?? "—")}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ),
        )}
      </ol>
    </aside>
  );
}

/** Kotak komentar dengan saran `@nama` (orang yang berhak melihat dokumen). Ctrl/⌘+Enter mengirim. */
function CommentBox({ model, id, onPosted }: { model: string; id: string; onPosted: () => void }) {
  const { l } = useI18n();
  const listId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [active, setActive] = useState(0);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!query) return;
    const handle = setTimeout(() => {
      api<Person[]>(`/activity/${model}/${id}/people?q=${encodeURIComponent(query.query)}`).then(
        (rows) => {
          setPeople(rows);
          setActive(0);
        },
        () => setPeople([]),
      );
    }, 150);
    return () => clearTimeout(handle);
  }, [model, id, query]);

  const open = !!query && people.length > 0;
  const update = (value: string, caret: number) => {
    setText(value);
    setQuery(mentionQuery(value, caret));
  };
  const choose = (p: Person) => {
    if (!query) return;
    const caret = ref.current?.selectionStart ?? text.length;
    const insert = `@${p.name} `;
    const next = text.slice(0, query.start) + insert + text.slice(caret);
    setText(next);
    setPicked((m) => ({ ...m, [p.name]: p.id }));
    setQuery(null);
    setPeople([]);
    const pos = query.start + insert.length;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  async function send() {
    const message = text.trim();
    if (!message || sending) return;
    // Hanya sebutan yang masih ada di teks yang dikirim.
    const mentions = Object.entries(picked)
      .filter(([name]) => message.includes(`@${name}`))
      .map(([, uid]) => uid);
    setSending(true);
    try {
      const res = await api<{ notified: number }>(`/activity/${model}/${id}/comments`, {
        method: "POST",
        body: { message, mentions },
      });
      setText("");
      setPicked({});
      onPosted();
      if (res.notified > 0)
        toast.success(
          l(
            `Komentar terkirim · ${res.notified} orang diberi tahu.`,
            `Comment posted · ${res.notified} notified.`,
          ),
        );
    } catch (e) {
      toast.error(e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : String(e));
    } finally {
      setSending(false);
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i + (e.key === "ArrowDown" ? 1 : people.length - 1)) % people.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(people[active]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <form
      className="chatter-compose"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="mention-wrap">
        <textarea
          ref={ref}
          rows={2}
          value={text}
          maxLength={4000}
          placeholder={l(
            "Tulis komentar… ketik @ untuk menyebut rekan",
            "Write a comment… type @ to mention",
          )}
          aria-label={l("Komentar", "Comment")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          onChange={(e) => update(e.target.value, e.target.selectionStart)}
          onClick={(e) => setQuery(mentionQuery(text, e.currentTarget.selectionStart))}
          onKeyDown={onKey}
          onBlur={() => setTimeout(() => setQuery(null), 150)}
        />
        {open && (
          <ul className="mention-list" role="listbox" id={listId}>
            {people.map((p, i) => (
              <li
                key={p.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
              >
                <strong>{p.name}</strong>
                {p.department && <span className="muted small"> · {p.department}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="chatter-compose-actions">
        <span className="muted small">{l("Ctrl+Enter untuk mengirim", "Ctrl+Enter to send")}</span>
        <button type="submit" className="primary" disabled={!text.trim() || sending} aria-busy={sending}>
          {l("Kirim", "Send")}
        </button>
      </div>
    </form>
  );
}
