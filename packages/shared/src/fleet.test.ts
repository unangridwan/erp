import { describe, expect, it } from "vitest";
import {
  contractCostEvents,
  fleetReminders,
  groupFleetCosts,
  isValidPlate,
  normalizePlate,
} from "./fleet.js";

describe("contractCostEvents", () => {
  it("biaya awal + bulanan sampai tanggal berakhir, hanya dalam rentang", () => {
    const ev = contractCostEvents(
      {
        startDate: "2026-01-31",
        endDate: "2026-04-15",
        initialCost: 1_000_000,
        recurringCost: "500000",
        recurringInterval: "monthly",
      },
      "2026-01-01",
      "2026-12-31",
    );
    expect(ev.map((e) => [e.date, e.kind])).toEqual([
      ["2026-01-31", "initial"],
      ["2026-01-31", "recurring"],
      ["2026-02-28", "recurring"], // dibatasi akhir bulan
      ["2026-03-31", "recurring"],
    ]);
    const march = contractCostEvents(
      {
        startDate: "2026-01-31",
        endDate: null,
        initialCost: 1_000_000,
        recurringCost: 500000,
        recurringInterval: "monthly",
      },
      "2026-03-01",
      "2026-03-31",
    );
    expect(march).toEqual([{ date: "2026-03-31", amount: 500000, kind: "recurring" }]);
  });

  it("tahunan, mingguan, tanpa biaya berulang", () => {
    const base = { startDate: "2026-01-01", endDate: null, initialCost: 0 };
    expect(
      contractCostEvents(
        { ...base, recurringCost: 10, recurringInterval: "yearly" },
        "2026-01-01",
        "2028-06-30",
      ),
    ).toHaveLength(3);
    expect(
      contractCostEvents(
        { ...base, recurringCost: 10, recurringInterval: "weekly" },
        "2026-01-01",
        "2026-01-31",
      ),
    ).toHaveLength(5);
    expect(
      contractCostEvents(
        { ...base, recurringCost: 10, recurringInterval: "none" },
        "2026-01-01",
        "2026-12-31",
      ),
    ).toEqual([]);
  });
});

describe("groupFleetCosts", () => {
  const rows = [
    {
      vehicleId: "a",
      vehicle: "B 1 A",
      category: "car",
      date: "2026-01-05",
      amount: 100,
      source: "contract" as const,
    },
    {
      vehicleId: "a",
      vehicle: "B 1 A",
      category: "car",
      date: "2026-02-05",
      amount: 50.5,
      source: "service" as const,
    },
    {
      vehicleId: "b",
      vehicle: "B 2 B",
      category: "truck",
      date: "2026-01-09",
      amount: 300,
      source: "service" as const,
    },
  ];
  it("per kendaraan (terbesar dulu), per bulan (kronologis)", () => {
    const v = groupFleetCosts(rows, "vehicle");
    expect(v.groups.map((g) => [g.label, g.contract, g.service, g.total])).toEqual([
      ["B 2 B", 0, 300, 300],
      ["B 1 A", 100, 50.5, 150.5],
    ]);
    expect(v.total).toBe(450.5);
    expect(groupFleetCosts(rows, "month").groups.map((g) => [g.key, g.total])).toEqual([
      ["2026-01", 400],
      ["2026-02", 50.5],
    ]);
  });
});

describe("fleetReminders", () => {
  it("dokumen & kontrak ≤ N hari (termasuk yang sudah lewat); hari pengingat kontrak sendiri", () => {
    const r = fleetReminders(
      {
        vehicles: [
          {
            id: "v",
            licensePlate: "B 1 A",
            stnkExpiry: "2026-11-10",
            taxDueDate: "2027-06-01",
            kirExpiry: "2026-10-01",
          },
        ],
        contracts: [
          {
            id: "c1",
            vehicleId: "v",
            licensePlate: "B 1 A",
            name: "Asuransi",
            endDate: "2026-12-20",
            reminderDays: 60,
          },
          {
            id: "c2",
            vehicleId: "v",
            licensePlate: "B 1 A",
            name: "Sewa",
            endDate: "2026-12-20",
            reminderDays: null,
          },
        ],
      },
      "2026-10-26",
      30,
    );
    expect(r.map((x) => [x.kind, x.daysLeft])).toEqual([
      ["kir", -25],
      ["stnk", 15],
      ["contract", 55],
    ]);
  });
});

describe("nomor polisi", () => {
  it("dirapikan & divalidasi", () => {
    expect(normalizePlate("b1234xyz")).toBe("B 1234 XYZ");
    expect(normalizePlate(" d  12 ab ")).toBe("D 12 AB");
    expect(normalizePlate("RI 1")).toBe("RI 1");
    expect(isValidPlate("B 1234 XYZ")).toBe(true);
    expect(isValidPlate("1234")).toBe(false);
  });
});
