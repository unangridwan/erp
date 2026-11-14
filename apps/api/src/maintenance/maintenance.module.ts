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
import { and, asc, desc, eq, inArray, ne, or, schema, sql, type Db } from "@erp/db";
import {
  breakdownReportSchema,
  downtimeHours,
  equipmentSchema,
  hasPermission,
  maintenanceDoneSchema,
  maintenancePartsSchema,
  maintenancePlanSchema,
  maintenanceRequestSchema,
  maintenanceSettingsSchema,
  maintenanceTeamSchema,
  meterReadingSchema,
  periodHours,
  planDue,
  planHasInterval,
  reliability,
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
import { normalizeCustom } from "../customization/custom-values.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { StockService } from "../inventory/stock.service.js";
import { SequenceService } from "../sequences/sequence.service.js";

const EQ = schema.equipment;
const PL = schema.maintenancePlans;
const RQ = schema.maintenanceRequests;
const PT = schema.maintenanceParts;
const TM = schema.maintenanceTeams;
const MR = schema.equipmentMeterReadings;

type Request = typeof RQ.$inferSelect;
type Equipment = typeof EQ.$inferSelect;

const today = () => new Date().toISOString().slice(0, 10);
const EXPENSE_CODE = "6-8000";

async function findEquipment(tx: Db, id: unknown, companyId?: unknown): Promise<Equipment> {
  if (typeof id !== "string") throw fieldError("equipmentId", "Peralatan tidak ditemukan");
  const [row] = await tx.select().from(EQ).where(eq(EQ.id, id));
  const ctx = currentContext();
  if (!row || !ctx.companyIds.includes(row.companyId) || (companyId && row.companyId !== companyId))
    throw fieldError("equipmentId", "Peralatan tidak ditemukan");
  return row;
}

/** Anggota tim + teknisi (penerima notifikasi). */
async function recipients(tx: Db, teamId: string | null, technicianUserId: string | null) {
  const ids = new Set<string>();
  if (technicianUserId) ids.add(technicianUserId);
  if (teamId) {
    const [team] = await tx.select({ members: TM.memberIds }).from(TM).where(eq(TM.id, teamId));
    for (const m of team?.members ?? []) ids.add(m);
  }
  return [...ids];
}

/** Notifikasi langsung (dipakai juga oleh job tanpa konteks request). */
async function notifyUsers(
  tx: Db,
  companyId: string,
  userIds: string[],
  input: { title: string; body?: string | null; link: string },
  except?: string,
) {
  const targets = [...new Set(userIds)].filter((u) => u !== except);
  if (!targets.length) return;
  await tx.insert(schema.notifications).values(
    targets.map((userId) => ({
      companyId,
      userId,
      kind: "maintenance",
      title: input.title.slice(0, 300),
      body: input.body?.slice(0, 2000) ?? null,
      link: input.link,
    })),
  );
}

// ---- Master (CRUD generik) ----

const TeamsController = createCrudController({
  path: "maintenance-teams",
  model: "maintenance_team",
  table: TM,
  schema: maintenanceTeamSchema,
  read: "maintenance.read",
  write: "maintenance.manage",
  searchColumns: [TM.name],
  orderBy: TM.name,
  companyColumn: TM.companyId,
  perCompany: true,
});

const EquipmentController = createCrudController({
  path: "equipment",
  customModel: "equipment",
  model: "equipment",
  table: EQ,
  schema: equipmentSchema,
  read: "maintenance.read",
  write: "maintenance.manage",
  searchColumns: [EQ.code, EQ.name, EQ.serialNo, EQ.location, EQ.category],
  orderBy: EQ.code,
  companyColumn: EQ.companyId,
  perCompany: true,
  refs: {
    assetId: schema.assets,
    workCenterId: schema.workCenters,
    branchId: schema.branches,
    businessUnitId: schema.businessUnits,
    costCenterId: schema.costCenters,
    vendorId: schema.partners,
    teamId: TM,
    technicianUserId: schema.users,
  },
  beforeSave: async (tx, values, id) => {
    if (typeof values.code === "string") {
      const [dup] = await tx
        .select({ id: EQ.id })
        .from(EQ)
        .where(
          and(
            eq(EQ.companyId, String(values.companyId)),
            sql`lower(${EQ.code}) = lower(${values.code})`,
            id ? ne(EQ.id, id) : undefined,
          ),
        );
      if (dup) throw fieldError("code", "Kode peralatan sudah dipakai");
    }
  },
  beforeDelete: async (tx, row) => {
    const [used] = await tx
      .select({ id: RQ.id })
      .from(RQ)
      .where(eq(RQ.equipmentId, String(row.id)))
      .limit(1);
    if (used)
      throw new BadRequestException(
        "Peralatan sudah punya riwayat perawatan; ubah status menjadi Tidak dipakai",
      );
  },
});

const PlansController = createCrudController({
  path: "maintenance-plans",
  model: "maintenance_plan",
  table: PL,
  schema: maintenancePlanSchema,
  read: "maintenance.read",
  write: "maintenance.manage",
  searchColumns: [PL.name],
  orderBy: PL.name,
  refs: { equipmentId: EQ, teamId: TM, technicianUserId: schema.users },
  beforeSave: async (tx, values, id) => {
    if ("equipmentId" in values) await findEquipment(tx, values.equipmentId);
    let merged = values as { intervalDays?: number | null; intervalMeter?: string | null };
    if (id) {
      const [before] = await tx.select().from(PL).where(eq(PL.id, id));
      if (before) await findEquipment(tx, before.equipmentId);
      merged = { ...before, ...merged };
    }
    if (!planHasInterval(merged)) throw fieldError("intervalDays", "Isi interval hari atau interval meter");
  },
});

// ---- Layanan ----

@Injectable()
export class MaintenanceService {
  constructor(
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(MoveService) private readonly moves: MoveService,
  ) {}

  async settings(tx: Db, companyId: string) {
    const [s] = await tx
      .select()
      .from(schema.maintenanceSettings)
      .where(eq(schema.maintenanceSettings.companyId, companyId));
    return s ?? { companyId, expenseAccountId: null, partsLocationId: null };
  }

  /** Akun beban perawatan: dari pengaturan, atau akun 6-8000 "Beban Pemeliharaan dan Perbaikan" (dibuat bila belum ada). */
  async expenseAccount(tx: Db, companyId: string) {
    const s = await this.settings(tx, companyId);
    if (s.expenseAccountId) return s.expenseAccountId;
    const A = schema.accounts;
    const [found] = await tx
      .select({ id: A.id })
      .from(A)
      .where(and(eq(A.companyId, companyId), eq(A.code, EXPENSE_CODE)));
    if (found) return found.id;
    const [created] = await tx
      .insert(A)
      .values({
        companyId,
        code: EXPENSE_CODE,
        name: "Beban Pemeliharaan dan Perbaikan",
        accountType: "expense",
      })
      .returning({ id: A.id });
    return created!.id;
  }

  /** Lokasi suku cadang bawaan: pengaturan, atau lokasi stok gudang aktif pertama. */
  async partsLocation(tx: Db, companyId: string) {
    const s = await this.settings(tx, companyId);
    if (s.partsLocationId) return s.partsLocationId;
    const [wh] = await tx
      .select({ id: schema.warehouses.lotStockId })
      .from(schema.warehouses)
      .where(and(eq(schema.warehouses.companyId, companyId), eq(schema.warehouses.active, true)))
      .orderBy(asc(schema.warehouses.createdAt))
      .limit(1);
    return wh?.id ?? null;
  }

  async find(tx: Db, id: string): Promise<Request> {
    const [row] = await tx.select().from(RQ).where(eq(RQ.id, id));
    if (!row || !currentContext().companyIds.includes(row.companyId))
      throw new NotFoundException("Permintaan perawatan tidak ditemukan");
    return row;
  }

  async detail(tx: Db, id: string) {
    const request = await this.find(tx, id);
    const [equipment] = await tx.select().from(EQ).where(eq(EQ.id, request.equipmentId));
    const parts = await tx
      .select({
        id: PT.id,
        productId: PT.productId,
        product: schema.products.name,
        sku: schema.products.sku,
        quantity: PT.quantity,
        locationId: PT.locationId,
        lotName: PT.lotName,
        cost: PT.cost,
      })
      .from(PT)
      .innerJoin(schema.products, eq(schema.products.id, PT.productId))
      .where(eq(PT.requestId, id))
      .orderBy(asc(schema.products.name));
    const total = Number(request.partsCost) + Number(request.vendorCost) + Number(request.laborCost);
    return { ...request, equipment, parts, totalCost: total.toFixed(2) };
  }

  /** Buat permintaan (korektif/preventif) bernomor `MR`; korektif dengan mesin berhenti → peralatan Rusak. */
  async create(
    tx: Db,
    input: z.infer<typeof maintenanceRequestSchema> & {
      planId?: string | null;
      planCycle?: string | null;
      stopped?: boolean;
    },
    opts: { companyId: string; userId: string | null; checklist?: { label: string; done: boolean }[] },
  ) {
    const [equipment] = await tx.select().from(EQ).where(eq(EQ.id, input.equipmentId));
    if (!equipment || equipment.companyId !== opts.companyId)
      throw fieldError("equipmentId", "Peralatan tidak ditemukan");
    if (equipment.state === "retired") throw fieldError("equipmentId", "Peralatan sudah tidak dipakai");
    const name = await this.sequences.next(tx, "maintenance.request", opts.companyId, new Date(), "MR");
    const breakdownAt =
      input.kind === "corrective" && input.stopped !== false
        ? input.breakdownAt
          ? new Date(input.breakdownAt)
          : new Date()
        : null;
    const custom = await normalizeCustom(tx, "maintenance_request", input.custom, {}, opts.companyId);
    const [row] = await tx
      .insert(RQ)
      .values({
        companyId: opts.companyId,
        name,
        equipmentId: equipment.id,
        kind: input.kind,
        planId: input.planId ?? null,
        planCycle: input.planCycle ?? null,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        requestedBy: opts.userId,
        teamId: input.teamId ?? equipment.teamId,
        technicianUserId: input.technicianUserId ?? equipment.technicianUserId,
        scheduledDate: input.scheduledDate ?? null,
        state: input.scheduledDate ? "scheduled" : "new",
        breakdownAt,
        checklist: opts.checklist ?? input.checklist ?? [],
        vendorId: input.vendorId ?? null,
        vendorCost: input.vendorCost,
        laborCost: input.laborCost,
        laborHours: input.laborHours ?? null,
        custom,
        createdBy: opts.userId,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return null;
    if (breakdownAt)
      await tx.update(EQ).set({ state: "down", updatedAt: new Date() }).where(eq(EQ.id, equipment.id));
    const to = await recipients(tx, row.teamId, row.technicianUserId);
    await notifyUsers(
      tx,
      opts.companyId,
      to,
      {
        title: `${row.kind === "preventive" ? "Perawatan terjadwal" : "Laporan kerusakan"} ${row.name}: ${equipment.name}`,
        body: row.title,
        link: `/maintenance/requests/${row.id}`,
      },
      opts.userId ?? undefined,
    );
    return row;
  }

  async update(tx: Db, id: string, input: z.infer<typeof maintenanceRequestSchema>) {
    const request = await this.find(tx, id);
    if (request.state === "done" || request.state === "cancelled")
      throw new BadRequestException("Permintaan yang selesai/batal tidak dapat diubah");
    if (input.equipmentId !== request.equipmentId)
      await findEquipment(tx, input.equipmentId, request.companyId);
    if (request.moveId && (input.vendorId !== request.vendorId || input.vendorCost !== request.vendorCost))
      throw new BadRequestException("Vendor/biaya jasa sudah ditagihkan dan tidak dapat diubah");
    const custom = await normalizeCustom(
      tx,
      "maintenance_request",
      input.custom,
      request.custom,
      request.companyId,
    );
    const state =
      request.state === "new" && input.scheduledDate
        ? "scheduled"
        : request.state === "scheduled" && !input.scheduledDate
          ? "new"
          : request.state;
    await tx
      .update(RQ)
      .set({
        equipmentId: input.equipmentId,
        kind: input.kind,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        teamId: input.teamId ?? null,
        technicianUserId: input.technicianUserId ?? null,
        scheduledDate: input.scheduledDate ?? null,
        state,
        vendorId: input.vendorId ?? null,
        vendorCost: input.vendorCost,
        laborCost: input.laborCost,
        laborHours: input.laborHours ?? null,
        resolution: input.resolution ?? null,
        ...(input.checklist ? { checklist: input.checklist } : {}),
        ...(input.breakdownAt ? { breakdownAt: new Date(input.breakdownAt) } : {}),
        custom,
        updatedAt: new Date(),
      })
      .where(eq(RQ.id, id));
    return this.detail(tx, id);
  }

  async start(tx: Db, id: string) {
    const request = await this.find(tx, id);
    if (request.state !== "new" && request.state !== "scheduled")
      throw new BadRequestException("Permintaan ini tidak bisa dimulai");
    const now = new Date();
    await tx
      .update(RQ)
      .set({
        state: "in_progress",
        startedAt: now,
        technicianUserId: request.technicianUserId ?? currentContext().userId,
        ...(request.kind === "corrective" && !request.breakdownAt ? { breakdownAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(RQ.id, id));
    // Perawatan preventif dan perbaikan menghentikan mesin selama dikerjakan.
    await tx.update(EQ).set({ state: "down", updatedAt: now }).where(eq(EQ.id, request.equipmentId));
    return this.detail(tx, id);
  }

  /**
   * Selesai: suku cadang dikeluarkan dari stok (Dr beban perawatan + cost center peralatan / Cr persediaan), downtime
   * dihitung, rencana diperbarui (tanggal & meter terakhir), peralatan kembali Beroperasi bila tak ada perbaikan lain.
   */
  async done(tx: Db, id: string, input: z.infer<typeof maintenanceDoneSchema>) {
    const request = await this.find(tx, id);
    if (request.state === "done" || request.state === "cancelled")
      throw new BadRequestException("Permintaan sudah selesai/batal");
    const [equipment] = await tx.select().from(EQ).where(eq(EQ.id, request.equipmentId));
    const finishedAt = input.finishedAt ? new Date(input.finishedAt) : new Date();
    const startedAt = request.startedAt ?? finishedAt;
    if (finishedAt < startedAt) throw fieldError("finishedAt", "Waktu selesai sebelum waktu mulai");
    const companyId = request.companyId;

    // Suku cadang.
    const parts = await tx.select().from(PT).where(eq(PT.requestId, id)).orderBy(asc(PT.id));
    let partsCost = 0;
    let partsMoveId: string | null = null;
    if (parts.length) {
      const fallback = await this.partsLocation(tx, companyId);
      const lines = parts.map((p, i) => {
        const locationId = p.locationId ?? fallback;
        if (!locationId) throw fieldError(`parts.${i}.locationId`, "Pilih lokasi stok suku cadang");
        return {
          productId: p.productId,
          quantity: p.quantity,
          locationId,
          lotName: p.lotName,
          path: `parts.${i}`,
        };
      });
      const result = await this.stock.consume(tx, companyId, lines, {
        ref: `${request.name} ${equipment!.name}`,
        date: finishedAt,
        expenseAccountId: await this.expenseAccount(tx, companyId),
        costCenterId: equipment!.costCenterId,
        branchId: equipment!.branchId,
      });
      partsMoveId = result.accountMoveId;
      // Nilai per baris sesuai urutan pergerakan yang dibuat.
      for (const [i, p] of parts.entries()) {
        const value = Number(result.moves[i]?.value ?? 0);
        partsCost += value;
        await tx
          .update(PT)
          .set({ cost: value.toFixed(2), locationId: lines[i]!.locationId })
          .where(eq(PT.id, p.id));
      }
    }

    const downtime =
      request.kind === "corrective"
        ? downtimeHours(request.breakdownAt ?? startedAt, finishedAt)
        : downtimeHours(startedAt, finishedAt);
    const meter = input.meter != null ? Number(input.meter) : Number(equipment!.meter);
    if (input.meter != null && meter > Number(equipment!.meter)) {
      await tx.insert(MR).values({
        equipmentId: equipment!.id,
        date: finishedAt.toISOString().slice(0, 10),
        value: meter.toFixed(1),
        createdBy: currentContext().userId,
      });
    }
    await tx
      .update(RQ)
      .set({
        state: "done",
        startedAt,
        finishedAt,
        downtimeHours: downtime.toFixed(2),
        resolution: input.resolution ?? request.resolution,
        laborHours: input.laborHours ?? request.laborHours,
        laborCost: input.laborCost ?? request.laborCost,
        ...(input.checklist ? { checklist: input.checklist } : {}),
        partsCost: partsCost.toFixed(2),
        partsMoveId,
        updatedAt: new Date(),
      })
      .where(eq(RQ.id, id));
    if (request.planId)
      await tx
        .update(PL)
        .set({
          lastDoneDate: finishedAt.toISOString().slice(0, 10),
          lastDoneMeter: meter.toFixed(1),
          updatedAt: new Date(),
        })
        .where(eq(PL.id, request.planId));
    const [open] = await tx
      .select({ id: RQ.id })
      .from(RQ)
      .where(
        and(
          eq(RQ.equipmentId, request.equipmentId),
          ne(RQ.id, id),
          or(
            eq(RQ.state, "in_progress"),
            and(
              eq(RQ.kind, "corrective"),
              sql`${RQ.breakdownAt} is not null`,
              inArray(RQ.state, ["new", "scheduled"]),
            ),
          ),
        ),
      )
      .limit(1);
    await tx
      .update(EQ)
      .set({
        ...(open || equipment!.state === "retired" ? {} : { state: "operational" as const }),
        ...(meter > Number(equipment!.meter) ? { meter: meter.toFixed(1) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(EQ.id, request.equipmentId));
    if (request.requestedBy)
      await notifyUsers(
        tx,
        companyId,
        [request.requestedBy],
        {
          title: `Perawatan ${request.name} selesai`,
          body: input.resolution ?? request.title,
          link: `/maintenance/requests/${id}`,
        },
        currentContext().userId,
      );
    return this.detail(tx, id);
  }

  async cancel(tx: Db, id: string) {
    const request = await this.find(tx, id);
    if (request.state === "done") throw new BadRequestException("Permintaan selesai tidak dapat dibatalkan");
    if (request.moveId)
      throw new BadRequestException("Permintaan yang sudah ditagihkan tidak dapat dibatalkan");
    await tx.update(RQ).set({ state: "cancelled", updatedAt: new Date() }).where(eq(RQ.id, id));
    const [open] = await tx
      .select({ id: RQ.id })
      .from(RQ)
      .where(and(eq(RQ.equipmentId, request.equipmentId), eq(RQ.state, "in_progress")))
      .limit(1);
    if (!open)
      await tx
        .update(EQ)
        .set({ state: "operational", updatedAt: new Date() })
        .where(and(eq(EQ.id, request.equipmentId), eq(EQ.state, "down")));
    return this.detail(tx, id);
  }

  async setParts(tx: Db, id: string, input: z.infer<typeof maintenancePartsSchema>) {
    const request = await this.find(tx, id);
    if (request.state === "done" || request.state === "cancelled")
      throw new BadRequestException("Suku cadang permintaan selesai/batal tidak dapat diubah");
    const ids = [...new Set(input.parts.map((p) => p.productId))];
    if (ids.length) {
      const products = await tx
        .select({
          id: schema.products.id,
          companyId: schema.products.companyId,
          type: schema.products.productType,
        })
        .from(schema.products)
        .where(inArray(schema.products.id, ids));
      input.parts.forEach((p, i) => {
        const prod = products.find((x) => x.id === p.productId);
        if (!prod || (prod.companyId && prod.companyId !== request.companyId) || prod.type === "service")
          throw fieldError(`parts.${i}.productId`, "Produk stok tidak ditemukan");
      });
    }
    for (const [i, p] of input.parts.entries()) {
      if (!p.locationId) continue;
      const [loc] = await tx
        .select({ usage: schema.stockLocations.usage, companyId: schema.stockLocations.companyId })
        .from(schema.stockLocations)
        .where(eq(schema.stockLocations.id, p.locationId));
      if (!loc || loc.companyId !== request.companyId || loc.usage !== "internal")
        throw fieldError(`parts.${i}.locationId`, "Pilih lokasi stok internal");
    }
    await tx.delete(PT).where(eq(PT.requestId, id));
    if (input.parts.length)
      await tx.insert(PT).values(
        input.parts.map((p) => ({
          requestId: id,
          productId: p.productId,
          quantity: p.quantity,
          locationId: p.locationId ?? null,
          lotName: p.lotName ?? null,
        })),
      );
    return this.detail(tx, id);
  }

  /** Tagihan vendor (draft) untuk jasa perawatan, dibebankan ke cost center/cabang/unit peralatan; sekali saja. */
  async bill(tx: Db, id: string) {
    const request = await this.find(tx, id);
    if (request.moveId) throw new BadRequestException("Tagihan untuk permintaan ini sudah dibuat");
    if (request.state === "cancelled")
      throw new BadRequestException("Permintaan batal tidak dapat ditagihkan");
    if (!request.vendorId) throw fieldError("vendorId", "Isi vendor sebelum membuat tagihan");
    if (!(Number(request.vendorCost) > 0))
      throw fieldError("vendorCost", "Biaya jasa vendor harus lebih dari 0");
    const [equipment] = await tx.select().from(EQ).where(eq(EQ.id, request.equipmentId));
    const moveId = await this.moves.createInvoice(
      tx,
      {
        moveType: "in_invoice",
        partnerId: request.vendorId,
        date: (request.finishedAt ?? new Date()).toISOString().slice(0, 10),
        dueDate: null,
        ref: `${request.name} ${equipment!.code}`,
        narration: request.title,
        lines: [
          {
            productId: null,
            accountId: await this.expenseAccount(tx, request.companyId),
            name: `Jasa perawatan ${equipment!.name} — ${request.title}`.slice(0, 250),
            quantity: "1",
            priceUnit: request.vendorCost,
            discount: "0",
            taxIds: [],
            businessUnitId: equipment!.businessUnitId,
            branchId: equipment!.branchId,
            costCenterId: equipment!.costCenterId,
            uomId: null,
          },
        ],
      },
      request.companyId,
      { invoiceOrigin: request.name },
    );
    await tx.update(RQ).set({ moveId, updatedAt: new Date() }).where(eq(RQ.id, id));
    return { moveId };
  }

  async addMeter(tx: Db, id: string, input: z.infer<typeof meterReadingSchema>) {
    const equipment = await findEquipment(tx, id);
    if (!equipment.meterUnit) throw fieldError("value", "Peralatan ini tidak memakai meter");
    if (Number(input.value) < Number(equipment.meter))
      throw fieldError("value", `Meter tidak boleh mundur (sekarang ${Number(equipment.meter)})`);
    await tx.insert(MR).values({
      equipmentId: id,
      date: input.date,
      value: input.value,
      createdBy: currentContext().userId,
    });
    await tx.update(EQ).set({ meter: input.value, updatedAt: new Date() }).where(eq(EQ.id, id));
    return { meter: input.value };
  }

  /** Rencana yang jatuh tempo → permintaan preventif (sekali per siklus). Mengembalikan jumlah yang dibuat. */
  async generateDue(tx: Db, companyId: string, date = today()) {
    const plans = await tx
      .select({ plan: PL, equipment: EQ })
      .from(PL)
      .innerJoin(EQ, eq(EQ.id, PL.equipmentId))
      .where(and(eq(EQ.companyId, companyId), eq(PL.active, true), ne(EQ.state, "retired")));
    let created = 0;
    for (const { plan, equipment } of plans) {
      const due = planDue(plan, date, equipment.meter);
      if (!due.due) continue;
      const row = await this.create(
        tx,
        {
          equipmentId: equipment.id,
          kind: "preventive",
          title: plan.name,
          description: due.byMeter ? `Jatuh tempo meter ${due.dueMeter}` : `Jatuh tempo ${due.dueDate}`,
          priority: "normal",
          teamId: plan.teamId ?? equipment.teamId,
          technicianUserId: plan.technicianUserId ?? equipment.technicianUserId,
          scheduledDate: due.byDate && due.dueDate ? due.dueDate : date,
          vendorCost: "0",
          laborCost: "0",
          resolution: null,
          planId: plan.id,
          planCycle: due.cycle,
        },
        {
          companyId,
          userId: null,
          checklist: plan.tasks.map((t) => ({ label: t.label, done: false })),
        },
      );
      if (row) created++;
    }
    return created;
  }

  /** Laporan keandalan & biaya per peralatan dalam rentang tanggal. */
  async report(tx: Db, companyId: string, from: string, to: string) {
    const equipment = await tx.select().from(EQ).where(eq(EQ.companyId, companyId)).orderBy(asc(EQ.code));
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T23:59:59.999Z`);
    const requests = await tx
      .select()
      .from(RQ)
      .where(and(eq(RQ.companyId, companyId), ne(RQ.state, "cancelled")));
    const hours = periodHours(from, to);
    const rows = equipment.map((e) => {
      const mine = requests.filter((r) => r.equipmentId === e.id);
      const failures = mine.filter(
        (r) => r.kind === "corrective" && r.breakdownAt && r.breakdownAt >= start && r.breakdownAt <= end,
      );
      const finished = mine.filter(
        (r) => r.state === "done" && r.finishedAt && r.finishedAt >= start && r.finishedAt <= end,
      );
      const downtime = finished
        .filter((r) => r.kind === "corrective")
        .reduce((s, r) => s + Number(r.downtimeHours ?? 0), 0);
      const preventive = mine.filter(
        (r) => r.kind === "preventive" && r.scheduledDate && r.scheduledDate >= from && r.scheduledDate <= to,
      );
      const onTime = preventive.filter(
        (r) =>
          r.state === "done" && r.finishedAt && r.finishedAt.toISOString().slice(0, 10) <= r.scheduledDate!,
      );
      const cost = (k: "partsCost" | "vendorCost" | "laborCost") =>
        finished.reduce((s, r) => s + Number(r[k]), 0);
      return {
        equipmentId: e.id,
        code: e.code,
        name: e.name,
        category: e.category,
        state: e.state,
        failures: failures.length,
        downtimeHours: Math.round(downtime * 100) / 100,
        ...reliability({ failures: failures.length, downtimeHours: downtime, periodHours: hours }),
        preventiveDue: preventive.length,
        preventiveOnTime: onTime.length,
        compliance: preventive.length ? Math.round((onTime.length / preventive.length) * 1000) / 10 : null,
        partsCost: cost("partsCost").toFixed(2),
        vendorCost: cost("vendorCost").toFixed(2),
        laborCost: cost("laborCost").toFixed(2),
        totalCost: (cost("partsCost") + cost("vendorCost") + cost("laborCost")).toFixed(2),
      };
    });
    const sum = (k: "failures" | "downtimeHours" | "preventiveDue" | "preventiveOnTime") =>
      rows.reduce((s, r) => s + r[k], 0);
    const totals = {
      failures: sum("failures"),
      downtimeHours: Math.round(sum("downtimeHours") * 100) / 100,
      preventiveDue: sum("preventiveDue"),
      preventiveOnTime: sum("preventiveOnTime"),
      totalCost: rows.reduce((s, r) => s + Number(r.totalCost), 0).toFixed(2),
    };
    return { from, to, rows, totals };
  }
}

// ---- Controller ----

const listQuery = z.object({
  state: z.string().optional(),
  equipmentId: z.string().uuid().optional(),
  kind: z.enum(["preventive", "corrective"]).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(500),
});
const reportQuery = z.object({ from: z.string().date(), to: z.string().date() });

@Controller()
class MaintenanceController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(MaintenanceService) private readonly svc: MaintenanceService,
  ) {}

  @Get("maintenance-requests")
  @RequirePermission("maintenance.read")
  list(@Query() query: Record<string, string>) {
    const q = parse(listQuery, query);
    return this.tenantDb.run(async (tx) => {
      const states = q.state?.split(",").filter(Boolean);
      return tx
        .select({
          id: RQ.id,
          name: RQ.name,
          title: RQ.title,
          kind: RQ.kind,
          state: RQ.state,
          priority: RQ.priority,
          scheduledDate: RQ.scheduledDate,
          breakdownAt: RQ.breakdownAt,
          finishedAt: RQ.finishedAt,
          downtimeHours: RQ.downtimeHours,
          technicianUserId: RQ.technicianUserId,
          technician: schema.users.name,
          equipmentId: RQ.equipmentId,
          equipment: EQ.name,
          equipmentCode: EQ.code,
          totalCost: sql<string>`(${RQ.partsCost} + ${RQ.vendorCost} + ${RQ.laborCost})::text`,
          custom: RQ.custom,
          createdAt: RQ.createdAt,
        })
        .from(RQ)
        .innerJoin(EQ, eq(EQ.id, RQ.equipmentId))
        .leftJoin(schema.users, eq(schema.users.id, RQ.technicianUserId))
        .where(
          and(
            eq(RQ.companyId, currentContext().companyId),
            states?.length ? inArray(RQ.state, states as Request["state"][]) : undefined,
            q.equipmentId ? eq(RQ.equipmentId, q.equipmentId) : undefined,
            q.kind ? eq(RQ.kind, q.kind) : undefined,
          ),
        )
        .orderBy(desc(RQ.createdAt))
        .limit(q.limit);
    });
  }

  @Get("maintenance-requests/:id")
  @RequirePermission("maintenance.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.svc.detail(tx, id));
  }

  @Post("maintenance-requests")
  @RequirePermission("maintenance.write")
  create(@Body() body: unknown) {
    const input = parse(maintenanceRequestSchema, body);
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const row = await this.svc.create(tx, input, { companyId: ctx.companyId, userId: ctx.userId });
      return this.svc.detail(tx, row!.id);
    });
  }

  @Put("maintenance-requests/:id")
  @RequirePermission("maintenance.write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(maintenanceRequestSchema, body);
    return this.tenantDb.run((tx) => this.svc.update(tx, id, input));
  }

  @Post("maintenance-requests/:id/start")
  @RequirePermission("maintenance.write")
  start(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.svc.start(tx, id));
  }

  @Post("maintenance-requests/:id/done")
  @RequirePermission("maintenance.write")
  done(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(maintenanceDoneSchema, body ?? {});
    return this.tenantDb.run((tx) => this.svc.done(tx, id, input));
  }

  @Post("maintenance-requests/:id/cancel")
  @RequirePermission("maintenance.write")
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.svc.cancel(tx, id));
  }

  @Put("maintenance-requests/:id/parts")
  @RequirePermission("maintenance.write")
  parts(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(maintenancePartsSchema, body);
    return this.tenantDb.run((tx) => this.svc.setParts(tx, id, input));
  }

  @Post("maintenance-requests/:id/bill")
  @RequirePermission("maintenance.manage")
  bill(@Param("id", ParseUUIDPipe) id: string) {
    if (!hasPermission(currentContext().permissions, "accounting.write"))
      throw new ForbiddenException("Membuat tagihan memerlukan hak akuntansi (tulis)");
    return this.tenantDb.run((tx) => this.svc.bill(tx, id));
  }

  @Get("equipment/:id/overview")
  @RequirePermission("maintenance.read")
  overview(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const equipment = await findEquipment(tx, id);
      const plans = await tx.select().from(PL).where(eq(PL.equipmentId, id)).orderBy(asc(PL.name));
      const readings = await tx
        .select()
        .from(MR)
        .where(eq(MR.equipmentId, id))
        .orderBy(desc(MR.date), desc(MR.createdAt))
        .limit(50);
      const requests = await tx
        .select()
        .from(RQ)
        .where(eq(RQ.equipmentId, id))
        .orderBy(desc(RQ.createdAt))
        .limit(100);
      return {
        equipment,
        plans: plans.map((p) => ({ ...p, next: planDue(p, today(), equipment.meter) })),
        readings,
        requests,
      };
    });
  }

  @Post("equipment/:id/meter")
  @RequirePermission("maintenance.write")
  meter(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(meterReadingSchema, body);
    return this.tenantDb.run((tx) => this.svc.addMeter(tx, id, input));
  }

  /** Buat permintaan preventif dari rencana yang jatuh tempo sekarang (tanpa menunggu job harian). */
  @Post("maintenance/generate")
  @RequirePermission("maintenance.manage")
  generate() {
    return this.tenantDb.run(async (tx) => ({
      created: await this.svc.generateDue(tx, currentContext().companyId),
    }));
  }

  @Get("maintenance/reports")
  @RequirePermission("maintenance.read")
  report(@Query() query: Record<string, string>) {
    const q = parse(reportQuery, query);
    if (q.to < q.from) throw fieldError("to", "Tanggal akhir sebelum tanggal awal");
    return this.tenantDb.run((tx) => this.svc.report(tx, currentContext().companyId, q.from, q.to));
  }

  @Get("maintenance/settings")
  @RequirePermission("maintenance.read")
  getSettings() {
    return this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      const s = await this.svc.settings(tx, companyId);
      return { ...s, defaultPartsLocationId: await this.svc.partsLocation(tx, companyId) };
    });
  }

  @Put("maintenance/settings")
  @RequirePermission("maintenance.manage")
  putSettings(@Body() body: unknown) {
    const input = parse(maintenanceSettingsSchema, body);
    return this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      if (input.expenseAccountId)
        await assertCompanyAccounts(tx, companyId, [
          { path: "expenseAccountId", id: input.expenseAccountId },
        ]);
      if (input.partsLocationId) {
        const [loc] = await tx
          .select()
          .from(schema.stockLocations)
          .where(eq(schema.stockLocations.id, input.partsLocationId));
        if (!loc || loc.companyId !== companyId || loc.usage !== "internal")
          throw fieldError("partsLocationId", "Pilih lokasi stok internal");
      }
      const values = {
        expenseAccountId: input.expenseAccountId ?? null,
        partsLocationId: input.partsLocationId ?? null,
      };
      await tx
        .insert(schema.maintenanceSettings)
        .values({ companyId, ...values })
        .onConflictDoUpdate({
          target: [schema.maintenanceSettings.tenantId, schema.maintenanceSettings.companyId],
          set: values,
        });
      return this.svc.settings(tx, companyId);
    });
  }
}

/** Portal: siapa pun yang login boleh melaporkan kerusakan dan melihat laporannya sendiri. */
@Controller("me/maintenance-requests")
class MyMaintenanceController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(MaintenanceService) private readonly svc: MaintenanceService,
  ) {}

  @Get()
  list() {
    return this.tenantDb.run((tx) =>
      tx
        .select({
          id: RQ.id,
          name: RQ.name,
          title: RQ.title,
          state: RQ.state,
          priority: RQ.priority,
          equipment: EQ.name,
          createdAt: RQ.createdAt,
          finishedAt: RQ.finishedAt,
          resolution: RQ.resolution,
        })
        .from(RQ)
        .innerJoin(EQ, eq(EQ.id, RQ.equipmentId))
        .where(and(eq(RQ.requestedBy, currentContext().userId), eq(RQ.companyId, currentContext().companyId)))
        .orderBy(desc(RQ.createdAt))
        .limit(100),
    );
  }

  @Get("equipment")
  equipment() {
    return this.tenantDb.run((tx) =>
      tx
        .select({ id: EQ.id, code: EQ.code, name: EQ.name, location: EQ.location, state: EQ.state })
        .from(EQ)
        .where(and(eq(EQ.companyId, currentContext().companyId), ne(EQ.state, "retired")))
        .orderBy(asc(EQ.code)),
    );
  }

  @Post()
  report(@Body() body: unknown) {
    const input = parse(breakdownReportSchema, body);
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const row = await this.svc.create(
        tx,
        {
          equipmentId: input.equipmentId,
          kind: "corrective",
          title: input.title,
          description: input.description,
          priority: input.priority,
          vendorCost: "0",
          laborCost: "0",
          resolution: null,
          stopped: input.stopped,
        },
        { companyId: ctx.companyId, userId: ctx.userId },
      );
      return { id: row!.id, name: row!.name };
    });
  }
}

/** Job harian: rencana jatuh tempo → permintaan preventif (sekali per siklus) + notifikasi tim. */
@Injectable()
export class MaintenanceScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Maintenance");
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(MaintenanceService) private readonly svc: MaintenanceService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.maintenance.scheduler) return;
    this.timer = setInterval(
      () =>
        void this.runDue().catch((e: unknown) => {
          this.logger.error(e);
          reportError(e, { job: "maintenance" });
        }),
      60 * 60_000,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  async runDue(date = today(), tenantIds?: string[]) {
    const tenants =
      tenantIds ??
      (await this.ownerDb.selectDistinct({ id: PL.tenantId }).from(PL).where(eq(PL.active, true))).map(
        (t) => t.id,
      );
    let created = 0;
    for (const tenantId of tenants) {
      created += await this.tenantDb
        .runAs(tenantId, async (tx) => {
          let n = 0;
          const companies = await tx.selectDistinct({ id: EQ.companyId }).from(EQ);
          for (const c of companies) n += await this.svc.generateDue(tx, c.id, date);
          return n;
        })
        .catch((e: unknown) => {
          this.logger.warn(`Maintenance tenant ${tenantId}: ${(e as Error).message}`);
          return 0;
        });
    }
    return created;
  }
}

@Module({
  imports: [AccountingModule, InventoryModule],
  controllers: [
    TeamsController,
    EquipmentController,
    PlansController,
    MaintenanceController,
    MyMaintenanceController,
  ],
  providers: [MaintenanceService, MaintenanceScheduler, SequenceService, ActivityService],
  exports: [MaintenanceScheduler],
})
export class MaintenanceModule {}
