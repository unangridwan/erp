"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { can } from "../../lib/resources";
import { useI18n } from "../../lib/i18n";
import { useMe } from "../me-context";

/**
 * Satu tempat koreksi stok: Stock Opname (sesi hitung fisik dengan validasi) dan Penyesuaian cepat (langsung isi
 * jumlah fisik per lokasi). Dulu dua menu terpisah.
 */
export function CountTabs() {
  const { l } = useI18n();
  const me = useMe();
  const path = usePathname();
  const tabs: [string, string][] = [["/inventory/counts", l("Stock opname", "Physical inventory")]];
  if (can(me.permissions, "inventory.manage"))
    tabs.push(["/inventory/adjustments", l("Penyesuaian cepat", "Quick adjustment")]);
  if (tabs.length < 2) return null;
  return (
    <nav className="tabs" aria-label={l("Koreksi stok", "Stock correction")}>
      {tabs.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          className={path.startsWith(href) ? "active" : ""}
          aria-current={path.startsWith(href) ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
