import { describe, expect, it } from "vitest";
import {
  autoDepartment,
  currentStage,
  FLOW_DEFS,
  handoffItems,
  monotonicTimes,
  stageStatus,
  summarizeFlow,
  summarizeHandoffs,
  workItems,
  type FlowItem,
} from "./flow.js";

const o2c = FLOW_DEFS.o2c;
const sla = Object.fromEntries(o2c.stages.map((s) => [s.key, s.slaDays]));
const so = (id: string, times: FlowItem["times"], extra: Partial<FlowItem> = {}): FlowItem => ({
  id,
  model: "sale_order",
  name: id,
  times,
  value: 100,
  ...extra,
});
const items: FlowItem[] = [
  // Lunas: penawaran 1 Mar, pesanan 3 Mar, kirim 5 Mar, faktur 6 Mar, bayar 20 Mar → siklus 19 hari.
  so(
    "A",
    {
      quote: "2026-03-01",
      order: "2026-03-03T09:00:00Z",
      delivered: "2026-03-05T10:00:00Z",
      invoiced: "2026-03-06",
      paid: "2026-03-20",
    },
    { ownerId: "u1" },
  ),
  // Ditagih, jatuh tempo lewat.
  so(
    "B",
    { quote: "2026-03-02", order: "2026-03-02", delivered: "2026-03-04", invoiced: "2026-03-04" },
    { due: "2026-03-25", ownerId: "u1" },
  ),
  // Pesanan menunggu kirim sejak 28 Mar (SLA 3 hari), jadwal kirim besok → berisiko.
  so("C", { quote: "2026-03-27", order: "2026-03-28" }, { due: "2026-04-02", ownerId: "u2" }),
  // Penawaran baru.
  so("D", { quote: "2026-03-31" }, { ownerId: "u2", value: 50 }),
  // Dibayar di muka tapi belum dikirim → tetap di Pesanan.
  so(
    "E",
    { quote: "2026-03-10", order: "2026-03-10", invoiced: "2026-03-11", paid: "2026-03-12" },
    { ownerId: null },
  ),
];
const owners = new Map([
  ["u1", { name: "Sari", department: "Penjualan" }],
  ["u2", { name: "Budi", department: "Penjualan" }],
]);

describe("alur bisnis", () => {
  it("tahap sekarang = tahap terakhir yang tercapai berurutan", () => {
    expect(currentStage(o2c, items[0]!)).toBe("paid");
    expect(currentStage(o2c, items[4]!)).toBe("order");
    expect(currentStage(o2c, { times: {} })).toBeNull();
  });

  it("status SLA & batas dokumen", () => {
    expect(stageStatus("2026-03-28", "2026-04-01", 3)).toBe("late");
    expect(stageStatus("2026-03-30", "2026-04-01", 3)).toBe("on_time");
    expect(stageStatus("2026-03-29", "2026-04-01", 3, "2026-04-10")).toBe("on_time");
    expect(stageStatus("2026-03-29", "2026-04-01", 3)).toBe("at_risk");
    expect(stageStatus("2026-03-31", "2026-04-01", 30, "2026-03-31")).toBe("late");
    expect(stageStatus("2026-03-31", "2026-04-01", null, "2026-04-02")).toBe("at_risk");
  });

  it("ringkasan: WIP per tahap, kohort, lama tinggal, siklus, hambatan, pemilik", () => {
    const s = summarizeFlow(o2c, items, {
      today: "2026-04-01",
      from: "2026-03-01",
      to: "2026-03-31",
      sla,
      owners,
    });
    const by = Object.fromEntries(s.stages.map((x) => [x.key, x]));
    expect(by.quote).toMatchObject({ count: 1, value: 50, late: 0, reached: 5, reachedPct: 100 });
    expect(by.order).toMatchObject({ count: 2, late: 1, atRisk: 1, reached: 4, reachedPct: 80 });
    expect(by.invoiced).toMatchObject({ count: 1, late: 1 });
    expect(by.paid).toMatchObject({ count: 1, value: 100, reached: 2 });
    // Penawaran → pesanan: A 2 hari, B 0, C 1, E 0.
    expect(by.quote!.avgDays).toBe(0.8);
    expect(s.completed).toMatchObject({ count: 1, cycleMedian: 19, cycleP90: 19 });
    expect(s.wip).toEqual({ count: 4, value: 350, late: 2 });
    // Seri keterlambatan (pesanan & ditagih masing-masing 1) → lama tinggal terbesar: ditagih (7,5 hari).
    expect(by.invoiced!.avgDays).toBe(7.5);
    expect(s.bottleneck).toBe("invoiced");
    expect(s.owners[0]).toMatchObject({ owner: "Sari", count: 1, late: 1 });
    expect(s.departments).toEqual([
      { department: "Penjualan", count: 3, late: 1, value: 250 },
      { department: "—", count: 1, late: 1, value: 100 },
    ]);
  });

  it("daftar pekerjaan berisi umur, status, pemilik", () => {
    const w = workItems(o2c, items, { today: "2026-04-01", sla, owners });
    const c = w.find((x) => x.id === "C")!;
    expect(c).toMatchObject({
      stage: "order",
      ageDays: 4,
      status: "at_risk",
      owner: "Budi",
      department: "Penjualan",
    });
    expect(w.find((x) => x.id === "E")).toMatchObject({ stage: "order", status: "late", owner: null });
    expect(w.map((x) => x.id).sort()).toEqual(["B", "C", "D", "E"]);
  });

  it("definisi proses konsisten", () => {
    for (const def of Object.values(FLOW_DEFS)) {
      const keys = def.stages.map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(def.stages[def.stages.length - 1]!.slaDays).toBeNull();
      expect(def.stages.slice(0, -1).every((s) => s.slaDays !== null)).toBe(true);
      expect(keys).toContain(def.outputStage);
    }
  });
});

