"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "../../lib/i18n";
import { portalSession } from "../../lib/portal-api";

export function PortalHeader({ title }: { title?: string }) {
  const router = useRouter();
  const { l } = useI18n();
  return (
    <header className="portal-header">
      <Link href="/portal" className="portal-brand">
        {l("Portal Pelanggan", "Customer Portal")}
      </Link>
      {title && <span className="muted">{title}</span>}
      <button
        type="button"
        className="link"
        onClick={() => {
          portalSession.set(null);
          router.replace("/portal/login");
        }}
      >
        {l("Keluar", "Sign out")}
      </button>
    </header>
  );
}
