import { and, eq, gte, inArray, lte, ne, schema, type Db } from "@erp/db";
import { contractCostEvents, type CostRow } from "@erp/shared";

const V = schema.fleetVehicles;
const M = schema.fleetModels;
const C = schema.fleetContracts;
const S = schema.fleetServices;

/** Baris biaya armada beserta dokumen asalnya (kontrak atau servis). */
export type FleetCostRow = CostRow & { refModel: "fleet_contract" | "fleet_service"; refId: string };

/**
 * Biaya kendaraan dalam rentang tanggal: kejadian biaya kontrak (awal & berkala) + servis yang tidak batal. Dipakai
 * laporan biaya armada dan dataset BI `fleet_costs`, sehingga rincian drilldown sama dengan angka laporan.
 */
export async function fleetCostRows(
  tx: Db,
  companyId: string,
  from: string,
  to: string,
  vehicleId?: string,
): Promise<FleetCostRow[]> {
  const vehicles = await tx
    .select({ id: V.id, plate: V.licensePlate, model: M.name, category: M.category })
    .from(V)
    .innerJoin(M, eq(M.id, V.modelId))
    .where(and(eq(V.companyId, companyId), vehicleId ? eq(V.id, vehicleId) : undefined));
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const ids = vehicles.map((v) => v.id);
  if (!ids.length) return [];
  const rows: FleetCostRow[] = [];
  const push = (
    vid: string,
    date: string,
    amount: number,
    source: CostRow["source"],
    ref: Pick<FleetCostRow, "refModel" | "refId">,
  ) => {
    const v = byId.get(vid)!;
    rows.push({
      vehicleId: vid,
      vehicle: `${v.plate} · ${v.model}`,
      category: v.category,
      date,
      amount,
      source,
      ...ref,
    });
  };
  const contracts = await tx
    .select()
    .from(C)
    .where(and(inArray(C.vehicleId, ids), ne(C.state, "new"), lte(C.startDate, to)));
  for (const c of contracts)
    for (const e of contractCostEvents(c, from, to))
      push(c.vehicleId, e.date, e.amount, "contract", { refModel: "fleet_contract", refId: c.id });
  const services = await tx
    .select({ id: S.id, vehicleId: S.vehicleId, date: S.date, cost: S.cost })
    .from(S)
    .where(and(inArray(S.vehicleId, ids), ne(S.state, "cancelled"), gte(S.date, from), lte(S.date, to)));
  for (const s of services)
    if (Number(s.cost))
      push(s.vehicleId, s.date, Number(s.cost), "service", { refModel: "fleet_service", refId: s.id });
  return rows;
}
