"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { MeContext } from "../../components/me-context";
import { api, session, type Me } from "../../lib/api";
import { L, LocaleSwitch, useI18n } from "../../lib/i18n";
import { can, PAGES, RESOURCES } from "../../lib/resources";

/** Modul paket langganan dari permission (mis. "hr.read" → "hr"); null = fitur inti. */
const MODULE_OF = new Set(["accounting", "crm", "sales", "purchase", "inventory", "tax", "hr", "payroll"]);
const moduleOf = (permission: string) => {
  const prefix = permission.split(".")[0] ?? "";
  return MODULE_OF.has(prefix) ? prefix : null;
};

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t, tx } = useI18n();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    if (!session.token()) {
      router.replace("/login");
      return;
    }
    api<Me>("/auth/me")
      .then((data) => {
        session.setCompanyId(data.activeCompanyId);
        setMe(data);
      })
      .catch(() => {
        session.clear();
        router.replace("/login");
      });
  }, [router]);

  if (!me) return <main className="shell muted">{t("app.loading")}</main>;

  const groups = [...new Map([...RESOURCES, ...PAGES].map((r) => [r.group.id, r.group])).values()];
  const sub = me.subscription;
  // Modul di luar paket disembunyikan dari menu (API juga menolaknya).
  const inPlan = (permission: string) => {
    const module = moduleOf(permission);
    return !module || sub.modules.includes(module);
  };
  const allowed = (permission: string) => can(me.permissions, permission) && inPlan(permission);
  const link = (href: string, label: string) => (
    <Link key={href} href={href} className={pathname.startsWith(href) ? "active" : ""}>
      {label}
    </Link>
  );

  return (
    <MeContext.Provider value={me}>
      <div className="app">
        <aside className="sidebar">
          <Link href="/" className="brand">
            ERP
          </Link>
          <label className="field">
            <span>{t("app.activeCompany")}</span>
            <select
              value={me.activeCompanyId}
              onChange={(e) => {
                session.setCompanyId(e.target.value);
                window.location.reload();
              }}
            >
              {me.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </label>
          {groups.map((group) => {
            const pages = PAGES.filter((p) => p.group.id === group.id && allowed(p.permission));
            const items = RESOURCES.filter((r) => r.group.id === group.id && allowed(`${r.permission}.read`));
            if (!items.length && !pages.length) return null;
            return (
              <nav key={group.id}>
                <h2>{tx(group)}</h2>
                {pages.map((p) => link(p.href, tx(p.label)))}
                {items.map((r) => link(`/${r.path}`, tx(r.title)))}
              </nav>
            );
          })}
          <nav>
            <h2>{t("nav.settings")}</h2>
            {can(me.permissions, "company.write") &&
              link("/onboarding", tx(L("Panduan Awal", "Getting Started")))}
            {can(me.permissions, "user.read") && link("/settings/users", t("nav.users"))}
            {can(me.permissions, "billing.manage") &&
              link("/settings/billing", tx(L("Langganan", "Subscription")))}
            {link("/settings/security", t("nav.security"))}
            {me.platformAdmin && link("/platform", tx(L("Admin Platform", "Platform Admin")))}
          </nav>
          <div className="user">
            <span>{me.name}</span>
            <button
              className="link"
              onClick={async () => {
                await session.logout();
                router.replace("/login");
              }}
            >
              {t("app.logout")}
            </button>
          </div>
          <LocaleSwitch />
        </aside>
        <main className="content">
          <SubscriptionBanner me={me} />
          {children}
        </main>
      </div>
    </MeContext.Provider>
  );
}

/** Pengingat masa uji coba / langganan berakhir di atas setiap halaman. */
function SubscriptionBanner({ me }: { me: Me }) {
  const { l } = useI18n();
  const { status, planName } = me.subscription;
  const manage = can(me.permissions, "billing.manage");
  const action = manage && (
    <Link href="/settings/billing">{l("Kelola langganan", "Manage subscription")}</Link>
  );
  if (status === "trialing")
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
