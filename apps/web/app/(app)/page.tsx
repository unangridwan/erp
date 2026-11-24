"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppIcon } from "../../components/app-icon";
import { openCommandPalette } from "../../components/command-palette";
import { PinnedDashboards } from "../../components/bi/pinned-dashboards";
import { HomeKpis } from "../../components/home-kpis";
import { useMe } from "../../components/me-context";
import { api, ApiError } from "../../lib/api";
import { rememberApp, visibleApps } from "../../lib/apps";
import { useI18n } from "../../lib/i18n";
import { toggleFavorite, useFavorites, useRecent } from "../../lib/recent";
import { can, canCreate, RESOURCES } from "../../lib/resources";

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
  const [pendingFailed, setPendingFailed] = useState(false);
  // Ringkasan Pekerjaan Saya (dokumen yang saya pegang, aktivitas, departemen saya, sebutan).
  const [work, setWork] = useState<{
    documents: number;
    documentsLate: number;
    departmentWaiting: number;
    departmentLate: number;
    activitiesOverdue: number;
    activitiesToday: number;
    mentionsUnread: number;
  } | null>(null);
  useEffect(() => {
    api<{ summary: NonNullable<typeof work> }>("/me/work").then(
      (w) => setWork(w.summary),
      () => setWork(null),
    );
  }, []);
  // PO yang menunggu persetujuan saya (bukan hanya persetujuan SDM).
  const [poPending, setPoPending] = useState<{ id: string; name: string; partnerName: string | null }[]>([]);
  useEffect(() => {
    if (!can(me.permissions, "purchase.read")) return;
    api<{ id: string; name: string; partnerName: string | null }[]>("/purchase-orders/pending-approval").then(
      setPoPending,
      () => setPoPending([]),
    );
  }, [me.permissions]);
  // Perusahaan baru: arahkan ke Panduan Awal sampai selesai.
  const [setupLeft, setSetupLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!can(me.permissions, "company.write")) return;
    api<{ remaining: number; completedAt: string | null }>("/onboarding").then(
      (s) => setSetupLeft(s.completedAt ? null : s.remaining),
      () => setSetupLeft(null),
    );
  }, [me.permissions]);
  useEffect(() => {
    // Tanpa hak persetujuan (403) = memang tidak ada yang menunggu; galat lain jangan ditampilkan sebagai "kosong".
    api<Pending[]>("/approvals/pending").then(setPending, (e: unknown) => {
      setPending([]);
      if (!(e instanceof ApiError && e.status === 403)) setPendingFailed(true);
    });
    api<{ unread: number }>("/me/notifications/count").then(
      (r) => setUnread(r.unread),
      () => setUnread(0),
    );
  }, []);
  const workAlerts =
    !!work &&
    (work.documentsLate > 0 ||
      work.activitiesOverdue + work.activitiesToday > 0 ||
      work.departmentLate > 0 ||
      work.mentionsUnread > 0);
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

      {setupLeft !== null && setupLeft > 0 && (
        <div className="banner home-setup">
          {l(
            `Lengkapi pengaturan awal perusahaan: ${setupLeft} langkah lagi.`,
            `Finish setting up your company: ${setupLeft} steps left.`,
          )}{" "}
          <Link href="/onboarding">{l("Lanjutkan Panduan Awal", "Continue Getting Started")}</Link>
        </div>
      )}

      <HomeKpis me={me} />

      <PinnedDashboards />

      <div className="home-cards">
        <section className="home-card">
          <h2>{l("Perlu tindakan saya", "Needs my action")}</h2>
          {workAlerts && (
            <ul className="home-list home-work">
              {work.documentsLate > 0 && (
                <li>
                  <span className="badge danger">{work.documentsLate}</span>
                  <Link href="/me/work">
                    {l("dokumen yang saya pegang terlambat", "documents I hold are late")}
                  </Link>
                </li>
              )}
              {work.activitiesOverdue + work.activitiesToday > 0 && (
                <li>
                  <span className={`badge ${work.activitiesOverdue ? "danger" : "warn"}`}>
                    {work.activitiesOverdue + work.activitiesToday}
                  </span>
                  <Link href="/me/work">
                    {l("aktivitas jatuh tempo hari ini / lewat", "activities due today / overdue")}
                  </Link>
                </li>
              )}
              {work.departmentLate > 0 && (
                <li>
                  <span className="badge warn">{work.departmentLate}</span>
                  <Link href="/flow/handoffs">
                    {l("pekerjaan terlambat di departemen saya", "late items in my department")}
                  </Link>
                </li>
              )}
              {work.mentionsUnread > 0 && (
                <li>
                  <span className="badge">{work.mentionsUnread}</span>
                  <Link href="/me/work">{l("sebutan & pengingat baru", "new mentions & reminders")}</Link>
                </li>
              )}
            </ul>
          )}
          {pending === null ? (
            <p className="muted small">{l("Memuat…", "Loading…")}</p>
          ) : pending.length || unread || poPending.length ? (
            <ul className="home-list">
              {poPending.slice(0, 5).map((o) => (
                <li key={`po:${o.id}`}>
                  <Link href={`/purchase/orders/${o.id}`}>
                    {l(`Setujui PO ${o.name}`, `Approve PO ${o.name}`)}
                  </Link>
                  <span className="muted small">{o.partnerName ?? ""}</span>
                </li>
              ))}
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
          ) : workAlerts && !pendingFailed ? null : (
            <p className="muted small">
              {pendingFailed
                ? l(
                    "Daftar persetujuan tidak dapat dimuat saat ini.",
                    "The approval list could not be loaded right now.",
                  )
                : l("Tidak ada yang menunggu. 🎉", "Nothing waiting. 🎉")}
            </p>
          )}
          <p className="small home-work-link">
            <Link href="/me/work">{l("Buka Pekerjaan Saya & KPI →", "Open My Work & KPIs →")}</Link>
          </p>
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

        {(quick.length > 0 ||
          can(me.permissions, "sales.write") ||
          can(me.permissions, "accounting.write")) && (
          <section className="home-card">
            <h2>{l("Buat cepat", "Quick create")}</h2>
            <div className="home-quick">
              {can(me.permissions, "sales.write") && (
                <Link className="button" href="/sales/orders/new">
                  + {l("Penawaran", "Quotation")}
                </Link>
              )}
              {can(me.permissions, "accounting.write") && (
                <Link className="button" href="/accounting/moves/new?type=out_invoice">
                  + {l("Faktur", "Invoice")}
                </Link>
              )}
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
