"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CommandPalette } from "../../components/command-palette";
import { MeContext } from "../../components/me-context";
import { Navbar, Sidebar } from "../../components/navbar";
import { api, ApiError, session, type Me } from "../../lib/api";
import { setErrorUser } from "../../lib/error-reporting";
import { appForPath, rememberApp, rememberedApp, visibleApps } from "../../lib/apps";
import { useI18n } from "../../lib/i18n";
import { can } from "../../lib/resources";

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t, l } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  // API tidak bisa dihubungi (server mati, gagal start, salah alamat): tampilkan pesan, bukan "Memuat…" tanpa akhir.
  const [offline, setOffline] = useState(false);
  // Sidebar ringkas (hanya ikon) di desktop; pilihan diingat di peramban.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem("erp.sidebar") === "collapsed");
  }, []);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      localStorage.setItem("erp.sidebar", c ? "expanded" : "collapsed");
      return !c;
    });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "\\" || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      toggleCollapsed();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);
  const [attempt, setAttempt] = useState(0);
  // Laci sidebar di layar sempit; tertutup setiap pindah halaman.
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [pathname]);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const apps = useMemo(() => (me ? visibleApps(me) : []), [me]);
  // Aplikasi aktif dari URL; halaman bersama (Produk, Kontak) mengikuti aplikasi yang terakhir dibuka.
  const app = pathname === "/" ? null : appForPath(apps, pathname, rememberedApp());

  useEffect(() => {
    if (app) rememberApp(app.id);
  }, [app]);

  useEffect(() => {
    if (!session.token()) {
      router.replace("/login");
      return;
    }
    let done = false;
    setOffline(false);
    const slow = setTimeout(() => {
      if (!done) setOffline(true);
    }, 15_000);
    api<Me>("/auth/me")
      .then((data) => {
        if (done) return;
        session.setCompanyId(data.activeCompanyId);
        setErrorUser(data);
        setMe(data);
        setOffline(false);
      })
      .catch((e: unknown) => {
        if (done) return;
        // Jaringan gagal/API tidak jalan bukan berarti sesi tidak sah: jangan logout, beri tahu & tawarkan coba lagi.
        if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) {
          setOffline(true);
          return;
        }
        session.clear();
        router.replace("/login");
      })
      .finally(() => clearTimeout(slow));
    return () => {
      // Dibatalkan karena pindah halaman / dicoba ulang: abaikan hasil request lama.
      done = true;
      clearTimeout(slow);
    };
  }, [router, attempt]);

  if (!me && offline)
    return (
      <main className="shell" role="alert">
        <h1>{l("Tidak dapat terhubung ke server", "Cannot reach the server")}</h1>
        <p className="muted">
          {l(
            "Aplikasi tidak bisa menghubungi server saat ini. Periksa koneksi internet Anda lalu coba lagi. Bila masalah berlanjut, hubungi administrator.",
            "The app cannot reach the server right now. Check your internet connection and try again. If the problem persists, contact your administrator.",
          )}
        </p>
        <button type="button" className="primary" onClick={() => setAttempt((n) => n + 1)}>
          {l("Coba lagi", "Try again")}
        </button>
      </main>
    );
  if (!me) return <main className="shell muted">{t("app.loading")}</main>;

  return (
    <MeContext.Provider value={me}>
      <div className={`app${pathname === "/" ? " home" : ""}${collapsed ? " side-collapsed" : ""}`}>
        <a className="skip-link" href="#main">
          {t("app.skip")}
        </a>
        <Suspense fallback={<aside className="sidebar" />}>
          <Sidebar
            me={me}
            app={app}
            open={drawer}
            onClose={closeDrawer}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapsed}
          />
        </Suspense>
        <div className="app-main">
          <Navbar me={me} app={app} onMenu={() => setDrawer(true)} menuOpen={drawer} />
          <CommandPalette me={me} />
          <main className="content" id="main">
            <SubscriptionBanner me={me} home={pathname === "/"} />
            {children}
          </main>
        </div>
      </div>
    </MeContext.Provider>
  );
}

/** Pengingat masa uji coba / langganan berakhir di atas setiap halaman. */
function SubscriptionBanner({ me, home }: { me: Me; home: boolean }) {
  const { l } = useI18n();
  const { status, planName } = me.subscription;
  const manage = can(me.permissions, "billing.manage");
  const action = manage && (
    <Link href="/settings/billing">{l("Kelola langganan", "Manage subscription")}</Link>
  );
  // Info uji coba cukup di beranda; peringatan jatuh tempo/berakhir tampil di semua halaman.
  if (status === "trialing" && home)
    return (
      <div className="banner">
        {l(`Masa uji coba paket ${planName}.`, `${planName} trial.`)} {action}
      </div>
    );
  if (status === "past_due")
    return (
      <div className="banner warn">
        {l(
          "Periode langganan sudah berakhir — segera bayar tagihan agar akun tidak menjadi baca-saja.",
          "Your subscription period has ended — pay the invoice to avoid read-only mode.",
        )}{" "}
        {action}
      </div>
    );
  if (status === "expired" || status === "suspended")
    return (
      <div className="banner bad">
        {status === "suspended"
          ? l("Akun ditangguhkan. Hubungi tim kami.", "Account suspended. Contact us.")
          : l(
              "Langganan berakhir — data hanya bisa dibaca.",
              "Subscription expired — data is read-only.",
            )}{" "}
        {action}
      </div>
    );
  return null;
}
