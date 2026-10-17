import { describe, expect, it } from "vitest";
import { averageAfterIn, fifoConsume, pickSupplier, reorderQuantity } from "./inventory.js";

describe("averageAfterIn", () => {
  it("rata-rata tertimbang", () => {
    expect(averageAfterIn(10, 100, 10, 130)).toBe("115.0000");
    expect(averageAfterIn(3, "1000", 1, "2000")).toBe("1250.0000");
  });
  it("stok kosong memakai biaya masuk", () => {
    expect(averageAfterIn(0, 999, 5, 120)).toBe("120.0000");
  });
});

describe("fifoConsume", () => {
  const layers = [
    { id: "a", remainingQty: 3, remainingValue: "100.00" },
    { id: "b", remainingQty: 5, remainingValue: "650.00" },
  ];
  it("mengambil lapisan tertua lebih dulu, sisa nilai persis", () => {
    const r = fifoConsume(layers, 4);
    expect(r.takes).toEqual([
      { id: "a", qty: "3.0000", value: "100.00" },
      { id: "b", qty: "1.0000", value: "130.00" },
    ]);
    expect(r.value).toBe("230.00");
    expect(r.shortfall).toBe("0.0000");
  });
  it("melaporkan kekurangan", () => {
    expect(fifoConsume(layers, 10).shortfall).toBe("2.0000");
  });
});

describe("reorderQuantity", () => {
  it("pesan hingga maksimum, dibulatkan ke kelipatan", () => {
    expect(reorderQuantity({ forecast: 3, minQty: 5, maxQty: 20, qtyMultiple: 12 })).toBe("24.0000");
    expect(reorderQuantity({ forecast: -2, minQty: 5, maxQty: 10, qtyMultiple: 1 })).toBe("12.0000");
  });
  it("tidak memesan bila di atas minimum", () => {
    expect(reorderQuantity({ forecast: 5, minQty: 5, maxQty: 10, qtyMultiple: 1 })).toBe("0.0000");
  });
});

describe("pickSupplier", () => {
  const suppliers = [
    { id: "s1", partnerId: "p1", minQty: 0, price: 100, currencyCode: "IDR", sequence: 1, delayDays: 3 },
    { id: "s2", partnerId: "p1", minQty: 10, price: 90, currencyCode: "IDR", sequence: 1, delayDays: 3 },
    { id: "s3", partnerId: "p2", minQty: 0, price: 95, currencyCode: "IDR", sequence: 2, delayDays: 7 },
  ];
  it("harga bertingkat untuk pemasok tertentu", () => {
    expect(pickSupplier(suppliers, 12, "p1")?.id).toBe("s2");
    expect(pickSupplier(suppliers, 5, "p1")?.id).toBe("s1");
    expect(pickSupplier(suppliers, 5, "p3")).toBeUndefined();
  });
  it("tanpa pemasok: pemasok utama (urutan terkecil)", () => {
    expect(pickSupplier(suppliers, 1)?.partnerId).toBe("p1");
  });
});
