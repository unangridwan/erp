"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "../lib/i18n";

/**
 * Keadaan kosong: pesan + tombol tindakan ("Buat … pertama" bila belum ada data, "Hapus filter" bila filter/pencarian
 * menyembunyikan semua baris).
 */
export function EmptyState({
  filtered,
  onClear,
  createHref,
  createLabel,
  message,
  compact,
}: {
  /** Ada data tetapi tidak cocok filter/pencarian. */
  filtered?: boolean;
  onClear?: () => void;
  createHref?: string;
  createLabel?: string;
  message?: ReactNode;
  compact?: boolean;
}) {
  const { l } = useI18n();
  return (
    <div className={`empty-state${compact ? " compact" : ""}`} role="status">
      <span className="empty-icon" aria-hidden>
        {filtered ? "⌕" : "∅"}
      </span>
      <p>
        {message ??
          (filtered
            ? l("Tidak ada data yang cocok dengan pencarian/filter.", "No rows match the search/filters.")
            : l("Belum ada data.", "No records yet."))}
      </p>
      {filtered && onClear ? (
        <button type="button" onClick={onClear}>
          {l("Hapus pencarian & filter", "Clear search & filters")}
        </button>
      ) : (
        createHref && (
          <Link className="button primary" href={createHref}>
            {createLabel ?? l("Buat baru", "Create new")}
          </Link>
        )
      )}
    </div>
  );
}
