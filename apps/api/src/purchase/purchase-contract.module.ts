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
  Query,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, or, isNull, schema, sql, type Db } from "@erp/db";
import {
  contractCommitmentValue,
  contractDisplayState,
  contractOrderSchema,
  contractUsage,
  purchaseContractSchema,
  type PurchaseContractInput,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import { AccountingModule } from "../accounting/accounting.module.js";
import { assertPartner, fieldError, loadBooks } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { assertPaymentTerm } from "../crm/checks.js";
import { ApprovalEngineService } from "../hr/approval-engine.service.js";
import { HrModule } from "../hr/hr.module.js";
import { uomRatio } from "../master/uom.js";
import { assertNotTemplate } from "../master/variant.service.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { contractLines, lineInfo, orderedLines, type Contract } from "./contract-check.js";
import { PurchaseModule } from "./purchase.module.js";
import { PurchaseOrderService } from "./purchase-order.service.js";
import { systemCategoryId } from "../hr/approval-categories.registry.js";

const C = schema.purchaseContracts;
const CL = schema.purchaseContractLines;
const REQ = schema.approvalRequests;
const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const today = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class PurchaseContractService {
  constructor(
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(ApprovalEngineService) private readonly approvals: ApprovalEngineService,
    @Inject(PurchaseOrderService) private readonly orders: PurchaseOrderService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  private async find(tx: Db, id: string, lock = false): Promise<Contract> {
    const query = tx
      .select()
      .from(C)
      .where(and(eq(C.id, id), eq(C.companyId, currentContext().companyId)));
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw new NotFoundException("Kontrak pembelian tidak ditemukan");
    return this.sync(tx, row);
  }

  /** Status mengikuti permintaan persetujuan: disetujui → aktif; ditolak → refused; dibatalkan → draft. */
  private async sync(tx: Db, c: Contract): Promise<Contract> {
    if (c.state !== "in_approval" || !c.approvalRequestId) return c;
    const [req] = await tx.select({ state: REQ.state }).from(REQ).where(eq(REQ.id, c.approvalRequestId));
    const next =
      req?.state === "approved"
        ? "active"
        : req?.state === "refused"
          ? "refused"
          : req?.state === "cancel"
            ? "draft"
            : null;
    if (!next) return c;
    const [row] = await tx
      .update(C)
      .set({
        state: next,
        ...(next === "active" ? { activatedAt: sql`now()` } : {}),
        ...(next === "draft" ? { approvalRequestId: null } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(C.id, c.id))
      .returning();
    return row!;
  }

  private async prepare(tx: Db, input: PurchaseContractInput) {
    const companyId = currentContext().companyId;
    const books = await loadBooks(tx, companyId);
    const partner = await assertPartner(tx, companyId, input.partnerId);
    const paymentTermId = input.paymentTermId === undefined ? partner.paymentTermId : input.paymentTermId;
    if (paymentTermId) await assertPaymentTerm(tx, paymentTermId);
    const currencyCode = input.currencyCode ?? books.currencyCode;
    const [currency] = await tx
      .select({ code: schema.currencies.code })
      .from(schema.currencies)
      .where(eq(schema.currencies.code, currencyCode));
    if (!currency) throw fieldError("currencyCode", "Mata uang tidak dikenal");
    const productIds = input.lines.map((l) => l.productId);
    const products = await tx
      .select()
      .from(schema.products)
      .where(
        and(
          inArray(schema.products.id, productIds),
          or(isNull(schema.products.companyId), eq(schema.products.companyId, companyId)),
        ),
      );
    const taxIds = [...new Set(input.lines.flatMap((l) => l.taxIds ?? []))];
    const taxes = taxIds.length
      ? await tx.select().from(schema.taxes).where(inArray(schema.taxes.id, taxIds))
      : [];
    const lines = [];
    for (const [i, l] of input.lines.entries()) {
      const product = products.find((p) => p.id === l.productId);
      if (!product) throw fieldError(`lines.${i}.productId`, "Produk tidak ditemukan");
      assertNotTemplate(product, `lines.${i}.productId`);
      for (const t of l.taxIds ?? []) {
        const tax = taxes.find((x) => x.id === t);
        if (!tax || tax.companyId !== companyId || tax.typeTaxUse !== "purchase" || !tax.active)
          throw fieldError(`lines.${i}.taxIds`, "Pajak tidak ditemukan atau bukan pajak pembelian");
      }
      const uomId = l.uomId ?? product.purchaseUomId ?? product.uomId;
      const ratio = await uomRatio(tx, product.uomId, uomId, `lines.${i}.uomId`);
      lines.push({
        sequence: i,
        productId: product.id,
        name: l.name || product.name,
        quantity: d(l.quantity).toFixed(4),
        uomId,
        uomRatio: ratio.toFixed(6),
        priceUnit: d(l.priceUnit).toFixed(4),
        discount: d(l.discount).toFixed(4),
        taxIds:
          l.taxIds ?? (books.settings.defaultPurchaseTaxId ? [books.settings.defaultPurchaseTaxId] : []),
        minOrderQty: l.minOrderQty ? d(l.minOrderQty).toFixed(4) : null,
      });
    }
    return {
      header: {
        partnerId: partner.id,
        partnerRef: input.partnerRef ?? null,
        dateStart: input.dateStart,
        dateEnd: input.dateEnd,
        currencyCode,
        paymentTermId,
        valueLimit: input.valueLimit ? d(input.valueLimit).toFixed(2) : null,
        note: input.note ?? null,
      },
      lines,
    };
  }

  async create(tx: Db, body: unknown) {
    const input = parse(purchaseContractSchema, body);
    const companyId = currentContext().companyId;
    const { header, lines } = await this.prepare(tx, input);
    const name = await this.sequences.next(
      tx,
      "purchase.contract",
      companyId,
      new Date(`${input.dateStart}T00:00:00Z`),
      "PK",
    );
    const [row] = await tx
      .insert(C)
      .values({ ...header, companyId, name, createdBy: currentContext().userId })
      .returning({ id: C.id });
    await tx.insert(CL).values(lines.map((l) => ({ ...l, contractId: row!.id })));
    await this.activity.log(tx, { resModel: "purchase_contract", resId: row!.id, action: "create" });
    return this.detail(tx, row!.id);
  }

  async update(tx: Db, id: string, body: unknown) {
    const contract = await this.find(tx, id, true);
    if (contract.state !== "draft") throw new BadRequestException("Hanya kontrak draft yang bisa diubah");
    const input = parse(purchaseContractSchema, body);
    const { header, lines } = await this.prepare(tx, input);
    await tx
      .update(C)
      .set({ ...header, updatedAt: sql`now()` })
      .where(eq(C.id, id));
    await tx.delete(CL).where(eq(CL.contractId, id));
    await tx.insert(CL).values(lines.map((l) => ({ ...l, contractId: id })));
    await this.activity.log(tx, { resModel: "purchase_contract", resId: id, action: "update" });
    return this.detail(tx, id);
  }

  async remove(tx: Db, id: string) {
    const contract = await this.find(tx, id, true);
    if (!["draft", "cancel", "refused"].includes(contract.state))
      throw new BadRequestException("Hanya kontrak draft, batal, atau ditolak yang bisa dihapus");
    const [used] = await tx
      .select({ id: schema.purchaseOrders.id })
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.contractId, id))
      .limit(1);
    if (used) throw new BadRequestException("Kontrak sudah dipakai PO; batalkan saja");
    await tx.delete(C).where(eq(C.id, id));
    await this.activity.log(tx, { resModel: "purchase_contract", resId: id, action: "delete" });
  }

  /** Ringkasan realisasi kontrak (kuantitas & nilai) dari PO terkonfirmasi / menunggu persetujuan. */
  private async usage(tx: Db, contract: Contract) {
    const lines = await contractLines(tx, contract.id);
    const ordered = await orderedLines(tx, contract.id);
    const usage = contractUsage(
      lines.map(lineInfo),
      ordered.map((o) => ({
        contractLineId: o.contractLineId!,
        quantity: o.quantity,
        uomRatio: o.uomRatio,
        priceSubtotal: o.priceSubtotal,
      })),
    );
    const committedValue = contractCommitmentValue(lines);
    const qtyCommitted = usage.lines.reduce((s, u) => s.plus(u.committed), new Decimal(0));
    const qtyOrdered = usage.lines.reduce((s, u) => s.plus(u.ordered), new Decimal(0));
    const limit = contract.valueLimit ?? committedValue;
    return {
      lines,
      ordered,
      usage,
      committedValue,
      orderedValue: usage.value,
      qtyPct: qtyCommitted.isZero()
        ? 0
        : qtyOrdered.div(qtyCommitted).times(100).toDecimalPlaces(1).toNumber(),
      valuePct: d(limit).isZero() ? 0 : d(usage.value).div(limit).times(100).toDecimalPlaces(1).toNumber(),
    };
  }

  private view(contract: Contract) {
    return { ...contract, state: contractDisplayState(contract.state, contract.dateEnd, today()) };
  }

  async list(tx: Db, query: { partnerId?: string; state?: string }) {
    const companyId = currentContext().companyId;
    const rows = await tx
      .select({ c: C, partnerName: schema.partners.name })
      .from(C)
      .innerJoin(schema.partners, eq(schema.partners.id, C.partnerId))
      .where(and(eq(C.companyId, companyId), query.partnerId ? eq(C.partnerId, query.partnerId) : undefined))
      .orderBy(desc(C.dateStart), desc(C.createdAt))
      .limit(5000);
    const out = [];
    for (const r of rows) {
      const c = await this.sync(tx, r.c);
      const u = await this.usage(tx, c);
      const view = this.view(c);
      if (query.state && view.state !== query.state) continue;
      out.push({
        ...view,
        partnerName: r.partnerName,
        committedValue: u.committedValue,
        orderedValue: u.orderedValue,
        qtyPct: u.qtyPct,
        valuePct: u.valuePct,
        daysLeft: Math.round((Date.parse(c.dateEnd) - Date.parse(today())) / 86_400_000),
      });
    }
    return out;
  }

  async detail(tx: Db, id: string) {
    const contract = await this.find(tx, id);
    const u = await this.usage(tx, contract);
    const products = u.lines.length
      ? await tx
          .select({ id: schema.products.id, name: schema.products.name, sku: schema.products.sku })
          .from(schema.products)
          .where(
            inArray(
              schema.products.id,
              u.lines.map((l) => l.productId),
            ),
          )
      : [];
    const uoms = await tx.select({ id: schema.uoms.id, name: schema.uoms.name }).from(schema.uoms);
    const [extra] = await tx
      .select({ partnerName: schema.partners.name, paymentTermName: schema.paymentTerms.name })
      .from(C)
      .innerJoin(schema.partners, eq(schema.partners.id, C.partnerId))
      .leftJoin(schema.paymentTerms, eq(schema.paymentTerms.id, C.paymentTermId))
      .where(eq(C.id, id));
    const orders = await tx
      .select({
        id: schema.purchaseOrders.id,
        name: schema.purchaseOrders.name,
        state: schema.purchaseOrders.state,
        dateOrder: schema.purchaseOrders.dateOrder,
        amountUntaxed: schema.purchaseOrders.amountUntaxed,
        contractWarning: schema.purchaseOrders.contractWarning,
      })
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.contractId, id))
      .orderBy(desc(schema.purchaseOrders.dateOrder));
    let approval = null;
    if (contract.approvalRequestId) {
      const [req] = await tx
        .select({ id: REQ.id, number: REQ.number, state: REQ.state })
        .from(REQ)
        .where(eq(REQ.id, contract.approvalRequestId));
      approval = req ?? null;
    }
    return {
      ...this.view(contract),
      ...extra,
      committedValue: u.committedValue,
      orderedValue: u.orderedValue,
      qtyPct: u.qtyPct,
      valuePct: u.valuePct,
      approval,
      lines: u.lines.map((l) => {
        const use = u.usage.lines.find((x) => x.id === l.id)!;
        const product = products.find((p) => p.id === l.productId);
        return {
          ...l,
          productName: product?.name ?? null,
          sku: product?.sku ?? null,
          uomName: uoms.find((x) => x.id === l.uomId)?.name ?? null,
          ordered: use.ordered,
          remaining: use.remaining,
          pct: use.pct,
        };
      }),
      orders,
    };
  }

  async submit(tx: Db, id: string) {
    const contract = await this.find(tx, id, true);
    if (contract.state !== "draft") throw new BadRequestException("Kontrak sudah diajukan");
    const detail = await this.detail(tx, id);
    const categoryId = await this.category(tx, contract.companyId);
    const amount = Decimal.max(d(detail.committedValue), d(contract.valueLimit)).toFixed(2);
    const request = await this.approvals.createRequest(tx, {
      categoryId,
      subject: `Kontrak pembelian ${contract.name} — ${detail.partnerName}`,
      reference: contract.name,
      location: null,
      contact: null,
      date: contract.dateStart,
      quantity: String(detail.lines.length),
      amount,
      description: [
        `Pemasok ${detail.partnerName}, periode ${contract.dateStart} s.d. ${contract.dateEnd}, mata uang ${contract.currencyCode}.`,
        contract.valueLimit ? `Plafon nilai ${contract.valueLimit}.` : "Tanpa plafon nilai.",
        ...detail.lines.map(
          (l) => `- ${l.name}: ${d(l.quantity).toString()} ${l.uomName ?? ""} @ ${d(l.priceUnit).toString()}`,
        ),
      ]
        .join("\n")
        .slice(0, 5000),
    });
    await this.approvals.submit(tx, request.id);
    await tx
      .update(C)
      .set({ state: "in_approval", approvalRequestId: request.id, updatedAt: sql`now()` })
      .where(eq(C.id, id));
    await this.activity.log(tx, {
      resModel: "purchase_contract",
      resId: id,
      action: "update",
      message: "Diajukan untuk persetujuan",
    });
    return this.detail(tx, id);
  }

  async cancel(tx: Db, id: string) {
    const contract = await this.find(tx, id, true);
    if (contract.state !== "draft" && contract.state !== "in_approval")
      throw new BadRequestException(
        "Hanya kontrak draft atau yang menunggu persetujuan yang bisa dibatalkan",
      );
    if (contract.state === "in_approval" && contract.approvalRequestId) {
      const [req] = await tx
        .select({ state: REQ.state })
        .from(REQ)
        .where(eq(REQ.id, contract.approvalRequestId));
      if (req && (req.state === "draft" || req.state === "submitted"))
        await this.approvals.cancel(tx, contract.approvalRequestId);
    }
    await tx
      .update(C)
      .set({ state: "cancel", updatedAt: sql`now()` })
      .where(eq(C.id, id));
    return this.detail(tx, id);
  }

  async close(tx: Db, id: string) {
    const contract = await this.find(tx, id, true);
    if (contract.state !== "active") throw new BadRequestException("Hanya kontrak aktif yang bisa ditutup");
    await tx
      .update(C)
      .set({ state: "closed", closedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(C.id, id));
    await this.activity.log(tx, {
      resModel: "purchase_contract",
      resId: id,
      action: "update",
      message: "Kontrak ditutup",
    });
    return this.detail(tx, id);
  }

  async toDraft(tx: Db, id: string) {
    const contract = await this.find(tx, id, true);
    if (contract.state !== "cancel" && contract.state !== "refused")
      throw new BadRequestException("Hanya kontrak batal atau ditolak yang bisa dikembalikan ke draft");
    await tx
      .update(C)
      .set({ state: "draft", approvalRequestId: null, updatedAt: sql`now()` })
      .where(eq(C.id, id));
    return this.detail(tx, id);
  }

  /** Buat RFQ dari kontrak aktif dengan harga, diskon, pajak & satuan kontrak. */
  async createOrder(tx: Db, id: string, body: unknown) {
    const input = parse(contractOrderSchema, body);
    const contract = await this.find(tx, id);
    if (contract.state !== "active") throw new BadRequestException("Kontrak belum aktif atau sudah ditutup");
    const lines = await contractLines(tx, id);
    const order = await this.orders.create(tx, {
      partnerId: contract.partnerId,
      partnerRef: contract.partnerRef,
      dateOrder: input.dateOrder ?? today(),
      currencyCode: contract.currencyCode,
      paymentTermId: contract.paymentTermId,
      warehouseId: input.warehouseId ?? null,
      contractId: contract.id,
      lines: input.lines.map((l, i) => {
        const line = lines.find((c) => c.id === l.contractLineId);
        if (!line) throw fieldError(`lines.${i}.contractLineId`, "Baris kontrak tidak ditemukan");
        return {
          productId: line.productId,
          name: line.name,
          quantity: d(l.quantity).toFixed(4),
          contractLineId: line.id,
          uomId: line.uomId,
          discount: line.discount,
          taxIds: line.taxIds,
        };
      }),
    });
    return { id: order.id, name: order.name };
  }

  /** Kontrak aktif pemasok (untuk form PO). */
  async lookup(tx: Db, partnerId: string, date: string) {
    const rows = await tx
      .select()
      .from(C)
      .where(
        and(eq(C.companyId, currentContext().companyId), eq(C.partnerId, partnerId), eq(C.state, "active")),
      )
      .orderBy(asc(C.dateEnd));
    const out = [];
    for (const c of rows) {
      const lines = await contractLines(tx, c.id);
      out.push({
        id: c.id,
        name: c.name,
        dateStart: c.dateStart,
        dateEnd: c.dateEnd,
        currencyCode: c.currencyCode,
        valid: c.dateStart <= date && c.dateEnd >= date,
        lines: lines.map((l) => ({ id: l.id, productId: l.productId, name: l.name })),
      });
    }
    return out;
  }

  /** Laporan realisasi kontrak + kontrak aktif yang berakhir ≤ 30 hari. */
  async report(tx: Db) {
    const all = await this.list(tx, {});
    return {
      contracts: all.filter((c) => c.state === "active" || c.state === "expired" || c.state === "closed"),
      expiringSoon: all.filter((c) => c.state === "active" && c.daysLeft <= 30),
    };
  }

  private category(tx: Db, companyId: string) {
    return systemCategoryId(tx, companyId, "KONTRAK_BELI");
  }
}

@Controller("purchase-contracts")
export class PurchaseContractController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(PurchaseContractService) private readonly service: PurchaseContractService,
  ) {}

  @Get()
  @RequirePermission("purchase.read")
  list(@Query("partnerId") partnerId?: string, @Query("state") state?: string) {
    return this.tenantDb.run((tx) => this.service.list(tx, { partnerId, state }));
  }

  @Get("report")
  @RequirePermission("purchase.read")
  report() {
    return this.tenantDb.run((tx) => this.service.report(tx));
  }

  @Get("lookup")
  @RequirePermission("purchase.read")
  lookup(@Query("partnerId", ParseUUIDPipe) partnerId: string, @Query("date") date?: string) {
    return this.tenantDb.run((tx) => this.service.lookup(tx, partnerId, date ?? today()));
  }

  @Get(":id")
  @RequirePermission("purchase.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.detail(tx, id));
  }

  @Post()
  @RequirePermission("purchase.write")
  create(@Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.create(tx, body));
  }

  @Put(":id")
  @RequirePermission("purchase.write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.update(tx, id, body));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("purchase.write")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.service.remove(tx, id));
  }

  @Post(":id/submit")
  @HttpCode(200)
  @RequirePermission("purchase.write")
  submit(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.submit(tx, id));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermission("purchase.write")
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.cancel(tx, id));
  }

  @Post(":id/close")
  @HttpCode(200)
  @RequirePermission("purchase.write")
  close(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.close(tx, id));
  }

  @Post(":id/draft")
  @HttpCode(200)
  @RequirePermission("purchase.write")
  toDraft(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.toDraft(tx, id));
  }

  @Post(":id/purchase-order")
  @RequirePermission("purchase.write")
  createOrder(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.createOrder(tx, id, body));
  }
}

@Module({
  imports: [AccountingModule, HrModule, PurchaseModule],
  controllers: [PurchaseContractController],
  providers: [PurchaseContractService, SequenceService, ActivityService],
})
export class PurchaseContractModule {}
