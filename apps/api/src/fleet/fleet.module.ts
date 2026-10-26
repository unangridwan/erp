import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  schema,
  sql,
  type Db,
} from "@erp/db";
import {
  contractCostEvents,
  fleetContractSchema,
  fleetManufacturerSchema,
  fleetModelSchema,
  fleetOdometerSchema,
  fleetReminders,
  fleetServiceSchema,
  fleetServiceTypeSchema,
  fleetSettingsSchema,
  fleetVehicleSchema,
  groupFleetCosts,
  hasPermission,
  type CostRow,
} from "@erp/shared";
import { z } from "zod";
import { AccountingModule } from "../accounting/accounting.module.js";
import { ActivityService } from "../activity/activity.service.js";
import { assertCompanyAccounts, fieldError } from "../accounting/context.js";
import { MoveService } from "../accounting/move.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { reportError } from "../common/error-reporting.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { CONFIG, type AppConfig } from "../config.js";

const V = schema.fleetVehicles;
const M = schema.fleetModels;
const MF = schema.fleetManufacturers;
const ST = schema.fleetServiceTypes;
const C = schema.fleetContracts;
const S = schema.fleetServices;
const O = schema.fleetOdometers;
const DA = schema.fleetDriverAssignments;
const E = schema.employees;
const today = () => new Date().toISOString().slice(0, 10);

type Vehicle = typeof V.$inferSelect;

const DEFAULT_SERVICE_TYPES: [string, "contract" | "service" | "both"][] = [
  ["Sewa / leasing", "contract"],
  ["Asuransi", "contract"],
  ["Servis berkala", "service"],
  ["Ganti oli", "service"],
  ["Ban", "service"],
  ["Perbaikan", "service"],
  ["Perpanjangan STNK", "both"],
  ["Pajak tahunan", "both"],
  ["Uji KIR", "both"],
  ["BBM", "service"],
];

/** Jenis layanan bawaan bila perusahaan belum punya sama sekali. */
async function ensureServiceTypes(tx: Db, companyId: string) {
  const [any] = await tx.select({ id: ST.id }).from(ST).where(eq(ST.companyId, companyId)).limit(1);
  if (any) return;
  await tx
    .insert(ST)
    .values(DEFAULT_SERVICE_TYPES.map(([name, category]) => ({ companyId, name, category })));
}

async function sameCompanyVehicle(tx: Db, vehicleId: unknown, companyId: unknown) {
  if (typeof vehicleId !== "string") return;
  const [v] = await tx.select({ companyId: V.companyId }).from(V).where(eq(V.id, vehicleId));
  if (!v || v.companyId !== companyId)
    throw fieldError("vehicleId", "Kendaraan tidak ditemukan di perusahaan ini");
}

async function sameCompanyServiceType(tx: Db, serviceTypeId: unknown, companyId: unknown) {
  if (typeof serviceTypeId !== "string") return;
  const [t] = await tx.select({ companyId: ST.companyId }).from(ST).where(eq(ST.id, serviceTypeId));
  if (!t || t.companyId !== companyId)
    throw fieldError("serviceTypeId", "Jenis layanan tidak ditemukan di perusahaan ini");
}

async function findVehicle(tx: Db, id: string) {
  const [v] = await tx.select().from(V).where(eq(V.id, id));
  if (!v || !currentContext().companyIds.includes(v.companyId))
    throw new NotFoundException("Kendaraan tidak ditemukan");
  return v;
}

/** Ganti pengemudi: tutup penugasan terbuka, buka penugasan baru (satu pengemudi aktif per kendaraan). */
async function syncDriver(tx: Db, vehicleId: string, employeeId: string | null, date = today()) {
  const [open] = await tx
    .select()
    .from(DA)
    .where(and(eq(DA.vehicleId, vehicleId), isNull(DA.endDate)));
  if (open?.employeeId === employeeId) return;
  if (open)
    await tx
      .update(DA)
      .set({ endDate: open.startDate > date ? open.startDate : date })
      .where(eq(DA.id, open.id));
  if (employeeId)
    await tx
      .insert(DA)
      .values({ vehicleId, employeeId, startDate: date, createdBy: currentContext().userId });
}

