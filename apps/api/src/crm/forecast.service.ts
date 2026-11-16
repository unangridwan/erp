import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, inArray, isNull, lte, or, schema, sql, type Db } from "@erp/db";
import {
  allowedFor,
  effectiveCategory,
  forecastRollup,
  forecastRow,
  matchTerritory,
  nextAssignee,
  parsePeriod,
  type ForecastLead,
  type forecastAdjustmentSchema,
  type quotasSchema,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { currentContext } from "../common/request-context.js";
import { assertCompanyUser, assertTeam, ownedScope } from "./checks.js";

const L = schema.crmLeads;
const Q = schema.crmQuotas;
const A = schema.crmForecastAdjustments;
const T = schema.crmTerritories;
const P = schema.partners;

const seeAll = () => allowedFor(currentContext().permissions, "crm.all", { path: "/leads" });
const canManage = () =>
  allowedFor(currentContext().permissions, "crm.manage", { path: "/crm/forecast", method: "PUT" });
const sumBy = (rows: { key: string; amount: string }[]) => {
  const out: Record<string, Decimal> = {};
  for (const r of rows) out[r.key] = (out[r.key] ?? new Decimal(0)).plus(r.amount);
  return out;
};

@Injectable()
export class ForecastService {
  /** Tim penjualan perusahaan ini (dan milik bersama) yang aktif. */
  private teams(tx: Db) {
    const companyId = currentContext().companyId;
    return tx
      .select()
      .from(schema.salesTeams)
      .where(
        and(
          eq(schema.salesTeams.active, true),
          or(isNull(schema.salesTeams.companyId), eq(schema.salesTeams.companyId, companyId)),
        ),
      )
      .orderBy(asc(schema.salesTeams.name));
  }

  /** Kuota setahun. Tanpa `crm.all` hanya kuota sendiri. */
  async quotas(tx: Db, year: number) {
    const ctx = currentContext();
    const rows = await tx
      .select()
      .from(Q)
      .where(
        and(
          eq(Q.companyId, ctx.companyId),
          gte(Q.periodStart, `${year}-01-01`),
          lte(Q.periodStart, `${year}-12-01`),
          seeAll() ? undefined : eq(Q.userId, ctx.userId),
        ),
      )
      .orderBy(asc(Q.periodStart));
    return {
      year,
      quotas: rows.map((q) => ({
        userId: q.userId,
        teamId: q.teamId,
        month: q.periodStart.slice(0, 7),
        amount: q.amount,
      })),
    };
  }

  async saveQuotas(tx: Db, input: z.infer<typeof quotasSchema>) {
    const companyId = currentContext().companyId;
    const users = [...new Set(input.quotas.map((q) => q.userId).filter((x): x is string => Boolean(x)))];
    const teams = [...new Set(input.quotas.map((q) => q.teamId).filter((x): x is string => Boolean(x)))];
    for (const id of users) await assertCompanyUser(tx, id, "quotas");
    for (const id of teams) await assertTeam(tx, id, "quotas");
    for (const q of input.quotas) {
      const periodStart = `${q.month}-01`;
      const owner = q.userId ? eq(Q.userId, q.userId) : eq(Q.teamId, q.teamId!);
      await tx.delete(Q).where(and(eq(Q.companyId, companyId), owner, eq(Q.periodStart, periodStart)));
      if (q.amount !== null)
        await tx.insert(Q).values({
          companyId,
          userId: q.userId ?? null,
          teamId: q.teamId ?? null,
          periodStart,
          amount: q.amount,
        });
    }
    return { saved: input.quotas.length };
  }

  /** Peluang yang masuk forecast periode: menang di periode, atau terbuka dengan perkiraan closing di periode. */
  private async periodLeads(tx: Db, start: string, end: string) {
    const ctx = currentContext();
    const rows = await tx
      .select({
        id: L.id,
        userId: L.userId,
        state: L.state,
        amount: L.expectedRevenue,
        probability: L.probability,
        leadCategory: L.forecastCategory,
        stageCategory: schema.crmStages.forecastCategory,
      })
      .from(L)
      .leftJoin(schema.crmStages, eq(schema.crmStages.id, L.stageId))
      .where(
        and(
          ownedScope(L.companyId, L.userId, "crm.all"),
          seeAll() ? undefined : eq(L.userId, ctx.userId),
          eq(L.leadType, "opportunity"),
          or(
            and(eq(L.state, "open"), gte(L.expectedClose, start), lte(L.expectedClose, end)),
            and(
              eq(L.state, "won"),
              sql`${L.closedAt} >= ${start}::date`,
              sql`${L.closedAt} < ${end}::date + 1`,
            ),
          ),
        ),
      );
    return rows.map((r): ForecastLead => ({
      userId: r.userId,
      state: r.state,
      amount: r.amount,
      probability: r.probability,
      category: effectiveCategory(
        { forecastCategory: r.leadCategory },
        { forecastCategory: r.stageCategory },
      ),
    }));
  }

  /** Forecast periode (`YYYY-MM` atau `YYYY-Qn`): per salesperson, per tim, dan total perusahaan. */
  async forecast(tx: Db, periodKey: string) {
    const period = parsePeriod(periodKey);
    if (!period) throw new BadRequestException("Periode harus berformat YYYY-MM atau YYYY-Qn");
    const ctx = currentContext();
    const all = seeAll();
    const leads = await this.periodLeads(tx, period.start, period.end);

    const quotaRows = await tx
      .select()
      .from(Q)
      .where(
        and(
          eq(Q.companyId, ctx.companyId),
          inArray(Q.periodStart, period.months),
          all ? undefined : eq(Q.userId, ctx.userId),
        ),
      );
    const adjustRows = await tx
      .select()
      .from(A)
      .where(
        and(
          eq(A.companyId, ctx.companyId),
          inArray(A.periodStart, period.months),
          all ? undefined : eq(A.userId, ctx.userId),
        ),
      );
    const userQuota = sumBy(
      quotaRows.filter((q) => q.userId).map((q) => ({ key: q.userId!, amount: q.amount })),
    );
    const teamQuota = sumBy(
      quotaRows.filter((q) => q.teamId).map((q) => ({ key: q.teamId!, amount: q.amount })),
    );
    const adjusted = sumBy(adjustRows.map((a) => ({ key: a.userId, amount: a.amount })));

    const rows = forecastRollup(leads, userQuota, adjusted);
    const userIds = rows.map((r) => r.userId).filter((x): x is string => x !== null);
    const names = userIds.length
      ? await tx
          .select({ id: schema.users.id, name: schema.users.name })
          .from(schema.users)
          .where(inArray(schema.users.id, userIds))
      : [];
    const nameOf = (id: string | null) => names.find((n) => n.id === id)?.name ?? null;

    const teams = all ? await this.teams(tx) : [];
    const teamRows = teams.map((team) => {
      const members = new Set([...team.memberIds, ...(team.leaderId ? [team.leaderId] : [])]);
      const memberQuota = [...members]
        .filter((id) => userQuota[id])
        .reduce<Decimal | null>((s, id) => (s ?? new Decimal(0)).plus(userQuota[id]!), null);
      return {
        teamId: team.id,
        teamName: team.name,
        leaderId: team.leaderId,
        memberIds: [...members],
        ...forecastRow(
          null,
          leads.filter((l) => l.userId && members.has(l.userId)),
          teamQuota[team.id] ?? memberQuota,
        ),
      };
    });

    const totalQuota = Object.values(userQuota).reduce<Decimal | null>(
      (s, v) => (s ?? new Decimal(0)).plus(v),
      null,
    );
    const [undated] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${L.expectedRevenue}), 0)::text`,
      })
      .from(L)
      .where(
        and(
          ownedScope(L.companyId, L.userId, "crm.all"),
          all ? undefined : eq(L.userId, ctx.userId),
          eq(L.leadType, "opportunity"),
          eq(L.state, "open"),
          isNull(L.expectedClose),
        ),
      );
    const ledTeams = (await this.teams(tx)).filter((t) => t.leaderId === ctx.userId);
    return {
      period,
      rows: rows
        .map((r) => ({ ...r, userName: nameOf(r.userId) }))
        .sort((a, b) => (a.userName ?? "￿").localeCompare(b.userName ?? "￿")),
      teams: teamRows,
      total: forecastRow(null, leads, totalQuota),
      undated: { count: undated?.count ?? 0, amount: undated?.amount ?? "0" },
      // Siapa yang forecast-nya boleh disesuaikan oleh user ini: semua (kelola) atau anggota tim yang dipimpinnya.
      adjustable: canManage() ? "all" : ledTeams.flatMap((t) => t.memberIds),
    };
  }

  /** Forecast manajer untuk seorang salesperson pada satu bulan. */
  async adjust(tx: Db, input: z.infer<typeof forecastAdjustmentSchema>) {
    const ctx = currentContext();
    if (!canManage()) {
      const led = (await this.teams(tx)).filter((t) => t.leaderId === ctx.userId);
      if (!led.some((t) => t.memberIds.includes(input.userId)))
        throw new ForbiddenException(
          "Hanya pemimpin tim atau pengelola CRM yang boleh menyesuaikan forecast",
        );
    }
    await assertCompanyUser(tx, input.userId);
    const periodStart = `${input.month}-01`;
    await tx
      .delete(A)
      .where(and(eq(A.companyId, ctx.companyId), eq(A.userId, input.userId), eq(A.periodStart, periodStart)));
    if (input.amount !== null)
      await tx.insert(A).values({
        companyId: ctx.companyId,
        userId: input.userId,
        periodStart,
        amount: input.amount,
        note: input.note ?? null,
        adjustedBy: ctx.userId,
      });
    return { userId: input.userId, month: input.month, amount: input.amount };
  }

  /** Pencapaian vs kuota per salesperson per bulan dalam setahun (nilai peluang yang menang). */
  async attainment(tx: Db, year: number) {
    const ctx = currentContext();
    const all = seeAll();
    const won = await tx
      .select({
        userId: L.userId,
        month: sql<string>`to_char(${L.closedAt}, 'YYYY-MM')`,
        amount: sql<string>`coalesce(sum(${L.expectedRevenue}), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(L)
      .where(
        and(
          ownedScope(L.companyId, L.userId, "crm.all"),
          all ? undefined : eq(L.userId, ctx.userId),
          eq(L.leadType, "opportunity"),
          eq(L.state, "won"),
          sql`${L.closedAt} >= ${`${year}-01-01`}::date`,
          sql`${L.closedAt} < ${`${year + 1}-01-01`}::date`,
        ),
      )
      .groupBy(L.userId, sql`to_char(${L.closedAt}, 'YYYY-MM')`);
    const { quotas } = await this.quotas(tx, year);
    const userQuotas = quotas.filter((q) => q.userId);
    const ids = [
      ...new Set(
        [...won.map((w) => w.userId), ...userQuotas.map((q) => q.userId)].filter((x): x is string => !!x),
      ),
    ];
    const names = ids.length
      ? await tx
          .select({ id: schema.users.id, name: schema.users.name })
          .from(schema.users)
          .where(inArray(schema.users.id, ids))
      : [];
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    const pct = (closed: Decimal, quota: Decimal | null) =>
      quota && quota.gt(0) ? closed.div(quota).times(100).toDecimalPlaces(1).toNumber() : null;
    const build = (userId: string | null) => {
      const cells = months.map((month) => {
        const closed = won
          .filter((w) => w.userId === userId && w.month === month)
          .reduce((s, w) => s.plus(w.amount), new Decimal(0));
        const q = userQuotas.find((x) => x.userId === userId && x.month === month);
        const quota = q ? new Decimal(q.amount) : null;
        return { month, closed, quota };
      });
      const closed = cells.reduce((s, c) => s.plus(c.closed), new Decimal(0));
      const quota = cells.reduce<Decimal | null>(
        (s, c) => (c.quota ? (s ?? new Decimal(0)).plus(c.quota) : s),
        null,
      );
      return {
        userId,
        userName: names.find((n) => n.id === userId)?.name ?? null,
        months: cells.map((c) => ({
          month: c.month,
          closed: c.closed.toFixed(2),
          quota: c.quota?.toFixed(2) ?? null,
          attainment: pct(c.closed, c.quota),
        })),
        closed: closed.toFixed(2),
        quota: quota?.toFixed(2) ?? null,
        attainment: pct(closed, quota),
      };
    };
    const rows = [...ids.map(build), ...(won.some((w) => w.userId === null) ? [build(null)] : [])].sort(
      (a, b) => (a.userName ?? "￿").localeCompare(b.userName ?? "￿"),
    );
    const totalClosed = rows.reduce((s, r) => s.plus(r.closed), new Decimal(0));
    const totalQuota = rows.reduce<Decimal | null>(
      (s, r) => (r.quota ? (s ?? new Decimal(0)).plus(r.quota) : s),
      null,
    );
    return {
      year,
      months,
      rows,
      total: {
        closed: totalClosed.toFixed(2),
        quota: totalQuota?.toFixed(2) ?? null,
        attainment: pct(totalClosed, totalQuota),
      },
    };
  }

  /**
   * Terapkan aturan wilayah ke akun dan lead/peluang terbuka yang belum berwilayah. Lead tanpa penanggung jawab
   * ditugaskan bergiliran ke anggota wilayah (beban lead terbuka paling sedikit lebih dulu).
   */
  async assignTerritories(tx: Db) {
    const companyId = currentContext().companyId;
    const territories = await tx
      .select()
      .from(T)
      .where(and(eq(T.companyId, companyId), eq(T.active, true)))
      .orderBy(asc(T.sequence));
    if (!territories.length) return { accounts: 0, leads: 0, assigned: 0 };

    const partners = await tx
      .select({ id: P.id, province: P.province, city: P.city, industry: P.industry })
      .from(P)
      .where(
        and(eq(P.active, true), isNull(P.territoryId), or(isNull(P.companyId), eq(P.companyId, companyId))),
      )
      .limit(20_000);
    let accounts = 0;
    const partnerTerritory = new Map<string, string>();
    for (const p of partners) {
      const t = matchTerritory(territories, p);
      if (!t) continue;
      await tx.update(P).set({ territoryId: t.id }).where(eq(P.id, p.id));
      partnerTerritory.set(p.id, t.id);
      accounts++;
    }

    const loadRows = await tx
      .select({ userId: L.userId, territoryId: L.territoryId, count: sql<number>`count(*)::int` })
      .from(L)
      .where(and(eq(L.companyId, companyId), eq(L.state, "open")))
      .groupBy(L.userId, L.territoryId);
    const load: Record<string, number> = {};
    for (const r of loadRows) if (r.userId) load[r.userId] = (load[r.userId] ?? 0) + r.count;

    const leads = await tx
      .select({
        id: L.id,
        userId: L.userId,
        partnerId: L.partnerId,
        province: L.province,
        city: L.city,
        industry: L.industry,
        partnerTerritoryId: P.territoryId,
      })
      .from(L)
      .leftJoin(P, eq(P.id, L.partnerId))
      .where(and(eq(L.companyId, companyId), eq(L.state, "open"), isNull(L.territoryId)))
      .orderBy(asc(L.createdAt))
      .limit(20_000);
    let matched = 0;
    let assigned = 0;
    for (const lead of leads) {
      const territoryId =
        lead.partnerTerritoryId ??
        (lead.partnerId ? partnerTerritory.get(lead.partnerId) : undefined) ??
        matchTerritory(territories, lead)?.id;
      if (!territoryId) continue;
      const territory = territories.find((t) => t.id === territoryId);
      const userId = lead.userId ?? (territory ? nextAssignee(territory.memberIds, load) : null);
      await tx
        .update(L)
        .set({ territoryId, userId, updatedAt: sql`now()` })
        .where(eq(L.id, lead.id));
      matched++;
      if (!lead.userId && userId) {
        load[userId] = (load[userId] ?? 0) + 1;
        assigned++;
      }
    }
    return { accounts, leads: matched, assigned };
  }

  /** Ringkasan per wilayah: akun, peluang terbuka & nilainya, nilai menang tahun berjalan. */
  async territoryReport(tx: Db) {
    const companyId = currentContext().companyId;
    const territories = await tx.select().from(T).where(eq(T.companyId, companyId)).orderBy(asc(T.sequence));
    const year = new Date().getUTCFullYear();
    const leadRows = await tx
      .select({
        territoryId: L.territoryId,
        state: L.state,
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${L.expectedRevenue}), 0)::text`,
      })
      .from(L)
      .where(
        and(
          ownedScope(L.companyId, L.userId, "crm.all"),
          eq(L.leadType, "opportunity"),
          or(eq(L.state, "open"), and(eq(L.state, "won"), sql`${L.closedAt} >= ${`${year}-01-01`}::date`)),
        ),
      )
      .groupBy(L.territoryId, L.state);
    const accountRows = await tx
      .select({ territoryId: P.territoryId, count: sql<number>`count(*)::int` })
      .from(P)
      .where(and(eq(P.active, true), or(isNull(P.companyId), eq(P.companyId, companyId))))
      .groupBy(P.territoryId);
    const row = (id: string | null, name: string | null) => {
      const open = leadRows.find((r) => r.territoryId === id && r.state === "open");
      const won = leadRows.find((r) => r.territoryId === id && r.state === "won");
      return {
        territoryId: id,
        name,
        accounts: accountRows.find((r) => r.territoryId === id)?.count ?? 0,
        openCount: open?.count ?? 0,
        pipeline: new Decimal(open?.amount ?? 0).toFixed(2),
        wonCount: won?.count ?? 0,
        wonAmount: new Decimal(won?.amount ?? 0).toFixed(2),
      };
    };
    return { year, rows: [...territories.map((t) => row(t.id, t.name)), row(null, null)] };
  }
}
