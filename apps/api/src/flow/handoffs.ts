import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Query,
} from "@nestjs/common";
import { and, desc, eq, gt, inArray, schema, sql, type Db } from "@erp/db";
import {
  businessToday,
  FLOW_DEFS,
  FLOW_PROCESSES,
  handoffRemindSchema,
  summarizeHandoffs,
  type FlowHandoff,
  type FlowProcess,
} from "@erp/shared";
import { z } from "zod";
import { postComment } from "../activity/activity.service.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { NotificationService } from "../notifications/notification.service.js";
import { FlowService } from "./flow.service.js";

const blank = (v: unknown) => (v === "" ? undefined : v);
const querySchema = z.object({
  process: z.preprocess(blank, z.enum(FLOW_PROCESSES).optional()),
  /** Departemen (uuid) atau `none` = tahap tanpa departemen penanggung jawab. */
  department: z.preprocess(blank, z.union([z.string().uuid(), z.literal("none")]).optional()),
  /** in = menunggu di departemen ini; out = diserahkan departemen ini & menunggu di departemen lain. */
  direction: z.preprocess(blank, z.enum(["in", "out"]).default("in")),
  status: z.preprocess(blank, z.enum(["on_time", "at_risk", "late"]).optional()),
});

/** Dokumen alur memakai id pelamar untuk Hire-to-Pay; komentar & pengingat dicatat di model aslinya. */
export const docModel = (process: FlowProcess, model: string) => (process === "h2p" ? "applicant" : model);

/**
 * Papan serah terima antar departemen: dokumen yang sedang menunggu di tiap departemen (penanggung jawab tahap
 * sekarang), dari departemen mana diserahkan, sejak kapan, sisa/lewat SLA, dan siapa yang memegang; plus tombol
 * pengingat yang mengirim notifikasi & tercatat di riwayat dokumen.
 */
