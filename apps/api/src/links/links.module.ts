import {
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
} from "@nestjs/common";
import { sql, type Db, type SQL } from "@erp/db";
import { isRecordModel, RECORD_MODELS, type RecordModel, type RecordModelDef } from "@erp/shared";
import { TenantDb } from "../common/database.js";
import { companiesWith } from "../common/request-context.js";

/** Tabel & ekspresi nama tiap model (konstanta, bukan masukan pengguna; alias tabel `t`). */
export const TABLES: Record<RecordModel, { table: string; name: string }> = {
  account_move: { table: "account_moves", name: "coalesce(t.name, '(draft)')" },
  payment: { table: "payments", name: "(select x.name from account_moves x where x.id = t.move_id)" },
  bank_statement: { table: "bank_statements", name: "t.name" },
  asset: { table: "assets", name: "t.name" },
  fx_revaluation: { table: "fx_revaluations", name: "to_char(t.date, 'YYYY-MM-DD')" },
  allocation_run: { table: "allocation_runs", name: "to_char(t.period, 'YYYY-MM')" },
  payment_run: { table: "payment_runs", name: "t.name" },
  sale_order: { table: "sale_orders", name: "t.name" },
  purchase_order: { table: "purchase_orders", name: "t.name" },
  stock_picking: { table: "stock_pickings", name: "t.name" },
  landed_cost: { table: "landed_costs", name: "t.name" },
  production_order: { table: "production_orders", name: "t.name" },
  quality_check: { table: "quality_checks", name: "t.name" },
  maintenance_request: { table: "maintenance_requests", name: "t.name || ' ' || t.title" },
  fleet_service: {
    table: "fleet_services",
    name: "coalesce((select v.license_plate from fleet_vehicles v where v.id = t.vehicle_id) || ' ', '') || to_char(t.date, 'YYYY-MM-DD')",
  },
  payroll_run: { table: "payroll_runs", name: "t.name" },
  payslip: { table: "payslips", name: "(select e.name from employees e where e.id = t.employee_id)" },
  employee_loan: { table: "employee_loans", name: "t.name" },
  severance: { table: "severances", name: "(select e.name from employees e where e.id = t.employee_id)" },
  expense_claim: { table: "expense_claims", name: "t.name" },
  tax_invoice: { table: "tax_invoices", name: "coalesce(t.efaktur_number, t.ref, '(draft)')" },
  input_tax_invoice: { table: "input_tax_invoices", name: "t.efaktur_number" },
  withholding_slip: {
    table: "withholding_slips",
    name: "coalesce(t.bupot_number, t.document_number, '(draft)')",
  },
  tax_return: { table: "tax_returns", name: "coalesce(t.return_number, '(draft)')" },
  partner: { table: "partners", name: "t.name" },
  product: { table: "products", name: "t.name" },
  employee: { table: "employees", name: "t.name" },
  crm_lead: { table: "crm_leads", name: "t.name" },
  support_ticket: { table: "support_tickets", name: "t.number || ' ' || t.subject" },
};

type Direction = "upstream" | "downstream";
/** Relasi: query yang mengembalikan `id` (+ opsional `date`, `amount`, `state`) dokumen target. */
interface Relation {
  key: string;
  model: RecordModel;
  direction: Direction;
  label?: [string, string];
  query: (id: string) => SQL;
}

const LIMIT = 20;
const MOVE_COLS = sql`m.id, m.date, m.amount_total as amount, m.state`;

const rel = (
  key: string,
  model: RecordModel,
  direction: Direction,
  query: (id: string) => SQL,
  label?: [string, string],
): Relation => ({ key, model, direction, query, label });

/** Jurnal yang dibuat dari dokumen (berlaku untuk semua model kecuali jurnal itu sendiri). */
export const journalsOf = (model: RecordModel) =>
  rel(
    "journal",
    "account_move",
    "downstream",
    (id) => sql`
      select distinct ${MOVE_COLS} from account_move_sources s join account_moves m on m.id = s.move_id
      where s.source_model = ${model} and s.source_id = ${id}`,
    model === "account_move" ? ["Jurnal turunan", "Derived entries"] : ["Entri jurnal", "Journal entries"],
  );

const byColumn = (
  key: string,
  model: RecordModel,
  direction: Direction,
  table: string,
  column: string,
  extra: { date?: string; amount?: string; state?: string } = {},
  label?: [string, string],
) =>
  rel(
    key,
    model,
    direction,
    (id) => sql`
      select t.id, ${sql.raw(extra.date ?? "null::date")} as date, ${sql.raw(extra.amount ?? "null::numeric")} as amount,
        ${sql.raw(extra.state ?? "null::text")} as state
      from ${sql.raw(table)} t where ${sql.raw(`t.${column}`)} = ${id}`,
    label,
  );