/** Catat odometer; nilai harus di antara pembacaan sebelum dan sesudah tanggal tersebut. */
async function addOdometer(
  tx: Db,
  vehicle: Vehicle,
  input: { date: string; value: number; note?: string | null },
  driverEmployeeId: string | null,
  path = "value",
) {
  const [prev] = await tx
    .select({ value: sql<string>`max(${O.value})` })
    .from(O)
    .where(and(eq(O.vehicleId, vehicle.id), lte(O.date, input.date)));
  const [next] = await tx
    .select({ value: sql<string>`min(${O.value})` })
    .from(O)
    .where(and(eq(O.vehicleId, vehicle.id), gt(O.date, input.date)));
  if (prev?.value != null && input.value < Number(prev.value))
    throw fieldError(
      path,
      `Odometer tidak boleh lebih kecil dari pembacaan sebelumnya (${Number(prev.value)})`,
    );
  if (next?.value != null && input.value > Number(next.value))
    throw fieldError(path, `Odometer melebihi pembacaan setelah tanggal ini (${Number(next.value)})`);
  const [row] = await tx
    .insert(O)
    .values({
      vehicleId: vehicle.id,
      date: input.date,
      value: String(input.value),
      driverEmployeeId,
      note: input.note ?? null,
      createdBy: currentContext().userId,
    })
    .returning();
  await tx
    .update(V)
    .set({ odometer: sql`greatest(${V.odometer}, ${String(input.value)}::numeric)`, updatedAt: sql`now()` })
    .where(eq(V.id, vehicle.id));
  return row!;
}

@Injectable()
export class FleetService {
  constructor(@Inject(MoveService) private readonly moves: MoveService) {}

  /** Kontrak yang lewat tanggal berakhir otomatis berstatus kedaluwarsa. */
  async expireContracts(tx: Db) {
    await tx
      .update(C)
      .set({ state: "expired", updatedAt: sql`now()` })
      .where(and(inArray(C.state, ["new", "running"]), lt(C.endDate, today())));
  }

  async settings(tx: Db, companyId = currentContext().companyId) {
    const [row] = await tx
      .select()
      .from(schema.fleetSettings)
      .where(eq(schema.fleetSettings.companyId, companyId));
    return { reminderDays: row?.reminderDays ?? 30, expenseAccountId: row?.expenseAccountId ?? null };
  }

  async reminders(tx: Db, companyId: string, days?: number) {
    await this.expireContracts(tx);
    const window = days ?? (await this.settings(tx, companyId)).reminderDays;
    const vehicles = await tx
      .select({
        id: V.id,
        licensePlate: V.licensePlate,
        stnkExpiry: V.stnkExpiry,
        taxDueDate: V.taxDueDate,
        kirExpiry: V.kirExpiry,
        managerUserId: V.managerUserId,
      })
      .from(V)
      .where(and(eq(V.companyId, companyId), eq(V.active, true), ne(V.state, "downgraded")));
    const contracts = await tx
      .select({
        id: C.id,
        vehicleId: C.vehicleId,
        licensePlate: V.licensePlate,
        name: ST.name,
        endDate: C.endDate,
        reminderDays: C.reminderDays,
      })
      .from(C)
      .innerJoin(V, eq(V.id, C.vehicleId))
      .innerJoin(ST, eq(ST.id, C.serviceTypeId))
      .where(and(eq(C.companyId, companyId), inArray(C.state, ["new", "running", "expired"])));
    const items = fleetReminders({ vehicles, contracts }, today(), window);
    const managers = new Map(vehicles.map((v) => [v.id, v.managerUserId]));
    return items.map((i) => ({ ...i, managerUserId: managers.get(i.vehicleId) ?? null }));
  }

