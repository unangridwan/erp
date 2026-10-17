import { describe, expect, it } from "vitest";
import { defaultConsolidationMethod, effectiveOwnership } from "./group.js";

describe("effectiveOwnership", () => {
  it("menghitung kepemilikan bertingkat", () => {
    const links = [
      { parentId: "H", childId: "A", pct: 80 },
      { parentId: "A", childId: "B", pct: 60 },
    ];
    expect(effectiveOwnership(links, "H", "B").toNumber()).toBe(48);
  });

  it("menjumlahkan kepemilikan langsung dan tidak langsung", () => {
    const links = [
      { parentId: "H", childId: "A", pct: 100 },
      { parentId: "H", childId: "C", pct: 10 },
      { parentId: "A", childId: "C", pct: 25 },
    ];
    expect(effectiveOwnership(links, "H", "C").toNumber()).toBe(35);
  });

  it("menolak siklus kepemilikan", () => {
    const links = [
      { parentId: "A", childId: "B", pct: 50 },
      { parentId: "B", childId: "A", pct: 50 },
    ];
    expect(() => effectiveOwnership(links, "A", "Z")).toThrow(/Siklus/);
  });
});

describe("defaultConsolidationMethod", () => {
  it("memetakan persentase ke metode", () => {
    expect(defaultConsolidationMethod(80)).toBe("full");
    expect(defaultConsolidationMethod(30)).toBe("equity");
    expect(defaultConsolidationMethod(10)).toBe("none");
  });
});
