"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { session, type Me } from "../lib/api";
import { visibleMenu, type App, type MenuEntry } from "../lib/apps";
import { useI18n } from "../lib/i18n";
import { useTheme, useThemeLabels } from "../lib/theme";
import { AppIcon, AppsGlyph } from "./app-icon";
import { openCommandPalette } from "./command-palette";
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

/**
 * Menu tidak muat di satu baris (banyak item, layar laptop) → mode ringkas: tombol ☰ seperti di ponsel.
 * Diukur ulang saat ukuran jendela, aplikasi aktif, atau bahasa berubah.
 */
function useCompactNav(ref: RefObject<HTMLElement | null>, key: string) {
  const [compact, setCompact] = useState(false);
  const [probe, setProbe] = useState(0);
  useEffect(() => {
    const onResize = () => {
      setCompact(false);
      setProbe((p) => p + 1);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    setCompact(false);
    setProbe((p) => p + 1);
  }, [key]);
  useLayoutEffect(() => {
    const header = ref.current;
    if (compact || !header) return;
    const menu = header.querySelector<HTMLElement>(".nav-menu");
    const right = header.querySelector<HTMLElement>(".nav-right");
    const company = header.querySelector<HTMLElement>(".nav-company-name");
    if (!menu || !right || getComputedStyle(menu).display === "none") return;
    const crowded =
      menu.getBoundingClientRect().right > right.getBoundingClientRect().left - 8 ||
      header.scrollWidth > header.clientWidth + 1 ||
      (!!company && company.scrollWidth > company.clientWidth + 1 && company.clientWidth < 120);
    if (crowded) setCompact(true);
  }, [compact, probe, ref]);
  return compact;
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
  const compact = useCompactNav(ref, `${app?.id ?? ""}|${menu.length}|${locale}`);

  return (
    <header className={`navbar${compact ? " compact" : ""}`} ref={ref}>
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
                  {entry.items.map((item, i) => (
                    <Fragment key={item.href + item.label.id}>
                      {item.section && item.section.id !== entry.items[i - 1]?.section?.id && (
                        <div className="nav-section">{tx(item.section)}</div>
                      )}
                      <Link href={item.href} className={active(item.href) ? "active" : ""}>
                        {tx(item.label)}
                      </Link>
                    </Fragment>
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
        <button
          type="button"
          className="nav-search"
          onClick={openCommandPalette}
          title={l("Cari menu & data (Ctrl+K)", "Search menus & records (Ctrl+K)")}
          aria-label={l("Cari", "Search")}
        >
          <span aria-hidden>⌕</span>
          <span className="nav-search-label">{l("Cari…", "Search…")}</span>
          <kbd>Ctrl K</kbd>
        </button>
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