  async costs(
    tx: Db,
    from: string,
    to: string,
    groupBy: "vehicle" | "category" | "month",
    vehicleId?: string,
  ) {
    const ctx = currentContext();
    const vehicles = await tx
      .select({ id: V.id, plate: V.licensePlate, model: M.name, category: M.category })
      .from(V)
      .innerJoin(M, eq(M.id, V.modelId))
      .where(and(eq(V.companyId, ctx.companyId), vehicleId ? eq(V.id, vehicleId) : undefined));
    const byId = new Map(vehicles.map((v) => [v.id, v]));
    const ids = vehicles.map((v) => v.id);
    if (!ids.length) return { groups: [], total: 0 };
    const rows: CostRow[] = [];
    const push = (vid: string, date: string, amount: number, source: CostRow["source"]) => {
      const v = byId.get(vid)!;
      rows.push({
        vehicleId: vid,
        vehicle: `${v.plate} · ${v.model}`,
        category: v.category,
        date,
        amount,
        source,
      });
    };
    const contracts = await tx
      .select()
      .from(C)
      .where(and(inArray(C.vehicleId, ids), ne(C.state, "new"), lte(C.startDate, to)));
    for (const c of contracts)
      for (const e of contractCostEvents(c, from, to)) push(c.vehicleId, e.date, e.amount, "contract");
    const services = await tx
      .select({ vehicleId: S.vehicleId, date: S.date, cost: S.cost })
      .from(S)
      .where(and(inArray(S.vehicleId, ids), ne(S.state, "cancelled"), gte(S.date, from), lte(S.date, to)));
    for (const s of services) if (Number(s.cost)) push(s.vehicleId, s.date, Number(s.cost), "service");
    return groupFleetCosts(rows, groupBy);
  }

  /** Tagihan vendor (draft) dari servis, dibebankan ke cabang/unit bisnis kendaraan; hanya sekali per servis. */
  async bill(tx: Db, id: string) {
    const [service] = await tx.select().from(S).where(eq(S.id, id));
    if (!service || !currentContext().companyIds.includes(service.companyId))
      throw new NotFoundException("Servis tidak ditemukan");
    if (service.moveId) throw new BadRequestException("Tagihan untuk servis ini sudah dibuat");
    if (service.state === "cancelled")
      throw new BadRequestException("Servis dibatalkan tidak dapat ditagihkan");
    if (!service.vendorId) throw fieldError("vendorId", "Isi vendor sebelum membuat tagihan");
    if (!(Number(service.cost) > 0)) throw fieldError("cost", "Biaya servis harus lebih dari 0");
    const vehicle = await findVehicle(tx, service.vehicleId);
    const [type] = await tx.select().from(ST).where(eq(ST.id, service.serviceTypeId));
    const settings = await this.settings(tx, service.companyId);
    const moveId = await this.moves.createInvoice(
      tx,
      {
        moveType: "in_invoice",
        partnerId: service.vendorId,
        date: service.date,
        dueDate: null,
        ref: `${type?.name ?? "Servis"} ${vehicle.licensePlate}`,
        narration: service.description ?? null,
        lines: [
          {
            productId: null,
            accountId: type?.accountId ?? settings.expenseAccountId,
            name: `${type?.name ?? "Servis"} — ${vehicle.licensePlate}`,
            quantity: "1",
            priceUnit: service.cost,
            discount: "0",
            taxIds: [],
            businessUnitId: vehicle.businessUnitId,
            branchId: vehicle.branchId,
            uomId: null,
          },
        ],
      },
      service.companyId,
      { invoiceOrigin: vehicle.licensePlate },
    );
    await tx
      .update(S)
      .set({ moveId, updatedAt: sql`now()` })
      .where(eq(S.id, id));
    return { moveId };
  }

