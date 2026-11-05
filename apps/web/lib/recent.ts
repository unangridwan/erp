"use client";

import { useSyncExternalStore } from "react";

/** Data/halaman yang terakhir dibuka & favorit pengguna (disimpan di browser ini). */
export interface RecentItem {
  href: string;
  title: string;
  /** Jenis data (mis. "Karyawan") atau nama aplikasi. */
  kind?: string;
  at?: number;
}

const RECENT = "erp.recent";
const FAVORITES = "erp.favorites";
const listeners = new Set<() => void>();
const cache: Record<string, RecentItem[]> = {};

function read(key: string): RecentItem[] {
  if (cache[key]) return cache[key]!;
  try {
    cache[key] = JSON.parse(localStorage.getItem(key) ?? "[]") as RecentItem[];
  } catch {
    cache[key] = [];
  }
  return cache[key]!;
}
function write(key: string, items: RecentItem[]) {
  cache[key] = items;
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Penyimpanan diblokir (mode privat): tetap berlaku selama sesi.
  }
  listeners.forEach((l) => l());
}

export function rememberRecent(item: RecentItem) {
  const items = read(RECENT).filter((i) => i.href !== item.href);
  write(RECENT, [{ ...item, at: Date.now() }, ...items].slice(0, 12));
}
export function isFavorite(href: string) {
  return read(FAVORITES).some((i) => i.href === href);
}
export function toggleFavorite(item: RecentItem) {
  const items = read(FAVORITES);
  write(
    FAVORITES,
    items.some((i) => i.href === item.href)
      ? items.filter((i) => i.href !== item.href)
      : [...items, { ...item, at: Date.now() }].slice(-30),
  );
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === RECENT || e.key === FAVORITES) {
      delete cache[e.key];
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
};
const EMPTY: RecentItem[] = [];

export function useRecent() {
  return useSyncExternalStore(
    subscribe,
    () => read(RECENT),
    () => EMPTY,
  );
}
export function useFavorites() {
  return useSyncExternalStore(
    subscribe,
    () => read(FAVORITES),
    () => EMPTY,
  );
}
