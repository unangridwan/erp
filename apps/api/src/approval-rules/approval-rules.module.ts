import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { and, asc, eq, inArray, or, schema, type Db } from "@erp/db";
import {
  APPROVAL_LIMIT_DOC_KEYS,
  APPROVAL_RULE_DOC_KEYS,
  approvalLimitsSchema,
  approvalRulesSchema,
  approvalSimulateSchema,
  limitFor,
  type ApprovalLimitDoc,
  type ApprovalRuleDoc,
} from "@erp/shared";
import { fieldError } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { limitsFor, planSteps, roleHolders, rulesFor, userRoleIds } from "./resolver.js";

const RULE = schema.approvalRules;
const LIMIT = schema.approvalLimits;
const APR = schema.approvalCategoryApprovers;
const CAT = schema.approvalCategories;

function ruleDoc(docType: string): ApprovalRuleDoc {
  if (!(APPROVAL_RULE_DOC_KEYS as string[]).includes(docType))
    throw new BadRequestException("Jenis dokumen tidak dikenal");
  return docType as ApprovalRuleDoc;
}
function limitDoc(docType: string): ApprovalLimitDoc {
  if (!(APPROVAL_LIMIT_DOC_KEYS as string[]).includes(docType))
    throw new BadRequestException("Jenis dokumen tidak dikenal");
  return docType as ApprovalLimitDoc;
}

/** Pengguna harus punya akses ke perusahaan aktif; peran harus ada. */
async function assertRefs(
  tx: Db,
  companyId: string,
  refs: { users: { path: string; id: string }[]; roles: { path: string; id: string }[] },
) {
  if (refs.users.length) {
    const ok = new Set(
      (
        await tx
          .select({ userId: schema.userCompanies.userId })
          .from(schema.userCompanies)
          .where(
            and(
              eq(schema.userCompanies.companyId, companyId),
              inArray(
                schema.userCompanies.userId,
                refs.users.map((u) => u.id),
              ),
            ),
          )
      ).map((r) => r.userId),
    );
    const bad = refs.users.find((u) => !ok.has(u.id));
    if (bad) throw fieldError(bad.path, "User tidak punya akses ke perusahaan ini");
  }
  if (refs.roles.length) {
    const ok = new Set(
      (
        await tx
          .select({ id: schema.roles.id })
          .from(schema.roles)
          .where(
            inArray(
              schema.roles.id,
              refs.roles.map((r) => r.id),
            ),
          )
      ).map((r) => r.id),
    );
    const bad = refs.roles.find((r) => !ok.has(r.id));
    if (bad) throw fieldError(bad.path, "Peran tidak ditemukan");
  }
}

async function names(tx: Db, userIds: (string | null)[], roleIds: (string | null)[]) {
  const u = userIds.filter((x): x is string => !!x);
  const r = roleIds.filter((x): x is string => !!x);
  const users = u.length
    ? await tx
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(inArray(schema.users.id, u))
    : [];
  const roles = r.length
    ? await tx
        .select({ id: schema.roles.id, name: schema.roles.name })
        .from(schema.roles)
        .where(inArray(schema.roles.id, r))
    : [];
  return {
    user: new Map(users.map((x) => [x.id, x.name])),
    role: new Map(roles.map((x) => [x.id, x.name])),
  };
}

