"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { session, type Me } from "../lib/api";
import { visibleApps, visibleMenu, type App, type MenuGroup, type MenuLink } from "../lib/apps";
import { useI18n } from "../lib/i18n";
import { useTheme, useThemeLabels } from "../lib/theme";
import { AppIcon } from "./app-icon";
import { openCommandPalette } from "./command-palette";
import { NotificationBell } from "./notification-bell";

/** Tutup dropdown saat klik di luar elemen, menekan Esc, atau setelah navigasi. */
function useDropdown() {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const pathname = usePathname();
  useEffect(() => setOpen(null), [pathname]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
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

/**
 * Tautan aktif: path cocok (atau halaman turunannya); bila tautan membawa query (mis. `?role=customer`),
 * nilainya juga harus sama dengan URL sekarang.
 */
const isActive = (pathname: string, href: string, search?: URLSearchParams) => {
  const [path, query] = href.split("?") as [string, string | undefined];
  if (!(pathname === path || pathname.startsWith(`${path}/`))) return false;
  if (!query) return true;
  if (pathname !== path) return false;
  return [...new URLSearchParams(query)].every(([k, v]) => search?.get(k) === v);
};

/**
 * Sidebar kiri: beranda, semua aplikasi, dan menu lengkap aplikasi aktif (kelompok bisa dilipat). Di layar lebar
 * selalu tampil; di layar sempit menjadi laci yang dibuka tombol ☰ di bilah atas.
 */
export function Sidebar({
  me,
  app,
  open,
  onClose,
  collapsed = false,
  onToggleCollapse,
}: {
  me: Me;
  app: App | null;
  open: boolean;
  onClose: () => void;
  /** Mode ringkas (desktop): hanya ikon aplikasi. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const asideRef = useRef<HTMLElement>(null);
  // Laci di layar sempit: fokus masuk ke menu saat dibuka, Esc menutup (aksesibilitas keyboard).
  useEffect(() => {
    if (!open) return;
    asideRef.current?.querySelector<HTMLElement>("a[href], button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  const params = useSearchParams();
  const search = new URLSearchParams(params.toString());
  const active = (href: string) => isActive(pathname, href, search);
  const { tx, l } = useI18n();
  const apps = visibleApps(me);
  const menu = app ? visibleMenu(me, app) : [];
  // Kelompok menu yang terbuka (per aplikasi); bawaannya kelompok yang berisi halaman aktif.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const groupKey = (g: MenuGroup) => `${app?.id}:${g.label.id}`;
  const groupOpen = (g: MenuGroup, i: number) => {
    const key = groupKey(g);
    if (key in toggled) return toggled[key]!;
    const hasActive = g.items.some((it) => active(it.href));
    const anyActive = menu.some((e) => ("items" in e ? e.items : [e]).some((it) => active(it.href)));
    return hasActive || (!anyActive && i === 0);
  };
  const navRef = useRef<HTMLElement>(null);
  // Halaman aktif selalu terlihat di sidebar (mis. menu panjang SDM).
  useEffect(() => {
    navRef.current?.querySelector(".side-link.active")?.scrollIntoView({ block: "nearest" });
  }, [pathname, app?.id]);

  const item = (it: MenuLink) => (
    <Link
      key={it.href + it.label.id}
      href={it.href}
      className={`side-link${active(it.href) ? " active" : ""}`}
      aria-current={active(it.href) ? "page" : undefined}
    >
      {tx(it.label)}
    </Link>
  );

  return (
    <>
      <aside
        ref={asideRef}
        id="main-nav"
        className={`sidebar${open ? " open" : ""}`}
        aria-label={l("Navigasi utama", "Main navigation")}
      >
        <div className="side-head">
          <Link href="/" className="side-brand" title={l("Beranda", "Home")}>
            <span className="side-logo" aria-hidden>
              {initials(me.companies.find((c) => c.id === me.activeCompanyId)?.name ?? "ERP")}
            </span>
            <span className="side-brand-name">
              {me.companies.find((c) => c.id === me.activeCompanyId)?.name ?? "ERP"}
            </span>
          </Link>
          <button
            type="button"
            className="side-close"
            aria-label={l("Tutup menu", "Close menu")}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {me.companies.length > 1 && (
          <label className="side-company">
            <span className="sr-only">{l("Perusahaan aktif", "Active company")}</span>
            <select
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
          </label>
        )}
        <nav className="side-nav" ref={navRef}>
          <Link
            href="/"
            className={`side-app-link${pathname === "/" ? " current" : ""}`}
            aria-current={pathname === "/" ? "page" : undefined}
            title={collapsed ? l("Beranda", "Home") : undefined}
          >
            <HomeGlyph />
            <span>{l("Beranda", "Home")}</span>
          </Link>
          <div className="side-label">{l("Aplikasi", "Apps")}</div>
          {apps.map((a) => {
            const current = a.id === app?.id;
            return (
              <div key={a.id} className={`side-app${current ? " current" : ""}`}>
                <Link
                  href={a.home}
                  className={`side-app-link${current ? " current" : ""}`}
                  title={collapsed ? tx(a.name) : undefined}
                  aria-label={collapsed ? tx(a.name) : undefined}
                >
                  <AppIcon id={a.id} size={20} />
                  <span>{tx(a.name)}</span>
                </Link>
                {current && menu.length > 0 && (
                  <div className="side-menu">
                    {menu.map((entry, i) =>
                      "items" in entry ? (
                        <div key={entry.label.id} className="side-group">
                          <button
                            type="button"
                            className="side-group-toggle"
                            aria-expanded={groupOpen(entry, i)}
                            onClick={() =>
                              setToggled((t) => ({ ...t, [groupKey(entry)]: !groupOpen(entry, i) }))
                            }
                          >
                            <span>{tx(entry.label)}</span>
                            <span className="side-caret" aria-hidden>
                              ▸
                            </span>
                          </button>
                          {groupOpen(entry, i) && (
                            <div className="side-group-items">
                              {entry.items.map((it, j) => (
                                <Fragment key={it.href + it.label.id}>
                                  {it.section && it.section.id !== entry.items[j - 1]?.section?.id && (
                                    <div className="side-section">{tx(it.section)}</div>
                                  )}
                                  {item(it)}
                                </Fragment>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        item(entry)
                      ),
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        {onToggleCollapse && (
          <button
            type="button"
            className="side-collapse"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            title={`${collapsed ? l("Perbesar sidebar", "Expand sidebar") : l("Perkecil sidebar", "Collapse sidebar")} (Ctrl+\\)`}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                d={collapsed ? "M6 6l6 6-6 6M13 6l6 6-6 6" : "M18 6l-6 6 6 6M11 6l-6 6 6 6"}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>{collapsed ? l("Perbesar", "Expand") : l("Perkecil menu", "Collapse menu")}</span>
          </button>
        )}
      </aside>
      {open && <div className="side-backdrop" onClick={onClose} aria-hidden />}
    </>
  );
}

function HomeGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M3 11l9-7 9 7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10v10h5v-6h4v6h5V10" strokeLinejoin="round" />
    </svg>
  );
}

/** Bilah atas: tombol menu (layar sempit), judul aplikasi aktif, pencarian, perusahaan, notifikasi, profil. */
export function Navbar({
  me,
  app,
  onMenu,
  menuOpen = false,
}: {
  me: Me;
  app: App | null;
  onMenu: () => void;
  menuOpen?: boolean;
}) {
  const router = useRouter();
  const { tx, l, locale, setLocale } = useI18n();
  const [theme, setTheme] = useTheme();
  const themeLabels = useThemeLabels();
  const { open, setOpen, ref } = useDropdown();
  const toggle = (key: string) => setOpen(open === key ? null : key);
  return (
    <header className="topbar" ref={ref}>
      <button
        type="button"
        className="top-burger"
        aria-label={l("Buka menu", "Open menu")}
        aria-expanded={menuOpen}
        aria-controls="main-nav"
        onClick={onMenu}
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
        </svg>
      </button>
      <div className="top-title">
        {app ? (
          <Link href={app.home}>
            <AppIcon id={app.id} size={20} />
            <span>{tx(app.name)}</span>
          </Link>
        ) : (
          <Link href="/">{l("Beranda", "Home")}</Link>
        )}
      </div>
      <button
        type="button"
        className="top-search"
        onClick={openCommandPalette}
        title={l("Cari menu & data (Ctrl+K)", "Search menus & records (Ctrl+K)")}
        aria-label={l("Cari", "Search")}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
        </svg>
        <span className="top-search-label">{l("Cari menu, data, dokumen…", "Search menus, records…")}</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div className="top-right">
        {me.companies.length > 1 ? (
          <select
            className="top-company"
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
        ) : null}
        <NotificationBell />
        <div className="nav-dropdown nav-user">
          <button
            className="avatar"
            title={me.name}
            aria-label={l("Menu akun", "Account menu")}
            aria-expanded={open === "user"}
            onClick={() => toggle("user")}
          >
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
