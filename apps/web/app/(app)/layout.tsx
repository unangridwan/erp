"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { MeContext } from "../../components/me-context";
import { api, session, type Me } from "../../lib/api";
import { RESOURCES } from "../../lib/resources";

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
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

  if (!me) return <main className="shell muted">Memuat…</main>;

  const groups = [...new Set(RESOURCES.map((r) => r.group))];
  const canRead = (perm: string) => me.permissions.includes("*") || me.permissions.includes(`${perm}.read`);

  return (
    <MeContext.Provider value={me}>
      <div className="app">
        <aside className="sidebar">
          <Link href="/" className="brand">
            ERP
          </Link>
          <label className="field">
            <span>Perusahaan aktif</span>
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
          {groups.map((group) => (
            <nav key={group}>
              <h2>{group}</h2>
              {RESOURCES.filter((r) => r.group === group && canRead(r.permission)).map((r) => (
                <Link
                  key={r.path}
                  href={`/${r.path}`}
                  className={pathname.startsWith(`/${r.path}`) ? "active" : ""}
                >
                  {r.title}
                </Link>
              ))}
            </nav>
          ))}
          <div className="user">
            <span>{me.name}</span>
            <button
              className="link"
              onClick={() => {
                session.clear();
                router.replace("/login");
              }}
            >
              Keluar
            </button>
          </div>
        </aside>
        <main className="content">{children}</main>
      </div>
    </MeContext.Provider>
  );
}