/** Dokumen yang ditunjuk kolom FK pada dokumen ini (`select <col> from <table> where id = $id`). */
const parent = (key: string, model: RecordModel, table: string, column: string, label?: [string, string]) =>
  rel(
    key,
    model,
    "upstream",
    (id) => sql`
      select p as id, null::date as date, null::numeric as amount, null::text as state
      from (select ${sql.raw(`t.${column}`)} as p from ${sql.raw(table)} t where t.id = ${id}) x where p is not null`,
    label,
  );

const SO = { date: "t.date_order", amount: "t.amount_total", state: "t.state" };
const PICK = { date: "t.scheduled_date", state: "t.state" };

/** Jurnal lawan rekonsiliasi (pembayaran ↔ faktur) dari jurnal-jurnal hasil subquery `moves`. */
const reconciledWith = (moves: (id: string) => SQL) =>
  rel(
    "reconciled",
    "account_move",
    "downstream",
    (id) => sql`
      select distinct ${MOVE_COLS}
      from account_move_lines l
      join partial_reconciles pr on pr.debit_line_id = l.id or pr.credit_line_id = l.id
      join account_move_lines l2
        on l2.id = case when pr.debit_line_id = l.id then pr.credit_line_id else pr.debit_line_id end
      join account_moves m on m.id = l2.move_id
      where l.move_id in (${moves(id)}) and m.id not in (${moves(id)})`,
    ["Rekonsiliasi (pembayaran/faktur)", "Reconciled (payments/invoices)"],
  );

