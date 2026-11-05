"use client";

import { normalizeText } from "@erp/shared";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Me } from "../lib/api";
import { visibleApps, visibleMenu } from "../lib/apps";
import { useI18n } from "../lib/i18n";
import { useFavorites, useRecent } from "../lib/recent";
import { canCreate, canPath, RESOURCES } from "../lib/resources";

interface Item {
  key: string;
  label: string;
  hint?: string;
  group: string;
  href: string;
}

/** Pencarian data lintas modul: endpoint daftar yang mendukung `q` (hanya yang boleh dibaca user). */
const RECORD_SOURCES: {
  path: string;
  permission: string;
  label: [string, string];
  href: (r: Record<string, unknown>) => string;
  title: (r: Record<string, unknown>) => string;
  hint?: (r: Record<string, unknown>) => string | undefined;
}[] = [
  {
    path: "/employees",
    permission: "hr.read",
    label: ["Karyawan", "Employees"],
    href: (r) => `/employees/${r.id}`,
    title: (r) => String(r.name ?? ""),
    hint: (r) => (r.employeeNumber as string) ?? undefined,
  },
  {
    path: "/partners",
    permission: "partner.read",
    label: ["Kontak", "Contacts"],
    href: (r) => `/partners/${r.id}`,
    title: (r) => String(r.name ?? ""),
    hint: (r) => (r.email as string) ?? undefined,
  },
  {
    path: "/products",
    permission: "product.read",
    label: ["Produk", "Products"],
    href: (r) => `/products/${r.id}`,
    title: (r) => String(r.name ?? ""),
    hint: (r) => (r.code as string) ?? (r.sku as string) ?? undefined,
  },
  {
    path: "/sale-orders",
    permission: "sales.read",
    label: ["Pesanan penjualan", "Sales orders"],
    href: (r) => `/sales/orders/${r.id}`,
    title: (r) => String(r.name ?? ""),
    hint: (r) => (r.partnerName as string) ?? undefined,
  },
  {
    path: "/purchase-orders",
    permission: "purchase.read",
    label: ["Pesanan pembelian", "Purchase orders"],
    href: (r) => `/purchase/orders/${r.id}`,
    title: (r) => String(r.name ?? ""),
    hint: (r) => (r.partnerName as string) ?? undefined,
  },
  {
    path: "/moves",
    permission: "accounting.read",
    label: ["Faktur & jurnal", "Invoices & entries"],
    href: (r) => `/accounting/moves/${r.id}`,
    title: (r) => String(r.name ?? r.ref ?? "Draft"),
    hint: (r) => (r.partnerName as string) ?? undefined,
  },
];

/**
 * Palet perintah (Ctrl+K / ⌘K atau tombol Cari di navbar): buka menu/aplikasi, buat data baru, halaman terakhir &
 * favorit, dan cari data (karyawan, kontak, produk, pesanan, faktur) dari mana saja.
 */