/** Pengaturan › Aturan Persetujuan: alur per jenis dokumen, batas wewenang, simulasi. */
@Controller()
class ApprovalRulesController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  @Get("approval-rules")
  @RequirePermission("approval.manage")
  rules() {
    return this.tenantDb.run((tx) => this.listRules(tx));
  }

  private async listRules(tx: Db) {
    const rows = await tx
      .select()
      .from(RULE)
      .where(eq(RULE.companyId, currentContext().companyId))
      .orderBy(asc(RULE.docType), asc(RULE.sequence));
    const n = await names(
      tx,
      rows.map((r) => r.userId),
      rows.map((r) => r.roleId),
    );
    const out: Record<string, unknown[]> = Object.fromEntries(APPROVAL_RULE_DOC_KEYS.map((k) => [k, []]));
    for (const r of rows)
      out[r.docType]!.push({
        ...r,
        userName: r.userId ? (n.user.get(r.userId) ?? null) : null,
        roleName: r.roleId ? (n.role.get(r.roleId) ?? null) : null,
      });
    return out;
  }

  /** Ganti seluruh tahap satu jenis dokumen (kosong = kembali ke perilaku lama). */
  @Put("approval-rules/:docType")
  @RequirePermission("approval.manage")
  saveRules(@Param("docType") docType: string, @Body() body: unknown) {
    const doc = ruleDoc(docType);
    const input = parse(approvalRulesSchema, body);
    return this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      await assertRefs(tx, companyId, {
        users: input.steps.flatMap((s, i) => (s.userId ? [{ path: `steps.${i}.userId`, id: s.userId }] : [])),
        roles: input.steps.flatMap((s, i) => (s.roleId ? [{ path: `steps.${i}.roleId`, id: s.roleId }] : [])),
      });
      const before = await rulesFor(tx, companyId, doc);
      await tx.delete(RULE).where(and(eq(RULE.companyId, companyId), eq(RULE.docType, doc)));
      if (input.steps.length)
        await tx.insert(RULE).values(
          input.steps.map((s, i) => ({
            companyId,
            docType: doc,
            sequence: (i + 1) * 10,
            approverType: s.approverType,
            userId: s.userId,
            roleId: s.roleId,
            minValue: s.minValue ?? null,
            label: s.label ?? null,
          })),
        );
      await this.activity.log(tx, {
        resModel: "approval_rules",
        resId: companyId,
        action: "update",
        message: `Aturan persetujuan ${doc}: ${before.length} → ${input.steps.length} tahap`,
      });
      return (await this.listRules(tx))[doc];
    });
  }

  @Get("approval-limits")
  @RequirePermission("approval.manage")
  limits(@Query("docType") docType?: string) {
    return this.tenantDb.run((tx) => this.listLimits(tx, docType));
  }

  private async listLimits(tx: Db, docType?: string) {
    const rows = await tx
      .select({ limit: LIMIT, categoryName: CAT.name })
      .from(LIMIT)
      .leftJoin(CAT, eq(CAT.id, LIMIT.categoryId))
      .where(
        and(
          eq(LIMIT.companyId, currentContext().companyId),
          docType ? eq(LIMIT.docType, limitDoc(docType)) : undefined,
        ),
      )
      .orderBy(asc(LIMIT.docType), asc(LIMIT.createdAt));
    const n = await names(
      tx,
      rows.map((r) => r.limit.userId),
      rows.map((r) => r.limit.roleId),
    );
    return rows.map(({ limit, categoryName }) => ({
      ...limit,
      categoryName,
      userName: limit.userId ? (n.user.get(limit.userId) ?? null) : null,
      roleName: limit.roleId ? (n.role.get(limit.roleId) ?? null) : null,
    }));
  }

  /** Ganti seluruh batas wewenang satu jenis dokumen. */
  @Put("approval-limits/:docType")
  @RequirePermission("approval.manage")
  saveLimits(@Param("docType") docType: string, @Body() body: unknown) {
    const doc = limitDoc(docType);
    const input = parse(approvalLimitsSchema, body);
    return this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      await assertRefs(tx, companyId, {
        users: input.limits.flatMap((l, i) =>
          l.userId ? [{ path: `limits.${i}.userId`, id: l.userId }] : [],
        ),
        roles: input.limits.flatMap((l, i) =>
          l.roleId ? [{ path: `limits.${i}.roleId`, id: l.roleId }] : [],
        ),
      });
      const seen = new Set<string>();
      for (const [i, l] of input.limits.entries()) {
        if (l.categoryId && doc !== "approval_request")
          throw fieldError(`limits.${i}.categoryId`, "Kategori hanya untuk permintaan persetujuan");
        const key = `${l.categoryId ?? ""}|${l.roleId ?? ""}|${l.userId ?? ""}`;
        if (seen.has(key)) throw fieldError(`limits.${i}.roleId`, "Batas untuk pihak ini sudah ada");
        seen.add(key);
      }
      const cats = input.limits.flatMap((l) => (l.categoryId ? [l.categoryId] : []));
      if (cats.length) {
        const ok = new Set(
          (
            await tx
              .select({ id: CAT.id })
              .from(CAT)
              .where(and(eq(CAT.companyId, companyId), inArray(CAT.id, cats)))
          ).map((c) => c.id),
        );
        const bad = input.limits.findIndex((l) => l.categoryId && !ok.has(l.categoryId));
        if (bad >= 0) throw fieldError(`limits.${bad}.categoryId`, "Kategori tidak ditemukan");
      }
      await tx.delete(LIMIT).where(and(eq(LIMIT.companyId, companyId), eq(LIMIT.docType, doc)));
      if (input.limits.length)
        await tx.insert(LIMIT).values(
          input.limits.map((l) => ({
            companyId,
            docType: doc,
            categoryId: l.categoryId ?? null,
            roleId: l.roleId ?? null,
            userId: l.userId ?? null,
            maxAmount: l.maxAmount ?? null,
            note: l.note ?? null,
          })),
        );
      await this.activity.log(tx, {
        resModel: "approval_rules",
        resId: companyId,
        action: "update",
        message: `Batas wewenang ${doc}: ${input.limits.length} baris`,
      });
      return this.listLimits(tx, doc);
    });
  }

  /**
   * Simulasi: tahap untuk nilai dokumen tertentu dari karyawan/pengguna tertentu, lengkap dengan nama penyetuju.
   * Tanpa aturan: `steps` null (perilaku lama).
   */
  @Post("approval-rules/simulate")
  @HttpCode(200)
  @RequirePermission("approval.manage")
  simulate(@Body() body: unknown) {
    const input = parse(approvalSimulateSchema, body);
    return this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      const E = schema.employees;
      const [employee] = input.employeeId
        ? await tx
            .select()
            .from(E)
            .where(and(eq(E.id, input.employeeId), eq(E.companyId, companyId)))
        : input.userId
          ? await tx
              .select()
              .from(E)
              .where(and(eq(E.userId, input.userId), eq(E.companyId, companyId)))
          : [];
      if (input.employeeId && !employee) throw fieldError("employeeId", "Karyawan tidak ditemukan");
      const requester = employee?.userId ?? input.userId ?? null;
      const steps = await planSteps(tx, {
        companyId,
        docType: input.docType,
        value: input.value ?? null,
        employee: employee ?? null,
        requesterUserId: requester,
      });
      // Dokumen SDM tanpa tahap yang berlaku tetap diputuskan HR (sama dengan saat diajukan).
      const resolved =
        steps && !steps.length && input.docType !== "purchase_order"
          ? [{ step: 1, approverUserId: null, approverRoleId: null, label: null }]
          : steps;
      const out = [];
      for (const s of resolved ?? []) {
        const n = await names(tx, [s.approverUserId], [s.approverRoleId]);
        const holders = s.approverRoleId ? await roleHolders(tx, s.approverRoleId, companyId) : [];
        const holderNames = (await names(tx, holders, [])).user;
        out.push({
          step: s.step,
          label: s.label,
          approverUserId: s.approverUserId,
          approverRoleId: s.approverRoleId,
          approver: s.approverUserId
            ? (n.user.get(s.approverUserId) ?? "—")
            : s.approverRoleId
              ? `Peran ${n.role.get(s.approverRoleId) ?? ""}`.trim()
              : null,
          holders: holders.filter((h) => h !== requester).map((h) => holderNames.get(h) ?? "—"),
        });
      }
      const limitDocType = (APPROVAL_LIMIT_DOC_KEYS as string[]).includes(input.docType)
        ? (input.docType as ApprovalLimitDoc)
        : null;
      let requesterLimit: number | null | undefined;
      if (limitDocType && requester)
        requesterLimit = limitFor(await limitsFor(tx, companyId, limitDocType), {
          userId: requester,
          roleIds: await userRoleIds(tx, requester, companyId),
        });
      return {
        rules: steps !== null,
        steps: steps === null ? null : out,
        requesterLimit: requesterLimit ?? null,
      };
    });
  }

  /** Ringkasan persetujuan seorang pengguna: batas wewenang (langsung/peran) & tahap di mana ia penyetuju. */
  @Get("users/:id/approvals")
  @RequirePermission("user.read")
  forUser(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      const roleIds = await userRoleIds(tx, id, companyId);
      const limits = [];
      for (const doc of APPROVAL_LIMIT_DOC_KEYS) {
        const rows = await limitsFor(tx, companyId, doc);
        if (!rows.length) continue;
        limits.push({
          docType: doc,
          effective: limitFor(rows, { userId: id, roleIds }) ?? null,
          source: rows.some((r) => r.userId === id && !r.categoryId)
            ? "user"
            : rows.some((r) => r.roleId && roleIds.includes(r.roleId) && !r.categoryId)
              ? "role"
              : "default",
        });
      }
      return { limits, ...(await this.involvement(tx, companyId, { userId: id, roleIds })) };
    });
  }

  /** Ringkasan persetujuan sebuah peran. */
  @Get("roles/:id/approvals")
  @RequirePermission("role.manage")
  forRole(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      const limits = await tx
        .select({ docType: LIMIT.docType, maxAmount: LIMIT.maxAmount, categoryName: CAT.name })
        .from(LIMIT)
        .leftJoin(CAT, eq(CAT.id, LIMIT.categoryId))
        .where(and(eq(LIMIT.companyId, companyId), eq(LIMIT.roleId, id)));
      return { limits, ...(await this.involvement(tx, companyId, { userId: null, roleIds: [id] })) };
    });
  }

  /** Tahap aturan & kategori permintaan yang menunjuk pengguna/peran ini secara langsung. */
  private async involvement(tx: Db, companyId: string, who: { userId: string | null; roleIds: string[] }) {
    const match = (
      userCol: typeof RULE.userId | typeof APR.userId,
      roleCol: typeof RULE.roleId | typeof APR.roleId,
    ) =>
      or(
        who.userId ? eq(userCol, who.userId) : undefined,
        who.roleIds.length ? inArray(roleCol, who.roleIds) : undefined,
      );
    const rules = await tx
      .select({
        docType: RULE.docType,
        sequence: RULE.sequence,
        approverType: RULE.approverType,
        minValue: RULE.minValue,
        label: RULE.label,
        viaRole: RULE.roleId,
      })
      .from(RULE)
      .where(and(eq(RULE.companyId, companyId), match(RULE.userId, RULE.roleId)))
      .orderBy(asc(RULE.docType), asc(RULE.sequence));
    const categories = await tx
      .select({
        categoryId: CAT.id,
        categoryName: CAT.name,
        label: APR.label,
        minAmount: APR.minAmount,
        viaRole: APR.roleId,
      })
      .from(APR)
      .innerJoin(CAT, eq(CAT.id, APR.categoryId))
      .where(and(eq(CAT.companyId, companyId), match(APR.userId, APR.roleId)))
      .orderBy(asc(CAT.name));
    const n = await names(tx, [], [...rules.map((r) => r.viaRole), ...categories.map((c) => c.viaRole)]);
    return {
      rules: rules.map((r) => ({ ...r, roleName: r.viaRole ? (n.role.get(r.viaRole) ?? null) : null })),
      categories: categories.map((c) => ({
        ...c,
        roleName: c.viaRole ? (n.role.get(c.viaRole) ?? null) : null,
      })),
    };
  }
}

@Module({
  controllers: [ApprovalRulesController],
  providers: [ActivityService],
})
export class ApprovalRulesModule {}