  async overview(tx: Db, id: string) {
    const vehicle = await findVehicle(tx, id);
    const [model] = await tx
      .select({ name: M.name, category: M.category, manufacturer: MF.name })
      .from(M)
      .innerJoin(MF, eq(MF.id, M.manufacturerId))
      .where(eq(M.id, vehicle.modelId));
    const drivers = await tx
      .select({
        id: DA.id,
        employeeId: DA.employeeId,
        name: E.name,
        startDate: DA.startDate,
        endDate: DA.endDate,
      })
      .from(DA)
      .innerJoin(E, eq(E.id, DA.employeeId))
      .where(eq(DA.vehicleId, id))
      .orderBy(desc(DA.startDate), desc(DA.createdAt));
    const odometers = await tx
      .select({ id: O.id, date: O.date, value: O.value, note: O.note, driver: E.name })
      .from(O)
      .leftJoin(E, eq(E.id, O.driverEmployeeId))
      .where(eq(O.vehicleId, id))
      .orderBy(desc(O.date), desc(O.value))
      .limit(50);
    await this.expireContracts(tx);
    const contracts = await tx
      .select({
        id: C.id,
        type: ST.name,
        reference: C.reference,
        startDate: C.startDate,
        endDate: C.endDate,
        recurringCost: C.recurringCost,
        recurringInterval: C.recurringInterval,
        state: C.state,
      })
      .from(C)
      .innerJoin(ST, eq(ST.id, C.serviceTypeId))
      .where(eq(C.vehicleId, id))
      .orderBy(desc(C.startDate));
    const services = await tx
      .select({
        id: S.id,
        type: ST.name,
        date: S.date,
        cost: S.cost,
        state: S.state,
        moveId: S.moveId,
        odometer: S.odometer,
      })
      .from(S)
      .innerJoin(ST, eq(ST.id, S.serviceTypeId))
      .where(eq(S.vehicleId, id))
      .orderBy(desc(S.date))
      .limit(50);
    // Peminjaman kendaraan lewat modul Persetujuan (kategori PINJAM) yang menyebut nomor polisi ini.
    const bookings = await tx
      .select({
        id: schema.approvalRequests.id,
        number: schema.approvalRequests.number,
        subject: schema.approvalRequests.subject,
        dateFrom: schema.approvalRequests.dateFrom,
        dateTo: schema.approvalRequests.dateTo,
        state: schema.approvalRequests.state,
        employee: E.name,
      })
      .from(schema.approvalRequests)
      .innerJoin(
        schema.approvalCategories,
        eq(schema.approvalCategories.id, schema.approvalRequests.categoryId),
      )
      .leftJoin(E, eq(E.id, schema.approvalRequests.employeeId))
      .where(
        and(
          eq(schema.approvalCategories.code, "PINJAM"),
          eq(schema.approvalRequests.companyId, vehicle.companyId),
          ilike(schema.approvalRequests.reference, `%${vehicle.licensePlate.replace(/[%_\\]/g, "")}%`),
        ),
      )
      .orderBy(desc(schema.approvalRequests.dateFrom))
      .limit(20);
    const year = today().slice(0, 4);
    const costs = await this.costs(tx, `${year}-01-01`, `${year}-12-31`, "vehicle", id);
    return {
      vehicle,
      model: model ?? null,
      drivers,
      odometers,
      contracts,
      services,
      bookings,
      costsThisYear: costs.total,
    };
  }
}

const ManufacturersController = createCrudController({
  path: "fleet-manufacturers",
  model: "fleet_manufacturer",
  table: schema.fleetManufacturers,
  schema: fleetManufacturerSchema,
  read: "fleet.read",
  write: "fleet.manage",
  searchColumns: [MF.name],
  orderBy: MF.name,
  beforeSave: async (tx, values, id) => {
    if (typeof values.name !== "string") return;
    const [dup] = await tx
      .select({ id: MF.id })
      .from(MF)
      .where(and(sql`lower(${MF.name}) = lower(${values.name})`, id ? ne(MF.id, id) : undefined));
    if (dup) throw fieldError("name", "Produsen sudah ada");
  },
});

const ModelsController = createCrudController({
  path: "fleet-models",
  model: "fleet_model",
  table: schema.fleetModels,
  schema: fleetModelSchema,
  read: "fleet.read",
  write: "fleet.manage",
  searchColumns: [M.name],
  orderBy: M.name,
  refs: { manufacturerId: schema.fleetManufacturers },
});

const ServiceTypesController = createCrudController({
  path: "fleet-service-types",
  model: "fleet_service_type",
  table: schema.fleetServiceTypes,
  schema: fleetServiceTypeSchema,
  read: "fleet.read",
  write: "fleet.manage",
  searchColumns: [ST.name],
  orderBy: ST.name,
  companyColumn: ST.companyId,
  perCompany: true,
  beforeSave: async (tx, values) => {
    if (typeof values.accountId === "string")
      await assertCompanyAccounts(tx, String(values.companyId), [
        { path: "accountId", id: values.accountId },
      ]);
  },
});

const VehiclesController = createCrudController({
  path: "fleet-vehicles",
  model: "fleet_vehicle",
  table: schema.fleetVehicles,
  schema: fleetVehicleSchema,
  read: "fleet.read",
  write: "fleet.write",
  searchColumns: [V.licensePlate, V.vin, V.stnkNo],
  orderBy: V.licensePlate,
  companyColumn: V.companyId,
  perCompany: true,
  refs: {
    modelId: schema.fleetModels,
    branchId: schema.branches,
    businessUnitId: schema.businessUnits,
    driverEmployeeId: schema.employees,
    nextDriverEmployeeId: schema.employees,
    assetId: schema.assets,
  },
  beforeSave: async (tx, values, id) => {
    if (typeof values.licensePlate === "string") {
      const [dup] = await tx
        .select({ id: V.id })
        .from(V)
        .where(
          and(
            eq(V.companyId, String(values.companyId)),
            eq(V.licensePlate, values.licensePlate),
            id ? ne(V.id, id) : undefined,
          ),
        );
      if (dup) throw fieldError("licensePlate", "Nomor polisi sudah terdaftar");
    }
    if (id && "driverEmployeeId" in values)
      await syncDriver(tx, id, (values.driverEmployeeId as string | null) ?? null);
  },
  afterCreate: async (tx, row) => {
    await ensureServiceTypes(tx, String(row.companyId));
    if (row.driverEmployeeId) await syncDriver(tx, row.id, String(row.driverEmployeeId));
  },
});

