"use client";

import Link from "next/link";
import { AppIcon } from "../../components/app-icon";
import { useMe } from "../../components/me-context";
import { rememberApp, visibleApps } from "../../lib/apps";
import { useI18n } from "../../lib/i18n";

/** Beranda gaya Odoo: grid ikon aplikasi yang bisa dibuka user (sesuai permission & paket). */
export default function Home() {
  const me = useMe();
  const { tx } = useI18n();
  const apps = visibleApps(me);
  return (
    <div className="app-grid">
      {apps.map((app) => (
        <Link key={app.id} href={app.home} className="app-tile" onClick={() => rememberApp(app.id)}>
          <span className="app-tile-icon">
            <AppIcon id={app.id} size={56} />
          </span>
          <span>{tx(app.name)}</span>
        </Link>
      ))}
    </div>
  );
}
