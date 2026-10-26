/** Logika murni armada: biaya kontrak berulang, ringkasan biaya kendaraan, dokumen/kontrak yang akan kedaluwarsa. */

export const FLEET_INTERVALS = ["none", "daily", "weekly", "monthly", "yearly"] as const;
export type FleetInterval = (typeof FLEET_INTERVALS)[number];

const round2 = (x: number) => Math.round(x * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (d: string) => new Date(`${d}T00:00:00Z`);

/** Tanggal awal periode ke-k sebuah kontrak berulang (bulanan/tahunan mengikuti tanggal mulai, dibatasi akhir bulan). */
function periodStart(start: string, interval: FleetInterval, k: number) {
  const s = parse(start);
  if (interval === "daily") return iso(new Date(s.getTime() + k * 86_400_000));
  if (interval === "weekly") return iso(new Date(s.getTime() + k * 7 * 86_400_000));
  const months = interval === "monthly" ? k : k * 12;
  const y = s.getUTCFullYear();
  const m = s.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m, Math.min(s.getUTCDate(), last))));
}

export interface ContractCostInput {
  startDate: string;
  endDate: string | null;
  initialCost: number | string;
  recurringCost: number | string;
  recurringInterval: FleetInterval;
}

/**
 * Kejadian biaya sebuah kontrak dalam rentang [from, to]: biaya awal pada tanggal mulai, lalu biaya berulang pada awal
 * setiap periode sampai tanggal berakhir (tanpa tanggal berakhir = sampai `to`).
 */
export function contractCostEvents(c: ContractCostInput, from: string, to: string) {
  const out: { date: string; amount: number; kind: "initial" | "recurring" }[] = [];
  const initial = Number(c.initialCost);
  if (initial && c.startDate >= from && c.startDate <= to)
    out.push({ date: c.startDate, amount: round2(initial), kind: "initial" });
  const recurring = Number(c.recurringCost);
  if (!recurring || c.recurringInterval === "none") return out;
  const until = c.endDate && c.endDate < to ? c.endDate : to;
  for (let k = 0; k < 100_000; k++) {
    const d = periodStart(c.startDate, c.recurringInterval, k);
    if (d > until) break;
    if (d >= from) out.push({ date: d, amount: round2(recurring), kind: "recurring" });
  }
  return out;
}

export interface CostRow {
  vehicleId: string;
  vehicle: string;
  category: string;
  date: string;
  amount: number;
  source: "contract" | "service";
}

/** Ringkasan biaya per kendaraan / kategori / bulan, dipecah kontrak vs servis; diurutkan dari total terbesar (bulan: kronologis). */
export function groupFleetCosts(rows: CostRow[], groupBy: "vehicle" | "category" | "month") {
  const map = new Map<
    string,
    { key: string; label: string; contract: number; service: number; total: number }
  >();
  for (const r of rows) {
    const key =
      groupBy === "vehicle" ? r.vehicleId : groupBy === "category" ? r.category : r.date.slice(0, 7);
    const label = groupBy === "vehicle" ? r.vehicle : key;
    const g = map.get(key) ?? { key, label, contract: 0, service: 0, total: 0 };
    g[r.source] = round2(g[r.source] + r.amount);
    g.total = round2(g.contract + g.service);
    map.set(key, g);
  }
  const groups = [...map.values()];
  groups.sort((a, b) => (groupBy === "month" ? a.key.localeCompare(b.key) : b.total - a.total));
  const total = round2(groups.reduce((s, g) => s + g.total, 0));
  return { groups, total };
}

export type FleetReminderKind = "stnk" | "tax" | "kir" | "contract";

/** Dokumen kendaraan (STNK, pajak tahunan, KIR) dan kontrak berjalan yang kedaluwarsa dalam `days` hari (atau sudah lewat). */
export function fleetReminders(
  input: {
    vehicles: {
      id: string;
      licensePlate: string;
      stnkExpiry: string | null;
      taxDueDate: string | null;
      kirExpiry: string | null;
    }[];
    contracts: {
      id: string;
      vehicleId: string;
      licensePlate: string;
      name: string;
      endDate: string | null;
      reminderDays: number | null;
    }[];
  },
  today: string,
  days: number,
) {
  const out: {
    kind: FleetReminderKind;
    id: string;
    vehicleId: string;
    licensePlate: string;
    name: string;
    date: string;
    daysLeft: number;
  }[] = [];
  const left = (d: string) => Math.round((parse(d).getTime() - parse(today).getTime()) / 86_400_000);
  const docs: [FleetReminderKind, "stnkExpiry" | "taxDueDate" | "kirExpiry", string][] = [
    ["stnk", "stnkExpiry", "STNK"],
    ["tax", "taxDueDate", "Pajak tahunan"],
    ["kir", "kirExpiry", "KIR"],
  ];
  for (const v of input.vehicles)
    for (const [kind, field, name] of docs) {
      const d = v[field];
      if (d && left(d) <= days)
        out.push({
          kind,
          id: v.id,
          vehicleId: v.id,
          licensePlate: v.licensePlate,
          name,
          date: d,
          daysLeft: left(d),
        });
    }
  for (const c of input.contracts)
    if (c.endDate && left(c.endDate) <= (c.reminderDays ?? days))
      out.push({
        kind: "contract",
        id: c.id,
        vehicleId: c.vehicleId,
        licensePlate: c.licensePlate,
        name: c.name,
        date: c.endDate,
        daysLeft: left(c.endDate),
      });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.licensePlate.localeCompare(b.licensePlate));
}

/** Nomor polisi dirapikan: huruf besar, satu spasi antar bagian ("b1234xyz" → "B 1234 XYZ"). */
export function normalizePlate(raw: string) {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = /^([A-Z]{1,2})(\d{1,4})([A-Z]{0,3})$/.exec(compact);
  if (!m) return raw.trim().toUpperCase().replace(/\s+/g, " ");
  return [m[1], m[2], m[3]].filter(Boolean).join(" ");
}

export const isValidPlate = (plate: string) => /^[A-Z]{1,2} \d{1,4}( [A-Z]{1,3})?$/.test(plate);
