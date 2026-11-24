import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, schema, sql, type Db, type SQL } from "@erp/db";
import {
  autoDepartment,
  businessToday,
  FLOW_DEFS,
  handoffItems,
  hasPermission,
  monotonicTimes,
  type FlowItem,
  type FlowOwner,
  type FlowProcess,
} from "@erp/shared";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";

/** Waktu ISO UTC dari kolom timestamptz (string, bukan objek Date driver). */
const iso = (col: string) => sql.raw(`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

type Row = Record<string, string | number | boolean | null>;

/**
 * Data alur bisnis: tiap dokumen proses beserta waktu masuk tiap tahap, diturunkan dari status, tanggal, relasi
 * (pengiriman, faktur, pelunasan), dan waktu transisi yang tercatat. Dokumen batal tidak ikut.
 */
@Injectable()
export class FlowService {
  constructor(@Inject(TenantDb) readonly tenantDb: TenantDb) {}

  assertCanRead(process: FlowProcess) {
    if (!hasPermission(currentContext().permissions, FLOW_DEFS[process].permission))
      throw new ForbiddenException(`Butuh permission ${FLOW_DEFS[process].permission}`);
  }

  canRead(process: FlowProcess) {
    return hasPermission(currentContext().permissions, FLOW_DEFS[process].permission);
  }

  /** Batas awal data yang dimuat: dokumen lebih tua yang sudah selesai tidak memengaruhi WIP maupun periode. */
  horizon(from?: string) {
    const base = new Date(`${from ?? businessToday()}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() - 400);
    return base.toISOString().slice(0, 10);
  }

  async items(tx: Db, process: FlowProcess, opts: { from?: string; onlyId?: string }): Promise<FlowItem[]> {
    const horizon = this.horizon(opts.from);
    const rows =
      process === "o2c"
        ? await this.o2c(tx, horizon, opts.onlyId)
        : process === "p2p"
          ? await this.p2p(tx, horizon, opts.onlyId)
          : process === "mfg"
            ? await this.mfg(tx, horizon, opts.onlyId)
            : await this.h2p(tx, horizon, opts.onlyId);
    const def = FLOW_DEFS[process];
    return rows.map((r) => ({ ...r, times: monotonicTimes(def, r.times) }));
  }

  private async o2c(tx: Db, horizon: string, onlyId?: string): Promise<FlowItem[]> {
    const c = currentContext().companyId;
    const scope: SQL = onlyId
      ? sql`s.id = ${onlyId}`
      : sql`(s.date_order >= ${horizon} or s.state in ('draft', 'sent') or s.invoice_status <> 'invoiced')`;
    const rows = await tx.execute<Row>(sql`
      with so as (
        select s.id, s.name, s.state, s.date_order::text as date_order, ${iso("s.confirmed_at")} as confirmed_at,
          s.validity_date::text as validity_date, s.amount_untaxed, s.user_id, s.invoice_status, p.name as partner
        from sale_orders s left join partners p on p.id = s.partner_id
        where s.company_id = ${c} and s.state <> 'cancel' and ${scope}
      ), pk as (
        select t.sale_order_id as id,
          count(*) filter (where t.state not in ('done', 'cancel')) as open,
          count(*) filter (where t.state = 'done') as done,
          ${iso("max(t.date_done)")} as last_done,
          (min(t.scheduled_date) filter (where t.state not in ('done', 'cancel')))::text as next_due
        from stock_pickings t
        where t.sale_order_id in (select id from so) and t.picking_type = 'outgoing' and t.return_of_id is null
        group by 1
      ), src as (
        -- Faktur sumber pesanan lewat baris faktur → baris pesanan (lebih cepat dari view account_move_sources).
        select distinct sol.order_id as so_id, l.move_id
        from sale_order_lines sol join account_move_lines l on l.sale_line_id = sol.id
        where sol.order_id in (select id from so)
      ), inv as (
        select src.so_id as id, count(*) as n, max(m.date)::text as last_date,
          (min(m.due_date) filter (where m.payment_state not in ('paid', 'reversed')))::text as next_due,
          bool_and(m.payment_state in ('paid', 'reversed')) as all_paid
        from src join account_moves m on m.id = src.move_id
        where m.move_type = 'out_invoice' and m.state = 'posted'
        group by 1
      ), rec as (
        select src.so_id, pr.credit_line_id as other
        from src join account_moves m on m.id = src.move_id and m.move_type = 'out_invoice' and m.state = 'posted'
        join account_move_lines l on l.move_id = m.id join partial_reconciles pr on pr.debit_line_id = l.id
        union all
        select src.so_id, pr.debit_line_id
        from src join account_moves m on m.id = src.move_id and m.move_type = 'out_invoice' and m.state = 'posted'
        join account_move_lines l on l.move_id = m.id join partial_reconciles pr on pr.credit_line_id = l.id
      ), paid as (
        select rec.so_id as id, max(m2.date)::text as paid_at
        from rec join account_move_lines l2 on l2.id = rec.other join account_moves m2 on m2.id = l2.move_id
        where m2.move_type <> 'out_invoice'
        group by 1
      )
      select so.*, pk.open, pk.done, pk.last_done, pk.next_due as pick_due, inv.n as inv_n, inv.last_date as inv_date,
        inv.next_due as inv_due, inv.all_paid, paid.paid_at
      from so left join pk on pk.id = so.id left join inv on inv.id = so.id left join paid on paid.id = so.id`);
    return [...rows].map((r) => {
      const ordered = r.state === "sale" ? String(r.confirmed_at ?? r.date_order) : null;
      const delivered =
        ordered && !Number(r.open ?? 0) ? (Number(r.done ?? 0) ? String(r.last_done) : ordered) : null;
      const invoiced = r.invoice_status === "invoiced" && Number(r.inv_n ?? 0) ? String(r.inv_date) : null;
      const paid = invoiced && r.all_paid ? String(r.paid_at ?? r.inv_date) : null;
      const times = { quote: String(r.date_order), order: ordered, delivered, invoiced, paid };
      const stage = !ordered
        ? "quote"
        : !delivered
          ? "order"
          : !invoiced
            ? "delivered"
            : !paid
              ? "invoiced"
              : "paid";
      const due =
        stage === "quote"
          ? (r.validity_date as string | null)
          : stage === "order"
            ? (r.pick_due as string | null)
            : stage === "invoiced"
              ? (r.inv_due as string | null)
              : null;
      return {
        id: String(r.id),
        model: "sale_order" as const,
        name: String(r.name),
        partner: (r.partner as string | null) ?? null,
        times,
        due,
        value: num(r.amount_untaxed),
        ownerId: (r.user_id as string | null) ?? null,
      };
    });
  }

  private async p2p(tx: Db, horizon: string, onlyId?: string): Promise<FlowItem[]> {
    const c = currentContext().companyId;
    const scope: SQL = onlyId
      ? sql`o.id = ${onlyId}`
      : sql`(o.date_order >= ${horizon} or o.state in ('draft', 'sent', 'to_approve'))`;
    const rows = await tx.execute<Row>(sql`
      with po as (
        select o.id, o.name, o.state, o.date_order::text as date_order, o.date_planned::text as date_planned,
          ${iso("o.approval_requested_at")} as approval_at, ${iso("o.approved_at")} as approved_at,
          ${iso("o.confirmed_at")} as confirmed_at, o.amount_untaxed, o.user_id, p.name as partner
        from purchase_orders o left join partners p on p.id = o.partner_id
        where o.company_id = ${c} and o.state <> 'cancel' and ${scope}
      ), pk as (
        select t.purchase_order_id as id,
          count(*) filter (where t.state not in ('done', 'cancel')) as open,
          count(*) filter (where t.state = 'done') as done,
          ${iso("max(t.date_done)")} as last_done
        from stock_pickings t
        where t.purchase_order_id in (select id from po) and t.picking_type = 'incoming' and t.return_of_id is null
        group by 1
      ), src as (
        select distinct pol.order_id as po_id, l.move_id
        from purchase_order_lines pol join account_move_lines l on l.purchase_line_id = pol.id
        where pol.order_id in (select id from po)
      ), bill as (
        select src.po_id as id, count(*) as n, max(m.date)::text as last_date, sum(m.amount_untaxed) as billed,
          (min(m.due_date) filter (where m.payment_state not in ('paid', 'reversed')))::text as next_due,
          bool_and(m.payment_state in ('paid', 'reversed')) as all_paid
        from src join account_moves m on m.id = src.move_id
        where m.move_type = 'in_invoice' and m.state = 'posted'
        group by 1
      ), rec as (
        select src.po_id, pr.credit_line_id as other
        from src join account_moves m on m.id = src.move_id and m.move_type = 'in_invoice' and m.state = 'posted'
        join account_move_lines l on l.move_id = m.id join partial_reconciles pr on pr.debit_line_id = l.id
        union all
        select src.po_id, pr.debit_line_id
        from src join account_moves m on m.id = src.move_id and m.move_type = 'in_invoice' and m.state = 'posted'
        join account_move_lines l on l.move_id = m.id join partial_reconciles pr on pr.credit_line_id = l.id
      ), paid as (
        select rec.po_id as id, max(m2.date)::text as paid_at
        from rec join account_move_lines l2 on l2.id = rec.other join account_moves m2 on m2.id = l2.move_id
        where m2.move_type <> 'in_invoice'
        group by 1
      )
      select po.*, pk.open, pk.done, pk.last_done, bill.n as bill_n, bill.last_date as bill_date, bill.billed,
        bill.next_due as bill_due, bill.all_paid, paid.paid_at
      from po left join pk on pk.id = po.id left join bill on bill.id = po.id left join paid on paid.id = po.id`);
    return [...rows].map((r) => {
      const approval = r.approval_at ? String(r.approval_at) : null;
      const ordered = r.state === "purchase" ? String(r.confirmed_at ?? r.approved_at ?? r.date_order) : null;
      const received =
        ordered && !Number(r.open ?? 0) ? (Number(r.done ?? 0) ? String(r.last_done) : ordered) : null;
      // Tertagih penuh bila total tagihan ≥ 99,5% nilai PO (pembulatan).
      const billed =
        Number(r.bill_n ?? 0) && Number(r.billed ?? 0) >= Number(r.amount_untaxed ?? 0) * 0.995
          ? String(r.bill_date)
          : null;
      const paid = billed && r.all_paid ? String(r.paid_at ?? r.bill_date) : null;
      const times = { rfq: String(r.date_order), approval, ordered, received, billed, paid };
      const stage =
        r.state === "to_approve"
          ? "approval"
          : !ordered
            ? "rfq"
            : !received
              ? "ordered"
              : !billed
                ? "received"
                : !paid
                  ? "billed"
                  : "paid";
      const due =
        stage === "ordered"
          ? (r.date_planned as string | null)
          : stage === "billed"
            ? (r.bill_due as string | null)
            : null;
      return {
        id: String(r.id),
        model: "purchase_order" as const,
        name: String(r.name),
        partner: (r.partner as string | null) ?? null,
        // Tahap persetujuan dilewati (null) untuk PO tanpa persetujuan; posisi tetap dihitung dari urutan.
        times: stage === "approval" ? { rfq: times.rfq, approval } : times,
        due,
        value: num(r.amount_untaxed),
        ownerId: (r.user_id as string | null) ?? null,
      };
    });
  }

  private async mfg(tx: Db, horizon: string, onlyId?: string): Promise<FlowItem[]> {
    const c = currentContext().companyId;
    const scope: SQL = onlyId
      ? sql`o.id = ${onlyId}`
      : sql`(o.date_planned >= ${horizon} or o.state not in ('done'))`;
    const rows = await tx.execute<Row>(sql`
      select o.id, o.name, o.state, ${iso("o.created_at")} as created_at, ${iso("o.confirmed_at")} as confirmed_at,
        ${iso("o.started_at")} as started_at, ${iso("o.date_done")} as date_done, o.date_planned::text as date_planned,
        o.material_cost + o.conversion_cost as cost, o.created_by, pr.name as product,
        (select count(*) from quality_checks q where q.production_order_id = o.id and q.state = 'pending') as qc_pending,
        (select ${iso("max(q.decided_at)")} from quality_checks q where q.production_order_id = o.id) as qc_at
      from production_orders o left join products pr on pr.id = o.product_id
      where o.company_id = ${c} and o.state <> 'cancel' and ${scope}`);
    return [...rows].map((r) => {
      const st = String(r.state);
      const confirmed = st !== "draft" ? String(r.confirmed_at ?? r.created_at) : null;
      const started =
        st === "in_progress" || st === "done" ? ((r.started_at as string | null) ?? confirmed) : null;
      const qc = st === "done" ? String(r.date_done ?? started) : null;
      const done = qc && !Number(r.qc_pending ?? 0) ? String(r.qc_at && r.qc_at > qc ? r.qc_at : qc) : null;
      const stage = !confirmed
        ? "draft"
        : !started
          ? "confirmed"
          : !qc
            ? "in_progress"
            : !done
              ? "qc"
              : "done";
      return {
        id: String(r.id),
        model: "production_order" as const,
        name: String(r.name),
        partner: (r.product as string | null) ?? null,
        times: { draft: String(r.created_at), confirmed, in_progress: started, qc, done },
        // Rencana & terkonfirmasi: harus mulai paling lambat tanggal rencana.
        due: stage === "draft" || stage === "confirmed" ? (r.date_planned as string | null) : null,
        value: num(r.cost),
        ownerId: (r.created_by as string | null) ?? null,
      };
    });
  }

  private async h2p(tx: Db, horizon: string, onlyId?: string): Promise<FlowItem[]> {
    const c = currentContext().companyId;
    const scope: SQL = onlyId
      ? sql`(a.id = ${onlyId} or a.employee_id = ${onlyId})`
      : sql`(a.created_at >= ${horizon} or a.stage in ('new', 'screening', 'interview', 'offer'))`;
    const rows = await tx.execute<Row>(sql`
      with ap as (
        select a.id, a.name, a.stage, a.employee_id, ${iso("a.created_at")} as created_at,
          ${iso("a.hired_at")} as hired_at, j.name as opening
        from applicants a left join job_openings j on j.id = a.opening_id
        where a.company_id = ${c} and a.stage <> 'refused' and a.anonymized_at is null and ${scope}
      ), onb as (
        select h.employee_id as id, bool_and(h.state = 'done') as done,
          ${iso("max(coalesce(t.done_at, h.updated_at))")} as done_at,
          (max(t.due_date) filter (where t.done_at is null))::text as next_due
        from hr_checklists h left join hr_checklist_tasks t on t.checklist_id = h.id
        where h.kind = 'onboarding' and h.employee_id in (select employee_id from ap where employee_id is not null)
        group by 1
      ), pay as (
        select s.employee_id as id,
          (min(r.period_end) filter (where r.state in ('done', 'paid')))::text as posted_at,
          (min(r.payment_date) filter (where r.state = 'paid'))::text as paid_at,
          (min(r.payment_date) filter (where r.state = 'done'))::text as pay_due
        from payslips s join payroll_runs r on r.id = s.run_id
        where s.employee_id in (select employee_id from ap where employee_id is not null)
        group by 1
      )
      select ap.*, onb.done as onb_done, onb.done_at as onb_at, onb.next_due as onb_due,
        pay.posted_at, pay.paid_at, pay.pay_due
      from ap left join onb on onb.id = ap.employee_id left join pay on pay.id = ap.employee_id`);
    return [...rows].map((r) => {
      const hired = r.stage === "hired" ? String(r.hired_at ?? r.created_at) : null;
      // Tanpa daftar onboarding: dianggap aktif sejak diterima.
      const active =
        hired && (r.onb_done === null || r.onb_done === undefined || r.onb_done)
          ? String(r.onb_done ? (r.onb_at ?? hired) : hired)
          : null;
      const payroll = active && r.posted_at ? String(r.posted_at) : null;
      const paid = payroll && r.paid_at ? String(r.paid_at) : null;
      const stage = !hired
        ? "applying"
        : !active
          ? "hired"
          : !payroll
            ? "active"
            : !paid
              ? "payroll"
              : "paid";
      return {
        id: String(r.id),
        model: "employee" as const,
        href: `/hr/recruitment/${String(r.id)}`,
        name: String(r.name),
        partner: (r.opening as string | null) ?? null,
        times: { applying: String(r.created_at), hired, active, payroll, paid },
        due:
          stage === "hired"
            ? (r.onb_due as string | null)
            : stage === "payroll"
              ? (r.pay_due as string | null)
              : null,
        value: null,
        ownerId: null,
      };
    });
  }

  /** Dokumen yang sedang menunggu di tahapnya (posisi, departemen asal & tujuan, umur vs SLA, pemegang). */
  async handoffs(tx: Db, process: FlowProcess, onlyId?: string) {
    const def = FLOW_DEFS[process];
    const items = await this.items(tx, process, onlyId ? { onlyId } : {});
    const settings = await this.settings(tx, process);
    const owners = await this.owners(tx, items.map((i) => i.ownerId ?? "").filter(Boolean));
    return handoffItems(def, onlyId ? items.filter((i) => i.id === onlyId) : items, {
      today: businessToday(),
      sla: settings.sla,
      departments: settings.departments,
      owners,
    });
  }

  /** Nama & departemen pemilik dokumen (user → karyawan di perusahaan aktif → departemen). */
  async owners(tx: Db, userIds: string[]): Promise<Map<string, FlowOwner & { departmentId: string | null }>> {
    const ids = [...new Set(userIds.filter(Boolean))];
    const out = new Map<string, FlowOwner & { departmentId: string | null }>();
    if (!ids.length) return out;
    const c = currentContext().companyId;
    const U = schema.users;
    const E = schema.employees;
    const D = schema.departments;
    const rows = await tx
      .select({ id: U.id, name: U.name, departmentId: D.id, department: D.name })
      .from(U)
      .leftJoin(E, and(eq(E.userId, U.id), eq(E.companyId, c)))
      .leftJoin(D, eq(D.id, E.departmentId))
      .where(inArray(U.id, ids));
    for (const r of rows)
      if (!out.has(r.id))
        out.set(r.id, {
          name: r.name,
          departmentId: r.departmentId ?? null,
          department: r.department ?? null,
        });
    return out;
  }

  /**
   * SLA & departemen penanggung jawab per tahap. Pengaturan perusahaan menimpa bawaan; departemen yang belum
   * ditetapkan dicocokkan otomatis dari nama departemen perusahaan (mis. tahap Gudang → "Gudang & Logistik").
   */
  async settings(tx: Db, process: FlowProcess) {
    const c = currentContext().companyId;
    const S = schema.flowStageSettings;
    const rows = await tx
      .select()
      .from(S)
      .where(and(eq(S.companyId, c), eq(S.process, process)));
    const D = schema.departments;
    const deps = await tx
      .select({ id: D.id, name: D.name })
      .from(D)
      .where(and(eq(D.companyId, c), eq(D.active, true)))
      .orderBy(D.name);
    const def = FLOW_DEFS[process];
    const sla: Record<string, number | null> = {};
    const departments: Record<string, string | null> = {};
    const configured: Record<string, string | null> = {};
    const auto: Record<string, string | null> = {};
    for (const s of def.stages) {
      const r = rows.find((x) => x.stage === s.key);
      sla[s.key] = s.slaDays === null ? null : (r?.slaDays ?? s.slaDays);
      configured[s.key] = r?.departmentId ?? null;
      auto[s.key] = autoDepartment(s.dept, deps);
      departments[s.key] = configured[s.key] ?? auto[s.key] ?? null;
    }
    return { sla, departments, configured, auto };
  }
}
