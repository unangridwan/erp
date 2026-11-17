"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppIcon } from "../../components/app-icon";
import { openCommandPalette } from "../../components/command-palette";
import { PinnedDashboards } from "../../components/bi/pinned-dashboards";
import { useMe } from "../../components/me-context";
import { api } from "../../lib/api";
import { rememberApp, visibleApps } from "../../lib/apps";
import { useI18n } from "../../lib/i18n";
import { toggleFavorite, useFavorites, useRecent } from "../../lib/recent";
import { canCreate, RESOURCES } from "../../lib/resources";

interface Pending {
  model: string;
  id: string;
  employeeName: string;
  summary: string;
}

/** Pintasan "buat baru" yang sering dipakai (tampil bila user berhak). */
const QUICK_CREATE = ["employees", "partners", "products", "leaves", "expenses"];

/**
 * Beranda: yang perlu tindakan saya (persetujuan menunggu & notifikasi), favorit & terakhir dibuka, buat cepat, lalu
 * grid ikon aplikasi (sesuai permission & paket).
 */
export default function Home() {
  const me = useMe();
  const { tx, l, locale } = useI18n();
  const apps = visibleApps(me);
  const recent = useRecent();
  const favorites = useFavorites();
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    api<Pending[]>("/approvals/pending").then(setPending, () => setPending([]));
    api<{ unread: number }>("/me/notifications/count").then(
      (r) => setUnread(r.unread),
      () => setUnread(0),
    );
  }, []);
  const quick = QUICK_CREATE.map((p) => RESOURCES.find((r) => r.path === p)).filter(
    (r): r is (typeof RESOURCES)[number] => !!r && canCreate(me.permissions, r),
  );
  const firstName = me.name.split(" ")[0];

  return (
    <div className="home-page">
      <header className="home-hero">
        <div>
          <h1>{l(`Halo, ${firstName}`, `Hello, ${firstName}`)}</h1>
          <p className="muted home-date">
            {new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { dateStyle: "full" }).format(
              new Date(),
            )}
          </p>
        </div>
        <button type="button" className="home-search" onClick={openCommandPalette}>
          <span aria-hidden>⌕</span>
          {l("Cari menu, karyawan, pesanan, faktur…", "Search menus, employees, orders, invoices…")}
          <kbd>Ctrl K</kbd>
        </button>
      </header>

      <PinnedDashboards />

      <div className="home-cards">
        <section className="home-card">
          <h2>{l("Perlu tindakan saya", "Needs my action")}</h2>
          {pending === null ? (
            <p className="muted small">{l("Memuat…", "Loading…")}</p>
          ) : pending.length || unread ? (
            <ul className="home-list">
              {pending.slice(0, 5).map((p) => (
                <li key={`${p.model}:${p.id}`}>
                  <Link href="/hr/approvals">{p.summary}</Link>
                  <span className="muted small">{p.employeeName}</span>
                </li>
              ))}
              {pending.length > 5 && (
                <li>
                  <Link href="/hr/approvals">
                    {l(`+${pending.length - 5} persetujuan lain`, `+${pending.length - 5} more approvals`)}
                  </Link>
                </li>
              )}
              {unread > 0 && (
                <li>
                  <span className="pill">{unread}</span>{" "}
                  {l(
                    "notifikasi belum dibaca — buka lonceng di atas",
                    "unread notifications — open the bell above",
                  )}
                </li>
              )}
            </ul>
          ) : (
            <p className="muted small">{l("Tidak ada yang menunggu. 🎉", "Nothing waiting. 🎉")}</p>
          )}
        </section>

        <section className="home-card">
          <h2>{l("Favorit & terakhir dibuka", "Favorites & recent")}</h2>
          {favorites.length + recent.length === 0 ? (
            <p className="muted small">
              {l(
                "Data yang Anda buka akan muncul di sini. Klik ☆ di halaman data untuk menjadikannya favorit.",
                "Records you open appear here. Click ☆ on a record to make it a favorite.",
              )}
            </p>
          ) : (
            <ul className="home-list">
              {favorites.map((f) => (
                <li key={`f:${f.href}`}>
                  <button
                    type="button"
                    className="link star on"
                    aria-label={l("Hapus dari favorit", "Remove from favorites")}
                    onClick={() => toggleFavorite(f)}
                  >
                    ★
                  </button>
                  <Link href={f.href}>{f.title}</Link>
                  {f.kind && <span className="muted small">{f.kind}</span>}
                </li>
              ))}
              {recent
                .filter((r) => !favorites.some((f) => f.href === r.href))
                .slice(0, 6)
                .map((r) => (
                  <li key={`r:${r.href}`}>
                    <span className="muted" aria-hidden>
                      ↺
                    </span>
                    <Link href={r.href}>{r.title}</Link>
                    {r.kind && <span className="muted small">{r.kind}</span>}
                  </li>
                ))}
            </ul>
          )}
        </section>

        {quick.length > 0 && (
          <section className="home-card">
            <h2>{l("Buat cepat", "Quick create")}</h2>
            <div className="home-quick">
              {quick.map((r) => (
                <Link key={r.path} className="button" href={`/${r.path}/new`}>
                  + {tx(r.singular)}
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      <h2 className="home-apps-title">{l("Aplikasi", "Apps")}</h2>
      <div className="app-grid">
        {apps.map((app) => (
          <Link key={app.id} href={app.home} className="app-tile" onClick={() => rememberApp(app.id)}>
            <span className="app-tile-icon">
              <AppIcon id={app.id} size={30} />
            </span>
            <span>{tx(app.name)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