export const RELATIONS: Partial<Record<RecordModel, Relation[]>> = {
  account_move: [
    reconciledWith((id) => sql`select ${id}::uuid`),
    byColumn("tax_invoice", "tax_invoice", "downstream", "tax_invoices", "move_id", {
      date: "t.invoice_date",
      amount: "t.vat",
      state: "t.state",
    }),
    byColumn("input_tax", "input_tax_invoice", "downstream", "input_tax_invoices", "move_id", {
      date: "t.invoice_date",
    }),
    byColumn("withholding", "withholding_slip", "downstream", "withholding_slips", "move_id", {
      amount: "t.tax_amount",
      state: "t.state",
    }),
    byColumn("tax_return", "tax_return", "downstream", "tax_returns", "move_id", { state: "t.state" }),
    byColumn("landed_cost", "landed_cost", "downstream", "landed_costs", "vendor_bill_id", {
      date: "t.date",
    }),
    byColumn("asset_disposal", "asset", "downstream", "assets", "disposal_invoice_id"),
    rel(
      "payment_run",
      "payment_run",
      "downstream",
      (id) => sql`
        select distinct r.id, r.payment_date as date, null::numeric as amount, r.state
        from payment_run_lines pl join payment_runs r on r.id = pl.run_id where pl.move_id = ${id}`,
    ),
    parent("partner", "partner", "account_moves", "partner_id"),
  ],
  payment: [
    reconciledWith(
      (id) => sql`select p.move_id from payments p where p.id = ${id} and p.move_id is not null`,
    ),
    parent("partner", "partner", "payments", "partner_id"),
  ],
  sale_order: [
    parent("partner", "partner", "sale_orders", "partner_id"),
    parent("lead", "crm_lead", "sale_orders", "lead_id"),
    parent("ic_purchase", "purchase_order", "sale_orders", "ic_purchase_order_id"),
    byColumn("pickings", "stock_picking", "downstream", "stock_pickings", "sale_order_id", PICK),
    byColumn("dropship", "purchase_order", "downstream", "purchase_orders", "dropship_sale_order_id", SO),
    reconciledWith(
      (id) =>
        sql`select s.move_id from account_move_sources s where s.source_model = 'sale_order' and s.source_id = ${id}`,
    ),
  ],
  purchase_order: [
    parent("partner", "partner", "purchase_orders", "partner_id"),
    parent("dropship", "sale_order", "purchase_orders", "dropship_sale_order_id"),
    parent("ic_sale", "sale_order", "purchase_orders", "ic_sale_order_id"),
    byColumn("pickings", "stock_picking", "downstream", "stock_pickings", "purchase_order_id", PICK),
    reconciledWith(
      (id) =>
        sql`select s.move_id from account_move_sources s where s.source_model = 'purchase_order' and s.source_id = ${id}`,
    ),
  ],
  stock_picking: [
    parent("sale_order", "sale_order", "stock_pickings", "sale_order_id"),
    parent("purchase_order", "purchase_order", "stock_pickings", "purchase_order_id"),
    parent("return_of", "stock_picking", "stock_pickings", "return_of_id", ["Retur dari", "Return of"]),
    parent("backorder_of", "stock_picking", "stock_pickings", "backorder_of_id", [
      "Backorder dari",
      "Backorder of",
    ]),
    parent("partner", "partner", "stock_pickings", "partner_id"),
    byColumn("returns", "stock_picking", "downstream", "stock_pickings", "return_of_id", PICK, [
      "Retur",
      "Returns",
    ]),
    byColumn("backorders", "stock_picking", "downstream", "stock_pickings", "backorder_of_id", PICK, [
      "Backorder",
      "Backorders",
    ]),
    byColumn("quality", "quality_check", "downstream", "quality_checks", "picking_id", { state: "t.state" }),
  ],
  landed_cost: [
    parent("vendor_bill", "account_move", "landed_costs", "vendor_bill_id", [
      "Tagihan vendor",
      "Vendor bill",
    ]),
  ],
  asset: [
    parent("disposal_invoice", "account_move", "assets", "disposal_invoice_id", [
      "Faktur pelepasan",
      "Disposal invoice",
    ]),
  ],
  payslip: [
    parent("run", "payroll_run", "payslips", "run_id"),
    parent("employee", "employee", "payslips", "employee_id"),
    byColumn("expenses", "expense_claim", "downstream", "expense_claims", "payslip_id", { date: "t.date" }),
    byColumn("withholding", "withholding_slip", "downstream", "withholding_slips", "payslip_id", {
      amount: "t.tax_amount",
      state: "t.state",
    }),
  ],
  payroll_run: [byColumn("payslips", "payslip", "downstream", "payslips", "run_id", { amount: "t.net" })],
  expense_claim: [
    parent("employee", "employee", "expense_claims", "employee_id"),
    parent("payslip", "payslip", "expense_claims", "payslip_id"),
  ],
  employee_loan: [parent("employee", "employee", "employee_loans", "employee_id")],
  severance: [parent("employee", "employee", "severances", "employee_id")],
  production_order: [
    byColumn("quality", "quality_check", "downstream", "quality_checks", "production_order_id", {
      state: "t.state",
    }),
  ],
  quality_check: [
    parent("picking", "stock_picking", "quality_checks", "picking_id"),
    parent("production", "production_order", "quality_checks", "production_order_id"),
    parent("return_picking", "stock_picking", "quality_checks", "return_picking_id", ["Retur", "Return"]),
  ],
  crm_lead: [
    parent("partner", "partner", "crm_leads", "partner_id"),
    byColumn("orders", "sale_order", "downstream", "sale_orders", "lead_id", SO),
    byColumn("tickets", "support_ticket", "downstream", "support_tickets", "lead_id", { state: "t.status" }),
  ],
  support_ticket: [
    parent("partner", "partner", "support_tickets", "partner_id"),
    parent("lead", "crm_lead", "support_tickets", "lead_id"),
  ],
  partner: [
    byColumn("sale_orders", "sale_order", "downstream", "sale_orders", "partner_id", SO),
    byColumn("purchase_orders", "purchase_order", "downstream", "purchase_orders", "partner_id", SO),
    rel(
      "invoices",
      "account_move",
      "downstream",
      (id) => sql`
        select ${MOVE_COLS} from account_moves m where m.partner_id = ${id} and m.move_type <> 'entry'`,
      ["Faktur & tagihan", "Invoices & bills"],
    ),
    byColumn("payments", "payment", "downstream", "payments", "partner_id", {
      date: "t.date",
      amount: "t.amount",
    }),
    byColumn("pickings", "stock_picking", "downstream", "stock_pickings", "partner_id", PICK),
    rel(
      "leads",
      "crm_lead",
      "downstream",
      (id) => sql`
        select t.id, null::date as date, t.expected_revenue as amount, t.state
        from crm_leads t where t.partner_id = ${id} or t.contact_id = ${id}`,
    ),
    rel(
      "tickets",
      "support_ticket",
      "downstream",
      (id) => sql`
        select t.id, t.created_at::date as date, null::numeric as amount, t.status as state
        from support_tickets t where t.partner_id = ${id} or t.contact_id = ${id}`,
    ),
  ],
};

export interface LinkGroup {
  key: string;
  model: RecordModel;
  label: [string, string];
  direction: Direction;
  count: number;
  items: {
    id: string;
    name: string | null;
    date: string | null;
    amount: string | null;
    state: string | null;
  }[];
}