const ContractsController = createCrudController({
  path: "fleet-contracts",
  model: "fleet_contract",
  table: schema.fleetContracts,
  schema: fleetContractSchema,
  read: "fleet.read",
  write: "fleet.write",
  searchColumns: [C.reference],
  orderBy: C.startDate,
  companyColumn: C.companyId,
  perCompany: true,
  refs: {
    vehicleId: schema.fleetVehicles,
    serviceTypeId: schema.fleetServiceTypes,
    vendorId: schema.partners,
  },
  beforeSave: async (tx, values, id) => {
    await sameCompanyVehicle(tx, values.vehicleId, values.companyId);
    await sameCompanyServiceType(tx, values.serviceTypeId, values.companyId);
    let { startDate, endDate } = values as { startDate?: string; endDate?: string | null };
    if (id && (startDate === undefined || endDate === undefined)) {
      const [before] = await tx.select().from(C).where(eq(C.id, id));
      startDate ??= before?.startDate;
      if (endDate === undefined) endDate = before?.endDate ?? null;
    }
    if (startDate && endDate && endDate < startDate)
      throw fieldError("endDate", "Tanggal berakhir sebelum tanggal mulai");
  },
});

const ServicesController = createCrudController({
  path: "fleet-services",
  model: "fleet_service",
  table: schema.fleetServices,
  schema: fleetServiceSchema,
  read: "fleet.read",
  write: "fleet.write",
  searchColumns: [S.description],
  orderBy: S.date,
  companyColumn: S.companyId,
  perCompany: true,
  refs: {
    vehicleId: schema.fleetVehicles,
    serviceTypeId: schema.fleetServiceTypes,
    vendorId: schema.partners,
    driverEmployeeId: schema.employees,
  },
  beforeSave: async (tx, values, id) => {
    await sameCompanyVehicle(tx, values.vehicleId, values.companyId);
    await sameCompanyServiceType(tx, values.serviceTypeId, values.companyId);
    if (id) {
      const [before] = await tx.select().from(S).where(eq(S.id, id));
      if (before?.moveId && ["cost", "vendorId", "vehicleId"].some((k) => k in values))
        throw new BadRequestException(
          "Servis yang sudah ditagihkan tidak dapat diubah biaya/vendor/kendaraannya",
        );
    }
  },
  beforeDelete: async (_tx, row) => {
    if (row.moveId) throw new BadRequestException("Servis yang sudah ditagihkan tidak dapat dihapus");
  },
  afterCreate: async (tx, row) => {
    if (row.odometer == null) return;
    const vehicle = await findVehicle(tx, String(row.vehicleId));
    await addOdometer(
      tx,
      vehicle,
      { date: String(row.date), value: Number(row.odometer), note: "Servis" },
      (row.driverEmployeeId as string | null) ?? null,
      "odometer",
    );
  },
});

const driverSchema = z.object({
  employeeId: z.string().uuid().nullish(),
  date: z.string().date().optional(),
});

const reportQuery = z.object({
  from: z.string().date(),
  to: z.string().date(),
  groupBy: z.enum(["vehicle", "category", "month"]).default("vehicle"),
});

