import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, schema, sql, type Db } from "@erp/db";
import { landedCostSchema, splitLandedCost, splitStockVsSold, type LandedCostSplit } from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { AccountingModule } from "../accounting/accounting.module.js";
import { assertCompanyAccounts, fieldError, loadBooks } from "../accounting/context.js";
import { MoveService } from "../accounting/move.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { InventoryModule } from "./inventory.module.js";
import { StockService } from "./stock.service.js";

type Input = z.infer<typeof landedCostSchema>;
const LC = schema.landedCosts;
const LINE = schema.landedCostLines;
const ADJ = schema.landedCostAdjustments;
const P = schema.stockPickings;
const SM = schema.stockMoves;
const SVL = schema.stockValuationLayers;
const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

@Injectable()
export class LandedCostService {
  constructor(
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(MoveService) private readonly moves: MoveService,
    @Inject(StockService) private readonly stock: StockService,
  ) {}

  private async find(tx: Db, id: string, lock = false) {
    const q = tx
      .select()
      .from(LC)
      .where(and(eq(LC.id, id), eq(LC.companyId, currentContext().companyId)));
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw new NotFoundException("Landed cost tidak ditemukan");
    return row;
  }

  /** Pergerakan masuk (barang stok, selesai) dari penerimaan terpilih beserta lapisan valuasinya. */
  private async incomingMoves(tx: Db, companyId: string, pickingIds: string[]) {
    if (!pickingIds.length) return [];
    return tx
      .select({
        id: SM.id,
        pickingId: SM.pickingId,
        pickingName: P.name,
        productId: SM.productId,
        productName: schema.products.name,
        sku: schema.products.sku,
        quantity: SM.quantityDone,
        value: SM.value,
        weight: schema.products.weight,
        volume: schema.products.volume,
        layerId: SVL.id,
        layerQty: SVL.quantity,
        remainingQty: SVL.remainingQty,
      })
      .from(SM)
      .innerJoin(P, eq(P.id, SM.pickingId))
      .innerJoin(schema.products, eq(schema.products.id, SM.productId))
      .innerJoin(SVL, and(eq(SVL.stockMoveId, SM.id), sql`${SVL.quantity} > 0`))
      .where(
        and(
          inArray(SM.pickingId, pickingIds),
          eq(SM.companyId, companyId),
          eq(SM.state, "done"),
          eq(schema.products.productType, "storable"),
        ),
      )
      .orderBy(asc(P.name), asc(schema.products.sku));
  }

  private async validate(tx: Db, companyId: string, input: Input) {
    const pickings = await tx
      .select({ id: P.id, type: P.pickingType, state: P.state })
      .from(P)
      .where(and(inArray(P.id, input.pickingIds), eq(P.companyId, companyId)));
    input.pickingIds.forEach((id, i) => {
      const p = pickings.find((x) => x.id === id);
      if (!p || p.type !== "incoming" || p.state !== "done")
        throw fieldError(`pickingIds.${i}`, "Penerimaan tidak ditemukan atau belum selesai");
    });
    await assertCompanyAccounts(
      tx,
      companyId,
      input.lines.map((l, i) => ({ path: `lines.${i}.accountId`, id: l.accountId })),
    );
    if (input.vendorBillId) {
      const [bill] = await tx
        .select({ id: schema.accountMoves.id })
        .from(schema.accountMoves)
        .where(
          and(
            eq(schema.accountMoves.id, input.vendorBillId),
            eq(schema.accountMoves.companyId, companyId),
            eq(schema.accountMoves.moveType, "in_invoice"),
          ),
        );
      if (!bill) throw fieldError("vendorBillId", "Tagihan pemasok tidak ditemukan");
    }
  }

  private async save(tx: Db, id: string, input: Input) {
    await tx.delete(schema.landedCostPickings).where(eq(schema.landedCostPickings.landedCostId, id));
    await tx.delete(LINE).where(eq(LINE.landedCostId, id));
    await tx
      .insert(schema.landedCostPickings)
      .values(input.pickingIds.map((pickingId) => ({ landedCostId: id, pickingId })));
    await tx.insert(LINE).values(
      input.lines.map((l, i) => ({
        landedCostId: id,
        sequence: i,
        name: l.name,
        accountId: l.accountId,
        amount: l.amount,
        splitMethod: l.splitMethod,
      })),
    );
  }

