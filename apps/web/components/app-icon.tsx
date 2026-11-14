/** Ikon aplikasi datar berwarna (gaya beranda Odoo), digambar dengan bentuk SVG sederhana. */
const ICONS: Record<string, React.ReactNode> = {
  crm: (
    <>
      <path d="M8 18h48L36 42H28z" fill="#1ab7a6" />
      <path d="M20 18h24L32 34z" fill="#875a7b" />
      <rect x="28" y="40" width="8" height="12" rx="2" fill="#f0a033" />
    </>
  ),
  sales: (
    <>
      <rect x="10" y="30" width="12" height="22" rx="2" fill="#875a7b" />
      <rect x="26" y="20" width="12" height="32" rx="2" fill="#f06050" />
      <rect x="42" y="10" width="12" height="42" rx="2" fill="#f0a033" />
    </>
  ),
  purchase: (
    <>
      <rect x="8" y="14" width="48" height="36" rx="5" fill="#875a7b" />
      <rect x="8" y="22" width="48" height="8" fill="#1ab7a6" />
      <rect x="14" y="38" width="16" height="5" rx="2" fill="#f4dce9" />
    </>
  ),
  inventory: (
    <>
      <path d="M32 6l22 12v26L32 58 10 44V18z" fill="#f0a033" />
      <path d="M32 30l22-12v26L32 58z" fill="#875a7b" />
      <path d="M32 30L10 18v26l22 14z" fill="#f06050" />
    </>
  ),
  accounting: (
    <>
      <circle cx="22" cy="22" r="10" fill="#f0a033" />
      <circle cx="42" cy="42" r="10" fill="#1ab7a6" />
      <path d="M46 12l6 6-34 34-6-6z" fill="#875a7b" />
    </>
  ),
  tax: (
    <>
      <path d="M14 8h28l10 10v38H14z" fill="#e8e1f0" />
      <path d="M42 8l10 10H42z" fill="#875a7b" />
      <rect x="20" y="28" width="22" height="4" rx="2" fill="#875a7b" />
      <rect x="20" y="36" width="16" height="4" rx="2" fill="#875a7b" />
      <circle cx="44" cy="46" r="9" fill="#1ab7a6" />
      <path d="M40 46l3 3 5-6" stroke="#fff" strokeWidth="2.5" fill="none" />
    </>
  ),
  employees: (
    <>
      <circle cx="32" cy="20" r="9" fill="#875a7b" />
      <rect x="18" y="32" width="28" height="14" rx="7" fill="#875a7b" />
      <circle cx="14" cy="30" r="6" fill="#f0a033" />
      <circle cx="50" cy="30" r="6" fill="#1ab7a6" />
      <rect x="6" y="38" width="16" height="10" rx="5" fill="#f0a033" />
      <rect x="42" y="38" width="16" height="10" rx="5" fill="#1ab7a6" />
    </>
  ),
  payroll: (
    <>
      <circle cx="22" cy="24" r="12" fill="#1ab7a6" />
      <text x="22" y="29" fontSize="14" fontWeight="700" textAnchor="middle" fill="#fff">
        Rp
      </text>
      <rect x="30" y="34" width="24" height="16" rx="4" fill="#875a7b" />
      <circle cx="42" cy="42" r="4" fill="#f0a033" />
    </>
  ),
  bi: (
    <>
      <rect x="8" y="8" width="48" height="48" rx="8" fill="#e8e1f0" />
      <rect x="15" y="34" width="8" height="15" rx="2" fill="#875a7b" />
      <rect x="28" y="24" width="8" height="25" rx="2" fill="#1ab7a6" />
      <rect x="41" y="15" width="8" height="34" rx="2" fill="#f0a033" />
    </>
  ),
  manufacturing: (
    <>
      <path d="M8 52V30l12 8v-8l12 8v-8l12 8V14h10v38z" fill="#875a7b" />
      <rect x="14" y="42" width="6" height="6" rx="1" fill="#f0a033" />
      <rect x="26" y="42" width="6" height="6" rx="1" fill="#f0a033" />
      <rect x="38" y="42" width="6" height="6" rx="1" fill="#f0a033" />
      <circle cx="49" cy="9" r="4" fill="#1ab7a6" />
    </>
  ),
  maintenance: (
    <>
      <circle cx="26" cy="38" r="14" fill="#875a7b" />
      <circle cx="26" cy="38" r="5" fill="#e8e1f0" />
      <path d="M36 10l8 0 2 6 6 2v8l-6 2-2 6h-8l-2-6-6-2v-8l6-2z" fill="#1ab7a6" />
      <circle cx="40" cy="22" r="3" fill="#e8e1f0" />
      <rect x="46" y="40" width="10" height="16" rx="2" fill="#f0a033" />
    </>
  ),
  quality: (
    <>
      <rect x="12" y="8" width="34" height="44" rx="5" fill="#e8e1f0" />
      <rect x="18" y="16" width="20" height="4" rx="2" fill="#875a7b" />
      <rect x="18" y="25" width="16" height="4" rx="2" fill="#875a7b" />
      <circle cx="42" cy="44" r="12" fill="#1ab7a6" />
      <path d="M36 44l4 4 8-8" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="round" />
    </>
  ),
  fleet: (
    <>
      <path d="M12 30l6-12h28l6 12z" fill="#1ab7a6" />
      <rect x="8" y="28" width="48" height="16" rx="5" fill="#875a7b" />
      <circle cx="20" cy="46" r="6" fill="#f0a033" />
      <circle cx="44" cy="46" r="6" fill="#f0a033" />
      <rect x="22" y="21" width="20" height="7" rx="1" fill="#e8e1f0" />
    </>
  ),
  contacts: (
    <>
      <rect x="10" y="10" width="44" height="44" rx="8" fill="#e8e1f0" />
      <circle cx="32" cy="27" r="8" fill="#875a7b" />
      <path d="M18 48c2-9 8-12 14-12s12 3 14 12z" fill="#875a7b" />
    </>
  ),
  group: (
    <>
      <rect x="24" y="6" width="16" height="14" rx="3" fill="#875a7b" />
      <rect x="6" y="40" width="16" height="14" rx="3" fill="#1ab7a6" />
      <rect x="24" y="40" width="16" height="14" rx="3" fill="#f0a033" />
      <rect x="42" y="40" width="16" height="14" rx="3" fill="#f06050" />
      <path d="M32 20v20M14 40v-8h36v8" stroke="#875a7b" strokeWidth="3" fill="none" />
    </>
  ),
  consolidation: (
    <>
      <rect x="6" y="8" width="20" height="14" rx="3" fill="#1ab7a6" />
      <rect x="38" y="8" width="20" height="14" rx="3" fill="#f0a033" />
      <path d="M16 22v8h32v-8M32 30v8" stroke="#875a7b" strokeWidth="3" fill="none" />
      <rect x="16" y="38" width="32" height="18" rx="4" fill="#875a7b" />
      <rect x="22" y="44" width="20" height="3" rx="1.5" fill="#fff" />
      <rect x="22" y="49" width="12" height="3" rx="1.5" fill="#fff" />
    </>
  ),
  me: (
    <>
      <circle cx="32" cy="32" r="24" fill="#1ab7a6" />
      <circle cx="32" cy="26" r="8" fill="#fff" />
      <path d="M18 46c3-8 8-10 14-10s11 2 14 10" fill="#fff" />
    </>
  ),
  settings: (
    <>
      <circle cx="32" cy="32" r="18" fill="#875a7b" />
      <circle cx="32" cy="32" r="7" fill="#fff" />
      <g fill="#875a7b">
        <rect x="28" y="6" width="8" height="10" rx="2" />
        <rect x="28" y="48" width="8" height="10" rx="2" />
        <rect x="6" y="28" width="10" height="8" rx="2" />
        <rect x="48" y="28" width="10" height="8" rx="2" />
      </g>
    </>
  ),
  platform: (
    <>
      <rect x="8" y="10" width="48" height="12" rx="3" fill="#875a7b" />
      <rect x="8" y="26" width="48" height="12" rx="3" fill="#1ab7a6" />
      <rect x="8" y="42" width="48" height="12" rx="3" fill="#f0a033" />
      <circle cx="16" cy="16" r="2.5" fill="#fff" />
      <circle cx="16" cy="32" r="2.5" fill="#fff" />
      <circle cx="16" cy="48" r="2.5" fill="#fff" />
    </>
  ),
};

export function AppIcon({ id, size = 64 }: { id: string; size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      {ICONS[id] ?? <rect x="12" y="12" width="40" height="40" rx="8" fill="#875a7b" />}
    </svg>
  );
}

/** Ikon pengalih aplikasi (titik 3×3) di kiri atas navbar. */
export function AppsGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
      {[4, 12, 20].flatMap((y) => [4, 12, 20].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.2" />))}
    </svg>
  );
}
