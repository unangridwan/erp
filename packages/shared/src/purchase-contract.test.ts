import { describe, expect, it } from "vitest";
import {
  contractCommitmentValue,
  contractDisplayState,
  contractUsage,
  contractWarnings,
  purchaseContractSchema,
} from "./purchase-contract.js";

const lines = [
  {
    id: "a",
    productId: "pa",
    name: "Benih",
    quantity: "100",
    uomRatio: "1",
    priceUnit: "10000",
    discount: "0",
  },
  // Kontrak dalam lusin (rasio 12), dipesan dalam pcs.
  {
    id: "b",
    productId: "pb",
    name: "Pupuk",
    quantity: "10",
    uomRatio: "12",
    priceUnit: "120000",
    discount: "10",
  },
];
const contract = {
  name: "PK/2026/0001",
  state: "active",
  dateStart: "2026-01-01",
  dateEnd: "2026-12-31",
  valueLimit: "2000000",
};

describe("kontrak pembelian", () => {
  it("realisasi per baris memakai satuan produk", () => {
    const u = contractUsage(lines, [
      { contractLineId: "a", quantity: "30", uomRatio: "1", priceSubtotal: "300000" },
      { contractLineId: "b", quantity: "24", uomRatio: "1", priceSubtotal: "216000" },
    ]);
    expect(u.lines[0]).toMatchObject({ ordered: "30.0000", remaining: "70.0000", pct: 30 });
    expect(u.lines[1]).toMatchObject({ ordered: "2.0000", remaining: "8.0000", pct: 20 });
    expect(u.value).toBe("516000.00");
  });

  it("nilai komitmen memperhitungkan diskon", () => {
    expect(contractCommitmentValue(lines)).toBe("2080000.00");
  });

  it("tanpa peringatan bila dalam sisa, periode & plafon", () => {
    expect(
      contractWarnings({
        contract,
        lines,
        otherOrders: [{ contractLineId: "a", quantity: "50", uomRatio: "1", priceSubtotal: "500000" }],
        order: [{ contractLineId: "a", quantity: "50", uomRatio: "1", priceSubtotal: "500000" }],
        date: "2026-06-01",
      }),
    ).toEqual([]);
  });

  it("peringatan melebihi sisa, plafon, dan berakhir", () => {
    const w = contractWarnings({
      contract,
      lines,
      otherOrders: [{ contractLineId: "a", quantity: "90", uomRatio: "1", priceSubtotal: "900000" }],
      order: [
        { contractLineId: "a", quantity: "20", uomRatio: "1", priceSubtotal: "200000" },
        { contractLineId: "b", quantity: "10", uomRatio: "12", priceSubtotal: "1080000" },
      ],
      date: "2027-01-05",
    });
    expect(w.join(" | ")).toContain("berakhir 2026-12-31");
    expect(w.join(" | ")).toContain("Benih: dipesan 20, sisa kontrak 10");
    expect(w.join(" | ")).toContain("melebihi plafon");
    expect(w.some((x) => x.startsWith("Pupuk"))).toBe(false);
  });

  it("minimal pesan & status tampilan", () => {
    const w = contractWarnings({
      contract,
      lines: [{ ...lines[0]!, minOrderQty: "10" }],
      otherOrders: [],
      order: [{ contractLineId: "a", quantity: "5", uomRatio: "1", priceSubtotal: "50000" }],
      date: "2026-03-01",
    });
    expect(w).toEqual(["Benih: di bawah minimal pesan 10"]);
    expect(contractDisplayState("active", "2026-01-31", "2026-02-01")).toBe("expired");
    expect(contractDisplayState("closed", "2026-01-31", "2026-02-01")).toBe("closed");
  });

  it("skema menolak produk ganda & tanggal terbalik", () => {
    const r = purchaseContractSchema.safeParse({
      partnerId: "00000000-0000-4000-8000-000000000001",
      dateStart: "2026-02-01",
      dateEnd: "2026-01-01",
      lines: [
        { productId: "00000000-0000-4000-8000-000000000002", quantity: "1", priceUnit: "1" },
        { productId: "00000000-0000-4000-8000-000000000002", quantity: "1", priceUnit: "1" },
      ],
    });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toContain("dateEnd");
    expect(paths).toContain("lines.1.productId");
  });
});
