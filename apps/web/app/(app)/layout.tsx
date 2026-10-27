"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MeContext } from "../../components/me-context";
import { Navbar } from "../../components/navbar";
import { api, ApiError, session, type Me } from "../../lib/api";
import { setErrorUser } from "../../lib/error-reporting";
import { appForPath, rememberApp, rememberedApp, visibleApps } from "../../lib/apps";
import { useI18n } from "../../lib/i18n";
import { can } from "../../lib/resources";

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
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
    api<Me>("/auth/me")
      .then((data) => {
        session.setCompanyId(data.activeCompanyId);
        setErrorUser(data);
        setMe(data);
      })
      .catch((e: unknown) => {
        // Request dibatalkan karena pindah halaman (atau jaringan putus) bukan berarti sesi tidak sah.
        if (!(e instanceof ApiError)) return;
        session.clear();
        router.replace("/login");
      });
  }, [router]);

  if (!me) return <main className="shell muted">{t("app.loading")}</main>;

  return (
    <MeContext.Provider value={me}>
      <div className={`app ${pathname === "/" ? "home" : ""}`}>
        <Navbar me={me} app={app} />
        <main className="content">
          <SubscriptionBanner me={me} home={pathname === "/"} />
          {children}
        </main>
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
