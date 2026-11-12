import { describe, expect, it } from "vitest";
import { creditStatus, DEFAULT_DUNNING_LEVELS, dunningDue, renderDunningText } from "./credit-control.js";

describe("creditStatus", () => {
  it("menjumlahkan paparan dan menandai batas terlampaui", () => {
    const s = creditStatus({
      limit: "10000000",
      receivable: "6000000",
      uninvoicedOrders: "2000000",
      draftInvoices: "500000",
      orderAmount: "2000000",
      oldestOverdueDays: 0,
    });
    expect(s.exposure).toBe("10500000.00");
    expect(s.available).toBe("-500000.00");
    expect(s.exceeded).toBe(true);
    expect(s.usedPercent).toBe(105);
  });
  it("tanpa batas tidak pernah terlampaui; tunggakan dibandingkan dengan batas hari", () => {
    const s = creditStatus({
      limit: null,
      receivable: "1",
      uninvoicedOrders: 0,
      draftInvoices: 0,
      oldestOverdueDays: 45,
      warnDays: 30,
    });
    expect(s.exceeded).toBe(false);
    expect(s.limit).toBeNull();
    expect(s.overdueWarning).toBe(true);
    expect(
      creditStatus({
        receivable: 0,
        uninvoicedOrders: 0,
        draftInvoices: 0,
        oldestOverdueDays: 30,
        warnDays: 30,
      }).overdueWarning,
    ).toBe(false);
  });
});

describe("dunningDue", () => {
  const levels = DEFAULT_DUNNING_LEVELS.map((l) => ({ ...l }));
  const inv = (moveId: string, partnerId: string, dueDate: string, residual: string, dunningLevel = 0) => ({
    moveId,
    partnerId,
    name: moveId,
    date: dueDate,
    dueDate,
    amountTotal: residual,
    residual,
    dunningLevel,
  });

  it("memilih tingkat tertinggi yang dicapai dan mencantumkan semua faktur lewat jatuh tempo", () => {
    const due = dunningDue(
      [
        inv("A1", "p1", "2026-09-01", "1000"), // 71 hari → tingkat 3
        inv("A2", "p1", "2026-11-05", "500"), // 6 hari → belum tingkat apa pun
        inv("B1", "p2", "2026-11-20", "700"), // belum jatuh tempo
      ],
      levels,
      "2026-11-11",
    );
    expect(due).toHaveLength(1);
    expect(due[0]!.level.sequence).toBe(3);
    expect(due[0]!.invoices.map((i) => i.moveId)).toEqual(["A1", "A2"]);
    expect(due[0]!.totalOverdue).toBe("1500.00");
  });

  it("tidak mengirim ulang tingkat yang sama; naik saat mencapai tingkat berikut", () => {
    expect(dunningDue([inv("A1", "p1", "2026-11-01", "1000", 1)], levels, "2026-11-11")).toEqual([]);
    const next = dunningDue([inv("A1", "p1", "2026-10-01", "1000", 1)], levels, "2026-11-11");
    expect(next[0]!.level.sequence).toBe(2);
  });

  it("melewati faktur lunas, tingkat nonaktif, dan total di bawah minimum", () => {
    expect(dunningDue([inv("A1", "p1", "2026-09-01", "0")], levels, "2026-11-11")).toEqual([]);
    expect(dunningDue([inv("A1", "p1", "2026-09-01", "100")], levels, "2026-11-11", "500")).toEqual([]);
    const onlyFirst = dunningDue(
      [inv("A1", "p1", "2026-09-01", "100")],
      levels.map((l) => ({ ...l, active: l.sequence === 1 })),
      "2026-11-11",
    );
    expect(onlyFirst[0]!.level.sequence).toBe(1);
  });
});

describe("renderDunningText", () => {
  it("mengisi placeholder yang dikenal", () => {
    expect(
      renderDunningText("Yth. {pelanggan}, total {total} {x}", { pelanggan: "CV A", total: "Rp 1" }),
    ).toBe("Yth. CV A, total Rp 1 {x}");
  });
});