  async create(tx: Db, body: unknown) {
    const input = parse(landedCostSchema, body);
    const companyId = currentContext().companyId;
    await this.validate(tx, companyId, input);
    const name = await this.sequences.next(
      tx,
      "landed.cost",
      companyId,
      new Date(`${input.date}T12:00:00`),
      "LC",
    );
    const [row] = await tx
      .insert(LC)
      .values({
        companyId,
        name,
        date: input.date,
        vendorBillId: input.vendorBillId ?? null,
        note: input.note ?? null,
        createdBy: currentContext().userId,
      })
      .returning({ id: LC.id });
    await this.save(tx, row!.id, input);
    return this.detail(tx, row!.id);
  }

  async update(tx: Db, id: string, body: unknown) {
    const lc = await this.find(tx, id);
    if (lc.state !== "draft") throw new BadRequestException("Hanya landed cost draft yang bisa diubah");
    const input = parse(landedCostSchema, body);
    await this.validate(tx, lc.companyId, input);
    await tx
      .update(LC)
      .set({
        date: input.date,
        vendorBillId: input.vendorBillId ?? null,
        note: input.note ?? null,
        updatedAt: sql`now()`,
      })
      .where(eq(LC.id, id));
    await this.save(tx, id, input);
    return this.detail(tx, id);
  }

  async remove(tx: Db, id: string) {
    const lc = await this.find(tx, id);
    if (lc.state === "posted")
      throw new BadRequestException("Landed cost terposting tidak bisa dihapus; batalkan dulu");
    await tx.delete(LC).where(eq(LC.id, id));
  }

