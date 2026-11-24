import { CANVAS_COLUMNS, type BiLayout } from "./bi.js";

/**
 * Tata letak kanvas dashboard (grid 12 kolom): pindah, ubah ukuran, dan penempatan visual baru dengan pemadatan
 * vertikal — visual lain terdorong ke bawah bila tertimpa, lalu semua naik mengisi celah.
 */

export interface LayoutItem {
  id: string;
  layout: BiLayout;
}

export const collides = (a: BiLayout, b: BiLayout) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const clampLayout = (l: BiLayout): BiLayout => {
  const w = Math.min(CANVAS_COLUMNS, Math.max(1, Math.round(l.w)));
  return {
    w,
    h: Math.min(60, Math.max(1, Math.round(l.h))),
    x: Math.min(CANVAS_COLUMNS - w, Math.max(0, Math.round(l.x))),
    y: Math.max(0, Math.round(l.y)),
  };
};

const byPosition = (a: LayoutItem, b: LayoutItem) => a.layout.y - b.layout.y || a.layout.x - b.layout.x;

/** Naikkan tiap visual setinggi mungkin tanpa bertumpuk (urut atas → bawah, kiri → kanan). */
export function compact<T extends LayoutItem>(items: T[]): T[] {
  const placed: BiLayout[] = [];
  const out = new Map<string, BiLayout>();
  for (const item of [...items].sort(byPosition)) {
    const l = { ...clampLayout(item.layout) };
    while (l.y > 0 && !placed.some((p) => collides({ ...l, y: l.y - 1 }, p))) l.y--;
    while (placed.some((p) => collides(l, p))) l.y++;
    placed.push(l);
    out.set(item.id, l);
  }
  return items.map((i) => ({ ...i, layout: out.get(i.id)! }));
}

/** Tempatkan `first` di posisinya, dorong visual lain yang tertimpa ke bawah, lalu padatkan. */
function settle<T extends LayoutItem>(items: T[], first: T): T[] {
  const placed: { id: string; l: BiLayout }[] = [{ id: first.id, l: first.layout }];
  for (const item of items.filter((i) => i.id !== first.id).sort(byPosition)) {
    const l = { ...item.layout };
    for (;;) {
      const hit = placed.find((p) => collides(l, p.l));
      if (!hit) break;
      l.y = hit.l.y + hit.l.h;
    }
    placed.push({ id: item.id, l });
  }
  const map = new Map(placed.map((p) => [p.id, p.l]));
  return compact(items.map((i) => ({ ...i, layout: map.get(i.id)! })));
}

/** Pindahkan visual ke kolom/baris tertentu. */
export function moveItem<T extends LayoutItem>(items: T[], id: string, x: number, y: number): T[] {
  const item = items.find((i) => i.id === id);
  if (!item) return items;
  const moved = { ...item, layout: clampLayout({ ...item.layout, x, y }) };
  return settle(
    items.map((i) => (i.id === id ? moved : i)),
    moved,
  );
}

/** Ubah ukuran visual (lebar dibatasi sisa kolom di kanannya). */
export function resizeItem<T extends LayoutItem>(items: T[], id: string, w: number, h: number): T[] {
  const item = items.find((i) => i.id === id);
  if (!item) return items;
  const width = Math.min(Math.max(1, Math.round(w)), CANVAS_COLUMNS - item.layout.x);
  const resized = { ...item, layout: clampLayout({ ...item.layout, w: width, h }) };
  return settle(
    items.map((i) => (i.id === id ? resized : i)),
    resized,
  );
}

/** Posisi pertama (atas → bawah, kiri → kanan) yang muat untuk visual baru berukuran w×h. */
export function placeNew(items: LayoutItem[], w: number, h: number): BiLayout {
  const width = Math.min(CANVAS_COLUMNS, Math.max(1, w));
  const bottom = items.reduce((m, i) => Math.max(m, i.layout.y + i.layout.h), 0);
  for (let y = 0; y <= bottom; y++)
    for (let x = 0; x + width <= CANVAS_COLUMNS; x++) {
      const l = { x, y, w: width, h };
      if (!items.some((i) => collides(l, i.layout))) return l;
    }
  return { x: 0, y: bottom, w: width, h };
}

/** Tinggi kanvas dalam baris grid. */
export const canvasRows = (items: LayoutItem[]) =>
  items.reduce((m, i) => Math.max(m, i.layout.y + i.layout.h), 0);
