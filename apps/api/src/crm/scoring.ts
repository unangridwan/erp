import { and, eq, schema, sql, type Db } from "@erp/db";
import { nextAssignee, pickAssignmentRule, scoreLead, type AutomationCondition } from "@erp/shared";

type Lead = typeof schema.crmLeads.$inferSelect;

/** Skor lead dari aturan skor aktif perusahaan. */
export async function leadScore(tx: Db, companyId: string, lead: Record<string, unknown>) {
  const rules = await tx
    .select()
    .from(schema.crmScoringRules)
    .where(and(eq(schema.crmScoringRules.companyId, companyId), eq(schema.crmScoringRules.active, true)));
  if (!rules.length) return 0;
  return scoreLead(
    lead,
    rules.map((r) => ({ conditions: r.conditions as AutomationCondition[], points: r.points })),
  );
}

/** Jumlah lead terbuka per penanggung jawab (beban untuk giliran penugasan). */
export async function openLeadLoad(tx: Db, companyId: string) {
  const rows = await tx
    .select({ userId: schema.crmLeads.userId, count: sql<number>`count(*)::int` })
    .from(schema.crmLeads)
    .where(and(eq(schema.crmLeads.companyId, companyId), eq(schema.crmLeads.state, "open")))
    .groupBy(schema.crmLeads.userId);
  const load: Record<string, number> = {};
  for (const r of rows) if (r.userId) load[r.userId] = r.count;
  return load;
}

/**
 * Penanggung jawab untuk lead yang belum ditugaskan: aturan penugasan pertama yang cocok (bergiliran menurut beban),
 * lalu anggota wilayah lead. `load` diperbarui agar pemanggilan berikutnya tetap seimbang.
 */
export async function assignLead(
  tx: Db,
  companyId: string,
  lead: Pick<Lead, "territoryId"> & Record<string, unknown>,
  load: Record<string, number>,
): Promise<{ userId: string | null; teamId: string | null }> {
  const rules = await tx
    .select()
    .from(schema.crmAssignmentRules)
    .where(
      and(eq(schema.crmAssignmentRules.companyId, companyId), eq(schema.crmAssignmentRules.active, true)),
    );
  const rule = pickAssignmentRule(
    rules.map((r) => ({ ...r, conditions: r.conditions as AutomationCondition[] })),
    lead,
  );
  let candidates = rule?.userIds ?? [];
  if (!candidates.length && lead.territoryId) {
    const [territory] = await tx
      .select({ memberIds: schema.crmTerritories.memberIds })
      .from(schema.crmTerritories)
      .where(eq(schema.crmTerritories.id, lead.territoryId));
    candidates = territory?.memberIds ?? [];
  }
  const userId = nextAssignee(candidates, load);
  if (userId) load[userId] = (load[userId] ?? 0) + 1;
  return { userId, teamId: rule?.teamId ?? null };
}