  /** Pembagian setiap baris biaya ke barang (pratinjau atau dasar posting). */
  private async compute(tx: Db, lc: typeof LC.$inferSelect) {
    const pickingIds = (
      await tx
        .select({ id: schema.landedCostPickings.pickingId })
        .from(schema.landedCostPickings)
        .where(eq(schema.landedCostPickings.landedCostId, lc.id))
    ).map((r) => r.id);
    const lines = await tx
      .select()
      .from(LINE)
      .where(eq(LINE.landedCostId, lc.id))
      .orderBy(asc(LINE.sequence));
    const moves = await this.incomingMoves(tx, lc.companyId, pickingIds);
    const errors: string[] = [];
    const parts: {
      lineId: string;
      moveId: string;
      basis: Decimal;
      addition: Decimal;
      stock: Decimal;
      sold: Decimal;
    }[] = [];
    if (!moves.length) errors.push("Penerimaan terpilih tidak memuat barang stok yang tervaluasi");
    for (const line of lines) {
      if (!moves.length) break;
      try {
        for (const s of splitLandedCost(
          line.amount,
          moves.map((m) => ({ ...m, value: m.value ?? "0" })),
          line.splitMethod as LandedCostSplit,
        )) {
          const move = moves.find((m) => m.id === s.moveId)!;
          const portion = splitStockVsSold(s.addition, move.layerQty, move.remainingQty);
          parts.push({ lineId: line.id, moveId: s.moveId, basis: s.basis, addition: s.addition, ...portion });
        }
      } catch (e) {
        errors.push(`${line.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const products = moves.map((m) => {
      const mine = parts.filter((p) => p.moveId === m.id);
      const addition = mine.reduce((s, p) => s.plus(p.addition), d(0));
      return {
        moveId: m.id,
        pickingName: m.pickingName,
        productId: m.productId,
        productName: m.productName,
        sku: m.sku,
        quantity: d(m.quantity).toFixed(4),
        remainingQty: d(m.remainingQty).toFixed(4),
        value: d(m.value).toFixed(2),
        addition: addition.toFixed(2),
        stockPortion: mine.reduce((s, p) => s.plus(p.stock), d(0)).toFixed(2),
        soldPortion: mine.reduce((s, p) => s.plus(p.sold), d(0)).toFixed(2),
        newUnitCost: d(m.quantity).gt(0) ? d(m.value).plus(addition).div(m.quantity).toFixed(4) : null,
      };
    });
    return { pickingIds, lines, moves, parts, products, errors };
  }

  async detail(tx: Db, id: string) {
    const lc = await this.find(tx, id);
    const c = await this.compute(tx, lc);
    const pickings = c.pickingIds.length
      ? await tx
          .select({ id: P.id, name: P.name, origin: P.origin, dateDone: P.dateDone })
          .from(P)
          .where(inArray(P.id, c.pickingIds))
      : [];
    const [move] = lc.moveId
      ? await tx
          .select({ id: schema.accountMoves.id, name: schema.accountMoves.name })
          .from(schema.accountMoves)
          .where(eq(schema.accountMoves.id, lc.moveId))
      : [];
    const posted = lc.state === "posted" ? await tx.select().from(ADJ).where(eq(ADJ.landedCostId, id)) : [];
    return {
      ...lc,
      total: c.lines.reduce((s, l) => s.plus(l.amount), d(0)).toFixed(2),
      pickings,
      lines: c.lines,
      products: c.products,
      errors: c.errors,
      accountMove: move ?? null,
      adjustments: posted,
    };
  }

  async list(tx: Db) {
    const rows = await tx
      .select({
        id: LC.id,
        name: LC.name,
        date: LC.date,
        state: LC.state,
        total: sql<string>`coalesce((select sum(amount) from landed_cost_lines l where l.landed_cost_id = ${LC.id}), 0)::text`,
        pickings: sql<string>`(select string_agg(p.name, ', ') from landed_cost_pickings x join stock_pickings p on p.id = x.picking_id where x.landed_cost_id = ${LC.id})`,
      })
      .from(LC)
      .where(eq(LC.companyId, currentContext().companyId))
      .orderBy(desc(LC.date), desc(LC.createdAt))
      .limit(5000);
    return rows;
  }

  /**
   * Posting: porsi untuk barang yang masih di gudang menambah nilai lapisan valuasi (dan biaya rata-rata), porsi
   * barang yang sudah keluar dibebankan ke HPP. Jurnal: Dr persediaan + Dr HPP / Cr akun lawan per baris biaya.
   */
  async post(tx: Db, id: string) {
    const lc = await this.find(tx, id, true); // dikunci: posting ganda membuat dua jurnal & penyesuaian lapisan
    if (lc.state !== "draft") throw new BadRequestException("Landed cost sudah diposting atau dibatalkan");
    const c = await this.compute(tx, lc);
    if (c.errors.length) throw new BadRequestException(c.errors.join("; "));
    const books = await loadBooks(tx, lc.companyId);
    const s = books.settings;
    if (!s.stockValuationAccountId || !s.cogsAccountId)
      throw new BadRequestException("Akun persediaan belum diatur di pengaturan akuntansi");
    const stockTotal = c.parts.reduce((sum, p) => sum.plus(p.stock), d(0));
    const soldTotal = c.parts.reduce((sum, p) => sum.plus(p.sold), d(0));
    const entryLines = [
      ...(stockTotal.gt(0)
        ? [
            {
              accountId: s.stockValuationAccountId,
              name: `${lc.name} — persediaan`,
              debit: stockTotal.toFixed(2),
              credit: "0",
            },
          ]
        : []),
      ...(soldTotal.gt(0)
        ? [
            {
              accountId: s.cogsAccountId,
              name: `${lc.name} — barang sudah keluar`,
              debit: soldTotal.toFixed(2),
              credit: "0",
            },
          ]
        : []),
      ...c.lines.map((l) => ({
        accountId: l.accountId,
        name: `${lc.name} — ${l.name}`,
        debit: "0",
        credit: d(l.amount).toFixed(2),
      })),
    ];
    const moveId = await this.moves.createEntry(
      tx,
      {
        journalId: s.stockJournalId ?? s.generalJournalId,
        date: lc.date,
        ref: `Landed cost ${lc.name}`,
        lines: entryLines,
      },
      lc.companyId,
    );
    await this.moves.post(tx, moveId);
    for (const m of c.moves) {
      const stock = c.parts.filter((p) => p.moveId === m.id).reduce((sum, p) => sum.plus(p.stock), d(0));
      await this.stock.adjustLayerValue(
        tx,
        lc.companyId,
        m.productId,
        m.layerId,
        stock,
        `Landed cost ${lc.name}`,
        moveId,
      );
    }
    await tx.insert(ADJ).values(
      c.parts.map((p) => {
        const m = c.moves.find((x) => x.id === p.moveId)!;
        return {
          landedCostId: id,
          lineId: p.lineId,
          stockMoveId: p.moveId,
          productId: m.productId,
          layerId: m.layerId,
          basis: p.basis.toFixed(6),
          addition: p.addition.toFixed(2),
          stockPortion: p.stock.toFixed(2),
          soldPortion: p.sold.toFixed(2),
          remainingQtyAtPost: d(m.remainingQty).toFixed(4),
        };
      }),
    );
    await tx
      .update(LC)
      .set({ state: "posted", moveId, postedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(LC.id, id));
    return this.detail(tx, id);
  }

  /** Batal: hanya bila barang yang menanggung belum keluar lagi sejak posting (sisa kuantitas lapisan sama). */
  async cancel(tx: Db, id: string) {
    const lc = await this.find(tx, id);
    if (lc.state === "draft") {
      await tx
        .update(LC)
        .set({ state: "cancel", updatedAt: sql`now()` })
        .where(eq(LC.id, id));
      return this.detail(tx, id);
    }
    if (lc.state !== "posted" || !lc.moveId) throw new BadRequestException("Landed cost sudah dibatalkan");
    const adjustments = await tx.select().from(ADJ).where(eq(ADJ.landedCostId, id));
    const byLayer = new Map<string, { productId: string; stock: Decimal; remainingAtPost: string }>();
    for (const a of adjustments) {
      if (!a.layerId) continue;
      const cur = byLayer.get(a.layerId) ?? {
        productId: a.productId,
        stock: d(0),
        remainingAtPost: a.remainingQtyAtPost,
      };
      cur.stock = cur.stock.plus(a.stockPortion);
      byLayer.set(a.layerId, cur);
    }
    for (const [layerId, x] of byLayer) {
      const [layer] = await tx
        .select({ remainingQty: SVL.remainingQty })
        .from(SVL)
        .where(eq(SVL.id, layerId));
      if (!layer || !d(layer.remainingQty).equals(x.remainingAtPost))
        throw new BadRequestException(
          "Barang yang menanggung landed cost ini sudah keluar sejak diposting; buat koreksi dengan landed cost baru",
        );
    }
    const reversal = await this.moves.reverse(tx, lc.moveId);
    for (const [layerId, x] of byLayer)
      await this.stock.adjustLayerValue(
        tx,
        lc.companyId,
        x.productId,
        layerId,
        x.stock.negated(),
        `Batal landed cost ${lc.name}`,
        reversal.id,
      );
    await tx
      .update(LC)
      .set({ state: "cancel", reversalMoveId: reversal.id, updatedAt: sql`now()` })
      .where(eq(LC.id, id));
    return this.detail(tx, id);
  }

  /**
   * Draf dari tagihan jasa (angkut/bea): baris tagihan menjadi baris biaya (akun lawan = akun baris tagihan),
   * penerimaan diambil dari PO yang disebut di referensi tagihan bila ada.
   */
  async fromBill(tx: Db, billId: string, body: unknown) {
    const companyId = currentContext().companyId;
    const [bill] = await tx
      .select()
      .from(schema.accountMoves)
      .where(and(eq(schema.accountMoves.id, billId), eq(schema.accountMoves.companyId, companyId)));
    if (!bill || bill.moveType !== "in_invoice" || bill.state !== "posted")
      throw new BadRequestException("Tagihan pemasok terposting tidak ditemukan");
    const lines = await tx
      .select({
        name: schema.accountMoveLines.name,
        accountId: schema.accountMoveLines.accountId,
        amount: schema.accountMoveLines.debit,
      })
      .from(schema.accountMoveLines)
      .where(
        and(eq(schema.accountMoveLines.moveId, billId), eq(schema.accountMoveLines.displayType, "product")),
      );
    const pickingIds = ((body as { pickingIds?: string[] } | null)?.pickingIds ?? []).filter(Boolean);
    return this.create(tx, {
      date: bill.date,
      vendorBillId: billId,
      pickingIds,
      note: `Dari tagihan ${bill.name ?? ""}`,
      lines: lines
        .filter((l) => d(l.amount).gt(0))
        .map((l) => ({
          name: l.name ?? "Biaya",
          accountId: l.accountId,
          amount: d(l.amount).toFixed(2),
          splitMethod: "value",
        })),
    });
  }
}

@Controller()
export class LandedCostController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(LandedCostService) private readonly service: LandedCostService,
  ) {}

  @Get("landed-costs")
  @RequirePermission("inventory.read")
  list() {
    return this.tenantDb.run((tx) => this.service.list(tx));
  }

  @Post("landed-costs")
  @RequirePermission("inventory.manage")
  create(@Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.create(tx, body));
  }

  @Post("landed-costs/from-bill/:billId")
  @RequirePermission("inventory.manage")
  fromBill(@Param("billId", ParseUUIDPipe) billId: string, @Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.fromBill(tx, billId, body));
  }

  @Get("landed-costs/:id")
  @RequirePermission("inventory.read")
  detail(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.detail(tx, id));
  }

  @Put("landed-costs/:id")
  @RequirePermission("inventory.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.update(tx, id, body));
  }

  @Delete("landed-costs/:id")
  @HttpCode(204)
  @RequirePermission("inventory.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.service.remove(tx, id));
  }

  @Post("landed-costs/:id/post")
  @HttpCode(200)
  @RequirePermission("accounting.post")
  post(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.post(tx, id));
  }

  @Post("landed-costs/:id/cancel")
  @HttpCode(200)
  @RequirePermission("inventory.manage")
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.cancel(tx, id));
  }
}

@Module({
  imports: [AccountingModule, InventoryModule],
  controllers: [LandedCostController],
  providers: [LandedCostService, SequenceService],
})
export class LandedCostModule {}