@Controller("fleet")
class FleetController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(FleetService) private readonly fleet: FleetService,
  ) {}

  @Get("vehicles/:id/overview")
  @RequirePermission("fleet.read")
  overview(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.fleet.overview(tx, id));
  }

  @Post("vehicles/:id/driver")
  @RequirePermission("fleet.write")
  driver(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(driverSchema, body);
    return this.tenantDb.run(async (tx) => {
      const vehicle = await findVehicle(tx, id);
      if (input.employeeId) {
        const [emp] = await tx.select({ id: E.id }).from(E).where(eq(E.id, input.employeeId));
        if (!emp) throw fieldError("employeeId", "Karyawan tidak ditemukan");
      }
      const employeeId = input.employeeId ?? null;
      await syncDriver(tx, vehicle.id, employeeId, input.date);
      const next = vehicle.nextDriverEmployeeId === employeeId ? null : vehicle.nextDriverEmployeeId;
      await tx
        .update(V)
        .set({ driverEmployeeId: employeeId, nextDriverEmployeeId: next, updatedAt: sql`now()` })
        .where(eq(V.id, id));
      return this.fleet.overview(tx, id);
    });
  }

  @Get("vehicles/:id/odometers")
  @RequirePermission("fleet.read")
  odometers(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await findVehicle(tx, id);
      return tx.select().from(O).where(eq(O.vehicleId, id)).orderBy(asc(O.date), asc(O.value));
    });
  }

  @Post("vehicles/:id/odometers")
  @RequirePermission("fleet.write")
  addOdometer(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(fleetOdometerSchema, body);
    return this.tenantDb.run(async (tx) => {
      const vehicle = await findVehicle(tx, id);
      return addOdometer(tx, vehicle, input, vehicle.driverEmployeeId);
    });
  }

  @Post("contracts/:id/close")
  @RequirePermission("fleet.write")
  close(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const contract = await this.contract(tx, id);
      if (contract.state === "closed") throw new BadRequestException("Kontrak sudah ditutup");
      const [row] = await tx
        .update(C)
        .set({ state: "closed", endDate: contract.endDate ?? today(), updatedAt: sql`now()` })
        .where(eq(C.id, id))
        .returning();
      return row;
    });
  }

  /** Perpanjang: kontrak baru mulai sehari setelah yang lama berakhir dengan durasi & biaya sama; yang lama ditutup. */
  @Post("contracts/:id/renew")
  @RequirePermission("fleet.write")
  renew(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const c = await this.contract(tx, id);
      if (!c.endDate)
        throw new BadRequestException("Kontrak tanpa tanggal berakhir tidak perlu diperpanjang");
      if (c.state === "closed") throw new BadRequestException("Kontrak sudah ditutup");
      const day = 86_400_000;
      const start = new Date(Date.parse(`${c.endDate}T00:00:00Z`) + day);
      const length = Date.parse(`${c.endDate}T00:00:00Z`) - Date.parse(`${c.startDate}T00:00:00Z`);
      const end = new Date(start.getTime() + length);
      const [created] = await tx
        .insert(C)
        .values({
          companyId: c.companyId,
          vehicleId: c.vehicleId,
          serviceTypeId: c.serviceTypeId,
          vendorId: c.vendorId,
          reference: c.reference,
          startDate: start.toISOString().slice(0, 10),
          endDate: end.toISOString().slice(0, 10),
          initialCost: "0",
          recurringCost: c.recurringCost,
          recurringInterval: c.recurringInterval,
          includedServices: c.includedServices,
          state: "running",
          reminderDays: c.reminderDays,
          note: c.note,
          renewedFromId: c.id,
        })
        .returning();
      await tx
        .update(C)
        .set({ state: "closed", updatedAt: sql`now()` })
        .where(eq(C.id, id));
      return created;
    });
  }

  @Post("services/:id/bill")
  @RequirePermission("fleet.manage")
  bill(@Param("id", ParseUUIDPipe) id: string) {
    const ctx = currentContext();
    if (!hasPermission(ctx.permissions, "accounting.write"))
      throw new ForbiddenException("Butuh hak akuntansi untuk membuat tagihan vendor");
    return this.tenantDb.run((tx) => this.fleet.bill(tx, id));
  }

  @Get("reports/costs")
  @RequirePermission("fleet.read")
  costs(@Query() query: unknown) {
    const q = parse(reportQuery, query);
    if (q.to < q.from) throw fieldError("to", "Tanggal akhir sebelum tanggal awal");
    return this.tenantDb.run((tx) => this.fleet.costs(tx, q.from, q.to, q.groupBy));
  }

  /** Tren odometer: pembacaan terakhir per bulan per kendaraan dalam rentang. */
  @Get("reports/odometer")
  @RequirePermission("fleet.read")
  odometerReport(@Query() query: unknown) {
    const q = parse(reportQuery, query);
    return this.tenantDb.run(async (tx) => {
      const rows = await tx
        .select({
          vehicleId: V.id,
          licensePlate: V.licensePlate,
          month: sql<string>`to_char(${O.date}, 'YYYY-MM')`,
          value: sql<string>`max(${O.value})`,
        })
        .from(O)
        .innerJoin(V, eq(V.id, O.vehicleId))
        .where(and(eq(V.companyId, currentContext().companyId), gte(O.date, q.from), lte(O.date, q.to)))
        .groupBy(V.id, V.licensePlate, sql`to_char(${O.date}, 'YYYY-MM')`)
        .orderBy(V.licensePlate, sql`to_char(${O.date}, 'YYYY-MM')`);
      return rows.map((r) => ({ ...r, value: Number(r.value) }));
    });
  }

  @Get("reminders")
  @RequirePermission("fleet.read")
  reminders(@Query("days") days?: string) {
    const n = days ? Math.min(Math.max(Number(days) || 30, 1), 365) : undefined;
    return this.tenantDb.run((tx) => this.fleet.reminders(tx, currentContext().companyId, n));
  }

  @Get("settings")
  @RequirePermission("fleet.read")
  getSettings() {
    return this.tenantDb.run(async (tx) => {
      await ensureServiceTypes(tx, currentContext().companyId);
      return this.fleet.settings(tx);
    });
  }

  @Put("settings")
  @RequirePermission("fleet.manage")
  saveSettings(@Body() body: unknown) {
    const input = parse(fleetSettingsSchema, body);
    const companyId = currentContext().companyId;
    return this.tenantDb.run(async (tx) => {
      if (input.expenseAccountId)
        await assertCompanyAccounts(tx, companyId, [
          { path: "expenseAccountId", id: input.expenseAccountId },
        ]);
      const values = { reminderDays: input.reminderDays, expenseAccountId: input.expenseAccountId ?? null };
      await tx
        .insert(schema.fleetSettings)
        .values({ companyId, ...values })
        .onConflictDoUpdate({
          target: [schema.fleetSettings.tenantId, schema.fleetSettings.companyId],
          set: { ...values, updatedAt: sql`now()` },
        });
      return this.fleet.settings(tx);
    });
  }

  /** Kendaraan yang (pernah) dikemudikan seorang karyawan — panel di halaman karyawan. */
  @Get("employees/:id/vehicles")
  @RequirePermission("fleet.read")
  employeeVehicles(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => driverHistory(tx, id));
  }

  private async contract(tx: Db, id: string) {
    const [c] = await tx.select().from(C).where(eq(C.id, id));
    if (!c || !currentContext().companyIds.includes(c.companyId))
      throw new NotFoundException("Kontrak tidak ditemukan");
    return c;
  }
}