@Controller("flow/handoffs")
export class FlowHandoffController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(FlowService) private readonly flow: FlowService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  @Get()
  board(@Query() query: unknown) {
    const q = parse(querySchema, query);
    if (q.process) this.flow.assertCanRead(q.process);
    return this.tenantDb.run(async (tx) => {
      const c = currentContext().companyId;
      const processes = FLOW_PROCESSES.filter((p) => (q.process ? p === q.process : this.flow.canRead(p)));
      const all: FlowHandoff[] = [];
      for (const p of processes) all.push(...(await this.flow.handoffs(tx, p)));
      const summary = summarizeHandoffs(all);

      const D = schema.departments;
      const departments = await tx
        .select({ id: D.id, name: D.name })
        .from(D)
        .where(and(eq(D.companyId, c), eq(D.active, true)))
        .orderBy(D.name);
      const names = new Map(departments.map((d) => [d.id, d.name]));
      const [me] = await tx
        .select({ departmentId: schema.employees.departmentId })
        .from(schema.employees)
        .where(
          and(
            eq(schema.employees.userId, currentContext().userId),
            eq(schema.employees.companyId, c),
            eq(schema.employees.active, true),
          ),
        )
        .limit(1);

      const dep = q.department === "none" ? null : q.department;
      const rank = { late: 0, at_risk: 1, on_time: 2 } as const;
      const filtered = all
        .filter((h) =>
          q.department === undefined
            ? true
            : q.direction === "out"
              ? h.fromStage !== null && h.fromDepartmentId === dep && h.toDepartmentId !== dep
              : h.toDepartmentId === dep,
        )
        .filter((h) => !q.status || h.status === q.status)
        .sort((a, b) => rank[a.status] - rank[b.status] || b.ageDays - a.ageDays);
      const page = filtered.slice(0, 300);
      const reminders = await this.lastReminders(
        tx,
        page.map((h) => h.id),
      );
      const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
      // Bisa diingatkan bila ada pemegang lain atau manajer departemen tujuan yang punya akun pengguna.
      const E = schema.employees;
      const managers = new Map(
        (
          await tx
            .select({ id: D.id, user: E.userId })
            .from(D)
            .innerJoin(E, eq(E.id, D.managerId))
            .where(eq(D.companyId, c))
        ).map((m) => [m.id, m.user]),
      );
      const self = currentContext().userId;
      const canRemind = (h: FlowHandoff) => {
        const manager = h.toDepartmentId ? managers.get(h.toDepartmentId) : null;
        return (!!h.ownerId && h.ownerId !== self) || (!!manager && manager !== self);
      };
      return {
        today: businessToday(),
        myDepartmentId: me?.departmentId ?? null,
        departments: departments.map((d) => ({ id: d.id, name: d.name })),
        stats: summary.departments.map((s) => ({ ...s, department: name(s.departmentId) })),
        links: summary.links.map((l) => ({ ...l, fromName: name(l.from), toName: name(l.to) })),
        total: filtered.length,
        items: page.map((h) => ({
          ...h,
          processLabel: FLOW_DEFS[h.process].label,
          toDepartment: name(h.toDepartmentId),
          fromDepartment: name(h.fromDepartmentId),
          lastReminder: reminders.get(h.id) ?? null,
          canRemind: canRemind(h),
        })),
      };
    });
  }

  /** Ingatkan pemegang dokumen & manajer departemen yang sedang memegang tahapnya. */
  @Post("remind")
  @HttpCode(201)
  remind(@Body() body: unknown) {
    const input = parse(handoffRemindSchema, body);
    this.flow.assertCanRead(input.process);
    return this.tenantDb.run(async (tx) => {
      const [h] = await this.flow.handoffs(tx, input.process, input.id);
      if (!h) throw new NotFoundException("Dokumen tidak sedang menunggu di alur bisnis");
      const ctx = currentContext();
      const model = docModel(input.process, h.model);
      const L = schema.activityLogs;
      const [recent] = await tx
        .select({ id: L.id })
        .from(L)
        .where(
          and(
            eq(L.resModel, model),
            eq(L.resId, h.id),
            eq(L.userId, ctx.userId),
            eq(L.action, "message"),
            sql`${L.changes} ? 'reminder'`,
            gt(L.createdAt, sql`now() - interval '1 hour'`),
          ),
        )
        .limit(1);
      if (recent)
        throw new ConflictException("Pengingat untuk dokumen ini sudah dikirim dalam 1 jam terakhir");

      const D = schema.departments;
      const E = schema.employees;
      let department: string | null = null;
      let manager: string | null = null;
      if (h.toDepartmentId) {
        const [d] = await tx
          .select({ name: D.name, managerUser: E.userId })
          .from(D)
          .leftJoin(E, eq(E.id, D.managerId))
          .where(eq(D.id, h.toDepartmentId));
        department = d?.name ?? null;
        manager = d?.managerUser ?? null;
      }
      const recipients = [h.ownerId, manager].filter((u): u is string => !!u && u !== ctx.userId);
      if (!recipients.length)
        throw new BadRequestException(
          "Belum ada pemegang dokumen atau manajer departemen yang bisa diingatkan",
        );
      const [stageLabel] = h.stageLabel;
      const late =
        h.status === "late" ? " — sudah terlambat" : h.status === "at_risk" ? " — mendekati batas" : "";
      const text =
        `Pengingat serah terima: ${h.name} menunggu "${h.waiting[0]}" (${stageLabel})` +
        `${department ? ` di ${department}` : ""} sejak ${h.ageDays} hari` +
        `${h.slaDays !== null ? `, SLA ${h.slaDays} hari` : ""}${late}.` +
        (input.message ? ` ${input.message}` : "");
      const comment = await postComment(tx, this.notifications, {
        model,
        id: h.id,
        required: FLOW_DEFS[input.process].permission,
        message: text,
        // Penerima pengingat disebut agar tercatat siapa yang diingatkan.
        mentions: [],
        notify: recipients,
        reminder: { process: input.process, stage: h.stage },
        title: `Pengingat: ${h.name} menunggu ${h.waiting[0].toLowerCase()}`,
      });
      return { id: comment.id, notified: comment.notified, message: text };
    });
  }

  /** Pengingat terakhir per dokumen (kapan & oleh siapa). */
  private async lastReminders(tx: Db, ids: string[]) {
    const out = new Map<string, { at: string; by: string | null }>();
    if (!ids.length) return out;
    const L = schema.activityLogs;
    const rows = await tx
      .selectDistinctOn([L.resId], { id: L.resId, at: L.createdAt, by: schema.users.name })
      .from(L)
      .leftJoin(schema.users, eq(schema.users.id, L.userId))
      .where(and(inArray(L.resId, ids), eq(L.action, "message"), sql`${L.changes} ? 'reminder'`))
      .orderBy(L.resId, desc(L.createdAt));
    for (const r of rows) out.set(r.id, { at: new Date(r.at).toISOString(), by: r.by });
    return out;
  }
}