describe("tahap opsional", () => {
  it("PO tanpa persetujuan tetap maju; PO menunggu persetujuan ada di tahap persetujuan", () => {
    const p2p = FLOW_DEFS.p2p;
    expect(
      currentStage(p2p, { times: { rfq: "2026-03-01", ordered: "2026-03-02", received: "2026-03-05" } }),
    ).toBe("received");
    expect(currentStage(p2p, { times: { rfq: "2026-03-01", approval: "2026-03-02" } })).toBe("approval");
    expect(currentStage(p2p, { times: { rfq: "2026-03-01" } })).toBe("rfq");
  });
});

describe("waktu tahap tidak menurun", () => {
  it("waktu konfirmasi setelah pengiriman dipangkas ke waktu pengiriman", () => {
    expect(
      monotonicTimes(FLOW_DEFS.o2c, {
        quote: "2024-12-03",
        order: "2026-11-18T16:10:00Z",
        delivered: "2024-12-05T12:00:00Z",
        invoiced: "2024-12-05",
        paid: null,
      }),
    ).toEqual({
      quote: "2024-12-03",
      order: "2024-12-05",
      delivered: "2024-12-05",
      invoiced: "2024-12-05",
      paid: null,
    });
  });
});

describe("serah terima antar departemen", () => {
  const deps = [
    { id: "d-sales", name: "Penjualan & Pemasaran" },
    { id: "d-wh", name: "Gudang & Logistik" },
    { id: "d-fin", name: "Keuangan & Akuntansi" },
    { id: "d-hr", name: "SDM & Umum" },
    { id: "d-board", name: "Direksi" },
  ];

  it("mencocokkan departemen bawaan tahap dengan nama departemen perusahaan", () => {
    expect(autoDepartment(["Gudang", "Warehouse"], deps)).toBe("d-wh");
    expect(autoDepartment(["Keuangan", "Finance"], deps)).toBe("d-fin");
    expect(autoDepartment(["Manajemen", "Management"], deps)).toBe("d-board");
    expect(autoDepartment(["Payroll", "Payroll"], deps)).toBe("d-hr");
    // Kata harus diawali kata kunci: "hr" tidak cocok dengan "Christ".
    expect(autoDepartment(["SDM", "HR"], [{ id: "x", name: "Christmas Team" }])).toBeNull();
    expect(autoDepartment(["Pembelian", "Purchasing"], deps)).toBeNull();
  });

  it("dokumen menunggu di departemen tahap sekarang, diserahkan oleh departemen tahap sebelumnya", () => {
    const departments = {
      quote: "d-sales",
      order: "d-wh",
      delivered: "d-fin",
      invoiced: "d-fin",
      paid: null,
    };
    const list = handoffItems(o2c, items, { today: "2026-04-01", sla, departments, owners });
    const by = Object.fromEntries(list.map((h) => [h.id, h]));
    expect(Object.keys(by).sort()).toEqual(["B", "C", "D", "E"]);
    expect(by.C).toMatchObject({
      stage: "order",
      toDepartmentId: "d-wh",
      fromStage: "quote",
      fromDepartmentId: "d-sales",
      status: "at_risk",
    });
    // Penawaran: belum ada yang menyerahkan.
    expect(by.D).toMatchObject({ fromStage: null, fromDepartmentId: null, toDepartmentId: "d-sales" });
    // Ditagih: tahap sebelumnya "Terkirim" juga milik Keuangan (bukan serah terima antar departemen).
    expect(by.B).toMatchObject({ fromStage: "delivered", fromDepartmentId: "d-fin", status: "late" });

    const sum = summarizeHandoffs(list);
    const dep = Object.fromEntries(sum.departments.map((d) => [d.departmentId, d]));
    expect(dep["d-wh"]!.incoming).toMatchObject({ count: 2, late: 1 });
    expect(dep["d-sales"]!.outgoing).toMatchObject({ count: 2 });
    expect(dep["d-fin"]!.incoming).toMatchObject({ count: 1, late: 1 });
    // Hanya perpindahan antar departemen yang dihitung sebagai tautan.
    expect(sum.links).toEqual([expect.objectContaining({ from: "d-sales", to: "d-wh", count: 2, late: 1 })]);
  });
});