export function CommandPalette({ me }: { me: Me }) {
  const { l, tx } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [records, setRecords] = useState<Item[]>([]);
  const [searching, setSearching] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const recent = useRecent();
  const favorites = useFavorites();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !open && !isTyping(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("erp:command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("erp:command-palette", onOpen);
    };
  }, [open]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setQ("");
      setActive(0);
      setRecords([]);
      requestAnimationFrame(() => input.current?.focus());
    }
    if (!open && d.open) d.close();
  }, [open]);

  // Semua tujuan statis: menu aplikasi + "Buat …".
  const commands = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const app of visibleApps(me)) {
      const appName = tx(app.name);
      out.push({
        key: `app:${app.id}`,
        label: appName,
        hint: l("Aplikasi", "App"),
        group: "menu",
        href: app.home,
      });
      for (const entry of visibleMenu(me, app)) {
        const links = "items" in entry ? entry.items : [entry];
        for (const link of links)
          out.push({
            key: `menu:${app.id}:${link.href}`,
            label: tx(link.label),
            hint: "items" in entry ? `${appName} › ${tx(entry.label)}` : appName,
            group: "menu",
            href: link.href,
          });
      }
    }
    const seen = new Set<string>();
    for (const r of RESOURCES)
      if (canCreate(me.permissions, r) && !seen.has(r.path)) {
        seen.add(r.path);
        out.push({
          key: `new:${r.path}`,
          label: l(`Buat ${tx(r.singular).toLowerCase()} baru`, `New ${tx(r.singular).toLowerCase()}`),
          hint: tx(r.title),
          group: "create",
          href: `/${r.path}/new`,
        });
      }
    // Satu tautan per tujuan (menu yang sama dipakai beberapa aplikasi).
    const unique = new Map<string, Item>();
    for (const item of out) if (!unique.has(item.href + item.group)) unique.set(item.href + item.group, item);
    return [...unique.values()];
  }, [me, tx, l]);

  const query = normalizeText(q.trim());
  const matched = useMemo(() => {
    const score = (item: Item) => {
      const label = normalizeText(item.label);
      const hint = normalizeText(item.hint ?? "");
      if (label.startsWith(query)) return 3;
      if (label.includes(query)) return 2;
      if (query.split(/\s+/).every((w) => label.includes(w) || hint.includes(w))) return 1;
      return 0;
    };
    if (!query) {
      const pinned: Item[] = [
        ...favorites.map((f) => ({
          key: `fav:${f.href}`,
          label: f.title,
          hint: f.kind,
          group: "favorite",
          href: f.href,
        })),
        ...recent
          .filter((r) => !favorites.some((f) => f.href === r.href))
          .slice(0, 6)
          .map((r) => ({
            key: `recent:${r.href}`,
            label: r.title,
            hint: r.kind,
            group: "recent",
            href: r.href,
          })),
      ];
      return pinned.length ? pinned : commands.filter((c) => c.group === "menu").slice(0, 8);
    }
    return commands
      .map((c) => ({ c, s: score(c) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.c.label.localeCompare(b.c.label))
      .slice(0, 12)
      .map((x) => x.c);
  }, [query, commands, recent, favorites]);

  // Cari data di server (tertunda 250 ms; hanya sumber yang boleh dibaca).
  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setRecords([]);
      return;
    }
    const sources = RECORD_SOURCES.filter((s) => canPath(me.permissions, s.permission, s.path));
    let alive = true;
    const timer = setTimeout(() => {
      setSearching(true);
      void Promise.all(
        sources.map((s) =>
          api<{ items: Record<string, unknown>[] } | Record<string, unknown>[]>(
            `${s.path}?q=${encodeURIComponent(q.trim())}&limit=5`,
          ).then(
            (d) =>
              (Array.isArray(d) ? d : d.items).slice(0, 5).map((r) => ({
                key: `rec:${s.path}:${String(r.id)}`,
                label: s.title(r) || "—",
                hint: [l(...s.label), s.hint?.(r)].filter(Boolean).join(" · "),
                group: "record",
                href: s.href(r),
              })),
            () => [] as Item[],
          ),
        ),
      ).then((groups) => {
        if (!alive) return;
        setRecords(groups.flat());
        setSearching(false);
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, open, me.permissions, l]);

  const items = [...matched, ...records];
  useEffect(() => setActive(0), [q]);
  const go = (item: Item | undefined) => {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  };
  const GROUP: Record<string, string> = {
    favorite: l("Favorit", "Favorites"),
    recent: l("Terakhir dibuka", "Recently opened"),
    menu: l("Menu", "Menu"),
    create: l("Buat baru", "Create"),
    record: l("Data", "Records"),
  };

  return (
    <dialog
      ref={dialog}
      className="modal palette"
      aria-label={l("Cari & perintah", "Search & commands")}
      onCancel={(e) => {
        e.preventDefault();
        setOpen(false);
      }}
      onMouseDown={(e) => {
        if (e.target === dialog.current) setOpen(false);
      }}
    >
      <input
        ref={input}
        className="palette-input"
        type="search"
        role="combobox"
        aria-expanded
        aria-controls="palette-list"
        aria-activedescendant={items[active] ? `palette-${active}` : undefined}
        placeholder={l("Cari menu, data, atau perintah…", "Search menus, records or commands…")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            go(items[active]);
          }
        }}
      />
      <ul id="palette-list" className="palette-list" role="listbox">
        {items.map((item, i) => (
          <li key={item.key} role="presentation">
            {(i === 0 || items[i - 1]!.group !== item.group) && (
              <div className="palette-group">{GROUP[item.group]}</div>
            )}
            <button
              type="button"
              id={`palette-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(item)}
            >
              <span className="palette-label">{item.label}</span>
              {item.hint && <span className="palette-hint">{item.hint}</span>}
            </button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="palette-empty muted">
            {searching ? l("Mencari…", "Searching…") : l("Tidak ada hasil.", "No results.")}
          </li>
        )}
      </ul>
      <footer className="palette-foot muted small">
        <span>↑↓ {l("pilih", "move")}</span>
        <span>Enter {l("buka", "open")}</span>
        <span>Esc {l("tutup", "close")}</span>
        <span>Ctrl K / /</span>
      </footer>
    </dialog>
  );
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** Buka palet dari tombol (mis. di navbar). */
export const openCommandPalette = () => window.dispatchEvent(new Event("erp:command-palette"));
