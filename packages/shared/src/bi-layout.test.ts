import { describe, expect, it } from "vitest";
import { canvasRows, collides, compact, moveItem, placeNew, resizeItem } from "./bi-layout.js";

const item = (id: string, x: number, y: number, w: number, h: number) => ({ id, layout: { x, y, w, h } });
const pos = (items: { id: string; layout: { x: number; y: number; w: number; h: number } }[]) =>
  Object.fromEntries(items.map((i) => [i.id, [i.layout.x, i.layout.y, i.layout.w, i.layout.h]]));

describe("tata letak kanvas", () => {
  it("memadatkan ke atas tanpa tumpang tindih", () => {
    expect(collides({ x: 0, y: 0, w: 6, h: 3 }, { x: 5, y: 2, w: 3, h: 3 })).toBe(true);
    expect(collides({ x: 0, y: 0, w: 6, h: 3 }, { x: 6, y: 0, w: 3, h: 3 })).toBe(false);
    const out = compact([item("a", 0, 5, 6, 3), item("b", 6, 9, 6, 3), item("c", 0, 20, 12, 2)]);
    expect(pos(out)).toEqual({ a: [0, 0, 6, 3], b: [6, 0, 6, 3], c: [0, 3, 12, 2] });
  });

  it("memindah visual mendorong yang tertimpa ke bawah", () => {
    const items = [item("a", 0, 0, 6, 3), item("b", 6, 0, 6, 3), item("c", 0, 3, 12, 4)];
    // c dipindah ke atas: a & b turun di bawahnya.
    expect(pos(moveItem(items, "c", 0, 0))).toEqual({ a: [0, 4, 6, 3], b: [6, 4, 6, 3], c: [0, 0, 12, 4] });
    // b dipindah ke kiri (tumpang a): a turun.
    expect(pos(moveItem(items, "b", 0, 0))).toEqual({ a: [0, 3, 6, 3], b: [0, 0, 6, 3], c: [0, 6, 12, 4] });
    // Posisi di luar grid dijepit.
    expect(pos(moveItem(items, "a", 11, -3)).a).toEqual([6, 0, 6, 3]);
  });

  it("ubah ukuran dibatasi grid dan mendorong visual di bawahnya", () => {
    const items = [item("a", 0, 0, 6, 3), item("b", 0, 3, 6, 3)];
    expect(pos(resizeItem(items, "a", 20, 5))).toEqual({ a: [0, 0, 12, 5], b: [0, 5, 6, 3] });
    expect(pos(resizeItem([item("a", 8, 0, 4, 3)], "a", 10, 0))).toEqual({ a: [8, 0, 4, 1] });
  });

  it("visual baru mengisi celah pertama yang muat", () => {
    const items = [item("a", 0, 0, 6, 3), item("b", 0, 3, 12, 3)];
    expect(placeNew(items, 6, 3)).toEqual({ x: 6, y: 0, w: 6, h: 3 });
    expect(placeNew(items, 12, 2)).toEqual({ x: 0, y: 6, w: 12, h: 2 });
    expect(placeNew([], 4, 3)).toEqual({ x: 0, y: 0, w: 4, h: 3 });
    expect(canvasRows(items)).toBe(6);
  });
});
