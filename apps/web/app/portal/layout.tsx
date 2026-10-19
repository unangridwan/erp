import type { ReactNode } from "react";

export const metadata = { title: "Portal Pelanggan" };

/** Portal pelanggan: tanpa shell aplikasi internal. */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return <div className="portal">{children}</div>;
}
