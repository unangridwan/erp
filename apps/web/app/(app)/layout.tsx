"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { MeContext } from "../../components/me-context";
import { api, session, type Me } from "../../lib/api";
import { LocaleSwitch, useI18n } from "../../lib/i18n";
import { can, PAGES, RESOURCES } from "../../lib/resources";

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
            const pages = PAGES.filter((p) => p.group.id === group.id && can(me.permissions, p.permission));
            const items = RESOURCES.filter(
              (r) => r.group.id === group.id && can(me.permissions, `${r.permission}.read`),
            );
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
            {can(me.permissions, "user.read") && link("/settings/users", t("nav.users"))}
            {link("/settings/security", t("nav.security"))}
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
        <main className="content">{children}</main>
      </div>
    </MeContext.Provider>
  );
}
