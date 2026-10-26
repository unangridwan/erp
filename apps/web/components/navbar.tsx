"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { session, type Me } from "../lib/api";
import { visibleMenu, type App, type MenuEntry } from "../lib/apps";
import { useI18n } from "../lib/i18n";
import { useTheme, useThemeLabels } from "../lib/theme";
import { AppIcon, AppsGlyph } from "./app-icon";
import { NotificationBell } from "./notification-bell";

/** Tutup dropdown saat klik di luar elemen atau setelah navigasi. */
function useDropdown() {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const pathname = usePathname();
  useEffect(() => setOpen(null), [pathname]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return { open, setOpen, ref };
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** Bilah atas gaya Odoo: pengalih aplikasi, nama & menu aplikasi aktif saja, perusahaan, dan menu user. */
export function Navbar({ me, app }: { me: Me; app: App | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const { tx, l, locale, setLocale } = useI18n();
  const [theme, setTheme] = useTheme();
  const themeLabels = useThemeLabels();
  const { open, setOpen, ref } = useDropdown();
  const menu: MenuEntry[] = app ? visibleMenu(me, app) : [];
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const toggle = (key: string) => setOpen(open === key ? null : key);

  return (
    <header className="navbar" ref={ref}>
      <Link href="/" className="nav-apps" title={l("Semua aplikasi", "All apps")}>
        <AppsGlyph />
      </Link>
      {app && (
        <Link href={app.home} className="nav-app">
          <AppIcon id={app.id} size={22} />
          {tx(app.name)}
        </Link>
      )}
      {menu.length > 0 && (
        <button className="nav-burger" aria-label="Menu" onClick={() => toggle("burger")}>
          ☰
        </button>
      )}
      <nav className={`nav-menu ${open === "burger" ? "open" : ""}`}>
        {menu.map((entry) =>
          "items" in entry ? (
            <div key={entry.label.id} className="nav-dropdown">
              <button
                className={entry.items.some((i) => active(i.href)) ? "active" : ""}
                onClick={() => toggle(entry.label.id)}
              >
                {tx(entry.label)}
              </button>
              {(open === entry.label.id || open === "burger") && (
                <div className="nav-items">
                  {entry.items.map((item) => (
                    <Link
                      key={item.href + item.label.id}
                      href={item.href}
                      className={active(item.href) ? "active" : ""}
                    >
                      {tx(item.label)}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Link key={entry.href} href={entry.href} className={active(entry.href) ? "active" : ""}>
              {tx(entry.label)}
            </Link>
          ),
        )}
      </nav>
      <div className="nav-right">
        {me.companies.length > 1 ? (
          <select
            className="nav-company"
            aria-label={l("Perusahaan aktif", "Active company")}
            value={me.activeCompanyId}
            onChange={(e) => {
              session.setCompanyId(e.target.value);
              window.location.reload();
            }}
          >
            {me.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="nav-company-name">{me.companies[0]?.name}</span>
        )}
        <NotificationBell />
        <div className="nav-dropdown nav-user">
          <button className="avatar" title={me.name} onClick={() => toggle("user")}>
            {initials(me.name)}
          </button>
          {open === "user" && (
            <div className="nav-items right">
              <div className="nav-user-head">
                <strong>{me.name}</strong>
                <span className="muted small">{me.email}</span>
              </div>
              <Link href="/settings/security">{l("Keamanan & sesi", "Security & sessions")}</Link>
              <button className="nav-item" onClick={() => setLocale(locale === "id" ? "en" : "id")}>
                {locale === "id" ? "English" : "Bahasa Indonesia"}
              </button>
              <div className="nav-theme" role="group" aria-label={l("Tema", "Theme")}>
                {(["light", "dark", "system"] as const).map((t) => (
                  <button
                    key={t}
                    className={theme === t ? "active" : ""}
                    aria-pressed={theme === t}
                    onClick={() => setTheme(t)}
                  >
                    {themeLabels[t]}
                  </button>
                ))}
              </div>
              <button
                className="nav-item"
                onClick={async () => {
                  await session.logout();
                  router.replace("/login");
                }}
              >
                {l("Keluar", "Log out")}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