function driverHistory(tx: Db, employeeId: string) {
  return tx
    .select({
      vehicleId: V.id,
      licensePlate: V.licensePlate,
      model: M.name,
      odometer: V.odometer,
      odometerUnit: V.odometerUnit,
      startDate: DA.startDate,
      endDate: DA.endDate,
    })
    .from(DA)
    .innerJoin(V, eq(V.id, DA.vehicleId))
    .innerJoin(M, eq(M.id, V.modelId))
    .where(eq(DA.employeeId, employeeId))
    .orderBy(desc(DA.startDate));
}

/** Portal: kendaraan yang sedang dikemudikan karyawan login + input odometer olehnya. */
@Controller("me/vehicles")
class MyVehiclesController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(FleetService) private readonly fleet: FleetService,
  ) {}

  private async me(tx: Db) {
    const ctx = currentContext();
    const [emp] = await tx
      .select({ id: E.id })
      .from(E)
      .where(and(eq(E.userId, ctx.userId), eq(E.companyId, ctx.companyId)));
    return emp ?? null;
  }

  @Get()
  list() {
    return this.tenantDb.run(async (tx) => {
      const emp = await this.me(tx);
      if (!emp) return [];
      return tx
        .select({
          id: V.id,
          licensePlate: V.licensePlate,
          model: M.name,
          manufacturer: MF.name,
          odometer: V.odometer,
          odometerUnit: V.odometerUnit,
          stnkExpiry: V.stnkExpiry,
          taxDueDate: V.taxDueDate,
          kirExpiry: V.kirExpiry,
        })
        .from(V)
        .innerJoin(M, eq(M.id, V.modelId))
        .innerJoin(MF, eq(MF.id, M.manufacturerId))
        .where(and(eq(V.driverEmployeeId, emp.id), eq(V.active, true)))
        .orderBy(V.licensePlate);
    });
  }

  @Post(":id/odometers")
  addOdometer(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(fleetOdometerSchema, body);
    return this.tenantDb.run(async (tx) => {
      const emp = await this.me(tx);
      const [vehicle] = await tx.select().from(V).where(eq(V.id, id));
      if (!vehicle || !emp || vehicle.driverEmployeeId !== emp.id)
        throw new ForbiddenException("Hanya pengemudi kendaraan ini yang dapat mencatat odometer");
      return addOdometer(tx, vehicle, input, emp.id);
    });
  }
}

