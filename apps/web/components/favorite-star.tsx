"use client";

import { useI18n } from "../lib/i18n";
import { toggleFavorite, useFavorites } from "../lib/recent";

/** Tombol ☆/★ untuk menandai halaman/data sebagai favorit (muncul di beranda & Ctrl+K). */
export function FavoriteStar({ href, title, kind }: { href: string; title: string; kind?: string }) {
  const { l } = useI18n();
  const on = useFavorites().some((f) => f.href === href);
  return (
    <button
      type="button"
      className={`link star${on ? " on" : ""}`}
      aria-pressed={on}
      title={
        on ? l("Hapus dari favorit", "Remove from favorites") : l("Tambah ke favorit", "Add to favorites")
      }
      aria-label={
        on ? l("Hapus dari favorit", "Remove from favorites") : l("Tambah ke favorit", "Add to favorites")
      }
      onClick={() => toggleFavorite({ href, title, kind })}
    >
      {on ? "★" : "☆"}
    </button>
  );
}
