import { BadRequestException } from "@nestjs/common";
import { and, asc, eq, gte, inArray, lte, ne, schema, sql, type Db } from "@erp/db";
import { contractWarnings, type ContractLineInfo, type ContractOrderLine } from "@erp/shared";
import { fieldError } from "../accounting/context.js";

const C = schema.purchaseContracts;
const CL = schema.purchaseContractLines;
const O = schema.purchaseOrders;
const OL = schema.purchaseOrderLines;

export type Contract = typeof C.$inferSelect;
export type ContractLine = typeof CL.$inferSelect;

export const contractLines = (tx: Db, contractId: string) =>
  tx.select().from(CL).where(eq(CL.contractId, contractId)).orderBy(asc(CL.sequence));

export const lineInfo = (l: ContractLine): ContractLineInfo => ({
  id: l.id,
  productId: l.productId,
  name: l.name,
  quantity: l.quantity,
  uomRatio: l.uomRatio,
  priceUnit: l.priceUnit,
  discount: l.discount,
  minOrderQty: l.minOrderQty,
});

/** Baris PO terkonfirmasi / menunggu persetujuan yang memakai baris kontrak (kecuali PO tertentu). */
export async function orderedLines(tx: Db, contractId: string, excludeOrderId?: string) {
  return tx
    .select({
      orderId: O.id,
      orderName: O.name,
      orderState: O.state,
      dateOrder: O.dateOrder,
      contractLineId: OL.contractLineId,
      quantity: OL.quantity,
      uomRatio: OL.uomRatio,
      priceSubtotal: OL.priceSubtotal,
    })
    .from(OL)
    .innerJoin(O, eq(O.id, OL.orderId))
    .innerJoin(CL, eq(CL.id, OL.contractLineId))
    .where(
      and(
        eq(CL.contractId, contractId),
        inArray(O.state, ["purchase", "to_approve"]),
        excludeOrderId ? ne(O.id, excludeOrderId) : undefined,
      ),
    );
}

const asOrderLine = (l: {
  contractLineId: string | null;
  quantity: string;
  uomRatio: string;
  priceSubtotal: string;
}): ContractOrderLine => ({
  contractLineId: l.contractLineId!,
  quantity: l.quantity,
  uomRatio: l.uomRatio,
  priceSubtotal: l.priceSubtotal,
});

/** Peringatan kontrak untuk PO (kosong bila PO tidak memakai kontrak atau sesuai kontrak). */
export async function orderContractWarnings(
  tx: Db,
  order: { id: string; contractId: string | null; dateOrder: string },
) {
  if (!order.contractId) return [];
  const [contract] = await tx.select().from(C).where(eq(C.id, order.contractId));
  if (!contract) return [];
  const lines = await contractLines(tx, contract.id);
  const own = await tx
    .select()
    .from(OL)
    .where(and(eq(OL.orderId, order.id), sql`${OL.contractLineId} is not null`));
  const others = await orderedLines(tx, contract.id, order.id);
  return contractWarnings({
    contract,
    lines: lines.map(lineInfo),
    otherOrders: others.map(asOrderLine),
    order: own.map(asOrderLine),
    date: order.dateOrder,
  });
}

/**
 * Kontrak untuk PO: yang dipilih (wajib aktif/berakhir, pemasok & mata uang sama) atau—bila tidak dipilih—satu-satunya
 * kontrak aktif pemasok yang berlaku pada tanggal PO dengan mata uang sama.
 */
export async function resolveContract(
  tx: Db,
  input: {
    companyId: string;
    partnerId: string;
    currencyCode?: string;
    dateOrder: string;
    contractId?: string | null;
  },
): Promise<{ contract: Contract; lines: ContractLine[]; explicit: boolean } | null> {
  if (input.contractId) {
    const [contract] = await tx
      .select()
      .from(C)
      .where(and(eq(C.id, input.contractId), eq(C.companyId, input.companyId)));
    if (!contract) throw fieldError("contractId", "Kontrak pembelian tidak ditemukan");
    if (contract.state !== "active")
      throw fieldError("contractId", "Kontrak pembelian belum aktif atau sudah ditutup");
    if (contract.partnerId !== input.partnerId)
      throw fieldError("contractId", "Kontrak pembelian milik pemasok lain");
    if (input.currencyCode && input.currencyCode !== contract.currencyCode)
      throw fieldError("currencyCode", "Mata uang PO harus sama dengan mata uang kontrak");
    return { contract, lines: await contractLines(tx, contract.id), explicit: true };
  }
  const found = await tx
    .select()
    .from(C)
    .where(
      and(
        eq(C.companyId, input.companyId),
        eq(C.partnerId, input.partnerId),
        eq(C.state, "active"),
        lte(C.dateStart, input.dateOrder),
        gte(C.dateEnd, input.dateOrder),
        input.currencyCode ? eq(C.currencyCode, input.currencyCode) : undefined,
      ),
    );
  if (found.length !== 1) return null;
  return { contract: found[0]!, lines: await contractLines(tx, found[0]!.id), explicit: false };
}

export function assertContractEditable(contract: Contract) {
  if (contract.state !== "draft") throw new BadRequestException("Hanya kontrak draft yang bisa diubah");
}