const KIND_LABEL = { stnk: "STNK", tax: "Pajak tahunan", kir: "KIR", contract: "Kontrak" } as const;

/** Pengingat harian: notifikasi in-app ke fleet manager kendaraan & pengguna fleet.manage (sekali per perusahaan per hari). */
@Injectable()
export class FleetReminderService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("FleetReminder");
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(FleetService) private readonly fleet: FleetService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.hrReminder.scheduler) return;
    this.timer = setInterval(
      () =>
        void this.runDaily().catch((e: unknown) => {
          this.logger.error(e);
          reportError(e, { job: "fleet-reminder" });
        }),
      60 * 60_000,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** Mengembalikan jumlah notifikasi yang dibuat. */
  async runDaily(tenantIds?: string[]) {
    const tenants =
      tenantIds ??
      (await this.ownerDb.select({ id: schema.tenants.id }).from(schema.tenants)).map((t) => t.id);
    let created = 0;
    for (const tenantId of tenants) {
      created += await this.tenantDb
        .runAs(tenantId, async (tx) => {
          let n = 0;
          const companies = await tx.select({ id: schema.companies.id }).from(schema.companies);
          for (const company of companies) {
            const [hasVehicle] = await tx
              .select({ id: V.id })
              .from(V)
              .where(eq(V.companyId, company.id))
              .limit(1);
            if (!hasVehicle) continue;
            const items = await this.fleet.reminders(tx, company.id);
            if (!items.length) continue;
            const [logged] = await tx
              .insert(schema.fleetReminderLog)
              .values({ companyId: company.id, sentOn: today() })
              .onConflictDoNothing()
              .returning();
            if (!logged) continue;
            const managers = await tx
              .selectDistinct({ id: schema.users.id })
              .from(schema.users)
              .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
              .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.userRoles.roleId))
              .innerJoin(schema.userCompanies, eq(schema.userCompanies.userId, schema.users.id))
              .where(
                and(
                  eq(schema.users.active, true),
                  eq(schema.userCompanies.companyId, company.id),
                  inArray(schema.rolePermissions.permission, ["fleet.manage", "*"]),
                ),
              );
            const rows: {
              companyId: string;
              userId: string;
              kind: string;
              title: string;
              body: string;
              link: string;
            }[] = [];
            const add = (userId: string, item: (typeof items)[number]) =>
              rows.push({
                companyId: company.id,
                userId,
                kind: "fleet_reminder",
                title: `${KIND_LABEL[item.kind]} ${item.licensePlate} ${
                  item.daysLeft < 0 ? "sudah lewat" : "berakhir"
                } ${item.date}`,
                body: item.kind === "contract" ? item.name : `${item.name} ${item.licensePlate}`,
                link: `/fleet-vehicles/${item.vehicleId}`,
              });
            for (const item of items) {
              const targets = new Set(managers.map((m) => m.id));
              if (item.managerUserId) targets.add(item.managerUserId);
              for (const userId of targets) add(userId, item);
            }
            if (rows.length) await tx.insert(schema.notifications).values(rows);
            n += rows.length;
          }
          return n;
        })
        .catch((e: unknown) => {
          this.logger.warn(`Pengingat armada tenant ${tenantId}: ${(e as Error).message}`);
          return 0;
        });
    }
    return created;
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [
    ManufacturersController,
    ModelsController,
    ServiceTypesController,
    VehiclesController,
    ContractsController,
    ServicesController,
    FleetController,
    MyVehiclesController,
  ],
  providers: [ActivityService, FleetService, FleetReminderService],
  exports: [FleetReminderService],
})
export class FleetModule {}