@Injectable()
export class LinksService {
  /** Dokumen terkait (asal & turunan) sebuah dokumen; hanya yang boleh dibaca pemanggil. */
  async related(
    tx: Db,
    model: string,
    id: string,
  ): Promise<{ model: RecordModel; id: string; groups: LinkGroup[] }> {
    if (!isRecordModel(model)) throw new NotFoundException("Jenis dokumen tidak dikenal");
    const base = (await this.describe(tx, model, [id]))[0];
    if (!base || !this.readable(RECORD_MODELS[model], base.company_id))
      throw new NotFoundException("Dokumen tidak ditemukan");

    const groups: LinkGroup[] = [];
    // Dokumen asal sebuah jurnal: beragam model, dibaca dari view sumber.
    if (model === "account_move") {
      const sources = await tx.execute<{ source_model: string; source_id: string }>(sql`
        select distinct source_model, source_id from account_move_sources where move_id = ${id}`);
      const byModel = new Map<RecordModel, string[]>();
      for (const s of sources)
        if (isRecordModel(s.source_model))
          byModel.set(s.source_model, [...(byModel.get(s.source_model) ?? []), s.source_id]);
      for (const [m, ids] of byModel) {
        const g = await this.group(tx, {
          key: `source_${m}`,
          model: m,
          direction: "upstream",
          label: m === "account_move" ? ["Jurnal asal", "Original entry"] : undefined,
          rows: ids.map((x) => ({ id: x, date: null, amount: null, state: null, total: ids.length })),
        });
        if (g) groups.push(g);
      }
    }
    const relations = [...(RELATIONS[model] ?? []), journalsOf(model)];
    for (const r of relations) {
      const rows = await tx.execute<{
        id: string;
        date: string | null;
        amount: string | null;
        state: string | null;
        total: number;
      }>(sql`
        select x.id, x.date::text as date, x.amount::text as amount, x.state, count(*) over ()::int as total
        from (${r.query(id)}) x
        order by x.date desc nulls last, x.id
        limit ${LIMIT}`);
      const g = await this.group(tx, {
        key: r.key,
        model: r.model,
        direction: r.direction,
        label: r.label,
        rows,
      });
      if (g) groups.push(g);
    }
    return { model, id, groups };
  }

  private async group(
    tx: Db,
    g: {
      key: string;
      model: RecordModel;
      direction: Direction;
      label?: [string, string];
      rows: { id: string; date: string | null; amount: string | null; state: string | null; total: number }[];
    },
  ): Promise<LinkGroup | null> {
    if (!g.rows.length) return null;
    const def: RecordModelDef = RECORD_MODELS[g.model];
    const described = new Map(
      (
        await this.describe(
          tx,
          g.model,
          g.rows.map((r) => r.id),
        )
      ).map((d) => [d.id, d]),
    );
    const items = g.rows
      .filter((r) => {
        const d = described.get(r.id);
        return d && this.readable(def, d.company_id);
      })
      .map((r) => ({
        id: r.id,
        name: described.get(r.id)!.name,
        date: r.date,
        amount: r.amount,
        state: r.state,
      }));
    if (!items.length) return null;
    // Jumlah total hanya ditampilkan bila semua baris yang terlihat boleh dibaca (tanpa menghitung yang tersembunyi).
    const count = items.length === g.rows.length ? Math.max(g.rows[0]!.total, items.length) : items.length;
    return { key: g.key, model: g.model, label: g.label ?? def.label, direction: g.direction, count, items };
  }

  /** Nama & perusahaan dokumen. */
  private async describe(tx: Db, model: RecordModel, ids: string[]) {
    if (!ids.length) return [];
    const t = TABLES[model];
    return tx.execute<{ id: string; name: string | null; company_id: string | null }>(sql`
      select t.id, ${sql.raw(t.name)} as name, t.company_id
      from ${sql.raw(t.table)} t
      where t.id in (${sql.join(
        ids.map((x) => sql`${x}::uuid`),
        sql`, `,
      )})`);
  }

  private readable(def: RecordModelDef, companyId: string | null) {
    const companies = companiesWith(def.permission, def.apiPath);
    return companyId === null ? companies.length > 0 : companies.includes(companyId);
  }
}

@Controller("links")
export class LinksController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(LinksService) private readonly links: LinksService,
  ) {}

  /** Dokumen terkait: `GET /links/sale_order/<id>`. */
  @Get(":model/:id")
  related(@Param("model") model: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.links.related(tx, model, id));
  }
}

@Module({ controllers: [LinksController], providers: [LinksService], exports: [LinksService] })
export class LinksModule {}
