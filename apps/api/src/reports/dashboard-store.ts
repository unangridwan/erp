import { NotFoundException } from "@nestjs/common";
import { and, eq, schema, type Db } from "@erp/db";
import { biDocumentSchema, legacyToDocument, type BiDocument, type DashboardWidget } from "@erp/shared";
import { currentContext } from "../common/request-context.js";

const D = schema.dashboards;

/**
 * Dashboard kustom yang boleh dibaca user aktif (milik sendiri atau dibagikan); `owner` = harus milik sendiri.
 * Dipakai dashboard & mesin BI.
 */
export async function findDashboard(tx: Db, id: string, owner = false) {
  const ctx = currentContext();
  const [row] = await tx
    .select()
    .from(D)
    .where(and(eq(D.id, id), eq(D.companyId, ctx.companyId)));
  if (!row || (row.ownerId !== ctx.userId && (owner || row.visibility !== "shared")))
    throw new NotFoundException("Dashboard tidak ditemukan");
  return row;
}

/** Dokumen v2 dashboard kustom: tersimpan, atau diturunkan dari widget lama. */
export function dashboardDocument(row: { document: unknown; widgets: unknown }): BiDocument {
  if (row.document) {
    const parsed = biDocumentSchema.safeParse(row.document);
    if (parsed.success) return parsed.data;
  }
  return legacyToDocument(row.widgets as DashboardWidget[]);
}
