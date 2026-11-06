"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";

interface Notification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Lonceng notifikasi in-app: jumlah belum dibaca (diperbarui tiap menit) dan daftar terbaru. */
export function NotificationBell() {
  const { l, locale } = useI18n();
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Notification[]>([]);
  const [email, setEmail] = useState<{ email: boolean; address: string | null } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const poll = () =>
      api<{ unread: number }>("/me/notifications/count").then(
        (r) => setCount(r.unread),
        () => {},
      );
    void poll();
    const t = setInterval(poll, 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    api<Notification[]>("/me/notifications").then(setRows, () => setRows([]));
    api<{ email: boolean; address: string | null }>("/me/notification-settings").then(setEmail, () =>
      setEmail(null),
    );
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));

  return (
    <div className="nav-dropdown nav-bell" ref={ref}>
      <button
        className="bell"
        aria-label={l(`Notifikasi (${count} belum dibaca)`, `Notifications (${count} unread)`)}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.25-6.78V3.5a1.75 1.75 0 0 0-3.5 0v.72A7 7 0 0 0 5 11v5l-2 2v1h18v-1Z"
          />
        </svg>
        {count > 0 && <span className="bell-count">{count > 99 ? "99+" : count}</span>}
      </button>
      {open && (
        <div className="nav-items right notifications">
          <div className="notifications-head">
            <strong>{l("Notifikasi", "Notifications")}</strong>
            {count > 0 && (
              <button
                type="button"
                className="link"
                onClick={async () => {
                  await api("/me/notifications/read-all", { method: "POST" });
                  setCount(0);
                  setRows((r) => r.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
                }}
              >
                {l("Tandai semua dibaca", "Mark all read")}
              </button>
            )}
          </div>
          {rows.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`notification ${n.readAt ? "" : "unread"}`}
              onClick={async () => {
                if (!n.readAt) {
                  await api(`/me/notifications/${n.id}/read`, { method: "POST" });
                  setCount((c) => Math.max(0, c - 1));
                }
                setOpen(false);
                if (n.link) router.push(n.link);
              }}
            >
              <span>{n.title}</span>
              {n.body && <small className="muted">{n.body}</small>}
              <small className="muted">{when(n.createdAt)}</small>
            </button>
          ))}
          {!rows.length && <p className="muted">{l("Belum ada notifikasi.", "No notifications yet.")}</p>}
          {email && (
            <label className="notifications-email check">
              <input
                type="checkbox"
                checked={email.email}
                onChange={async (e) => {
                  const next = e.target.checked;
                  setEmail({ ...email, email: next });
                  await api("/me/notification-settings", { method: "PUT", body: { email: next } }).catch(() =>
                    setEmail({ ...email }),
                  );
                }}
              />
              <span>
                {l("Kirim juga lewat email", "Also send by email")}
                {email.address && <small className="muted"> ({email.address})</small>}
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
