import {
  aliasedTable,
  and,
  asc,
  eq,
  gte,
  inArray,
  lte,
  ne,
  schema,
  sql,
  type Db,
  type PgColumn,
} from "@erp/db";
import {
  CHECK_STATE_LABEL,
  formatCustomValue,
  LEAD_STATUS_LABEL,
  QUALITY_TRIGGER_LABEL,
  REQUEST_STATE_LABEL,
  CASH_CATEGORIES,
  cashCategory,
  type CustomFieldModel,
  type RecordModel,
  businessToday,
} from "@erp/shared";
import { fleetCostRows } from "../fleet/fleet-costs.js";
import { loadCustomDefs } from "../customization/custom-values.js";
import type { Column, Ctx, Dataset } from "../hr/data-transfer/core.js";

type Row = Record<string, unknown>;
type Query = Record<string, string | undefined>;

const month = (d: unknown) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 7) : "");
const day = (d: unknown) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : "");
const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const DATE_FILTERS: NonNullable<Dataset["filters"]> = [
  { key: "from", label: "Dari tanggal", type: "date" },
  { key: "to", label: "Sampai tanggal", type: "date" },
];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const range = (col: PgColumn, q: Query) =>
  and(
    q.from && ISO.test(q.from) ? gte(col, q.from) : undefined,
    q.to && ISO.test(q.to) ? lte(col, q.to) : undefined,
  );
const rangeTs = (col: PgColumn, q: Query) =>
  and(
    q.from && ISO.test(q.from) ? sql`${col} >= ${q.from}::date` : undefined,
    q.to && ISO.test(q.to) ? sql`${col} < (${q.to}::date + 1)` : undefined,
  );

/** Kolom field kustom model (tampil di laporan), angka tetap angka agar bisa dijumlah. */
async function customColumns(tx: Db, model: CustomFieldModel, ctx: Ctx): Promise<Column[]> {
  const defs = await loadCustomDefs(tx, model, { companyId: ctx.companyId, activeOnly: true });
  return defs.map((d) => ({
    key: `custom.${d.key}`,
    header: d.label,
    group: "Field kustom",
    numeric: d.fieldType === "number" || d.fieldType === "money",
  }));
}
async function customValues(tx: Db, model: CustomFieldModel, ctx: Ctx) {
  const defs = await loadCustomDefs(tx, model, { companyId: ctx.companyId, activeOnly: true });
  return (custom: unknown) => {
    const c = (custom ?? {}) as Record<string, unknown>;
    return Object.fromEntries(
      defs.map((d) => [
        `custom.${d.key}`,
        d.fieldType === "number" || d.fieldType === "money" ? n(c[d.key]) : formatCustomValue(d, c[d.key]),
      ]),
    );
  };
}

const col = (key: string, header: string, group: string, numeric = false): Column => ({
  key,
  header,
  group,
  numeric,
});

const SO_STATE: Record<string, string> = {
  draft: "Penawaran",
  sent: "Terkirim",
  sale: "Pesanan",
  cancel: "Batal",
};
const PO_STATE: Record<string, string> = {
  draft: "RFQ",
  sent: "RFQ terkirim",
  to_approve: "Menunggu persetujuan",
  purchase: "Pesanan",
  cancel: "Batal",
};
const MOVE_TYPE: Record<string, string> = {
  out_invoice: "Faktur pelanggan",
  out_refund: "Nota kredit pelanggan",
  in_invoice: "Tagihan pemasok",
  in_refund: "Nota kredit pemasok",
  entry: "Jurnal umum",
};
const PAYMENT_STATE: Record<string, string> = {
  not_paid: "Belum dibayar",
  partial: "Sebagian",
  paid: "Lunas",
  in_payment: "Dalam pembayaran",
  reversed: "Dibalik",
};
const MO_STATE: Record<string, string> = {
  draft: "Draft",
  confirmed: "Dikonfirmasi",
  in_progress: "Berjalan",
  done: "Selesai",
  cancel: "Batal",
};

/** Hari lewat jatuh tempo → kelompok umur. */
const agingBucket = (days: number | null, residual: number) => {
  if (!residual) return "Lunas";
  // Diberi nomor urut agar pengelompokan & grafik tersusun dari yang belum jatuh tempo ke yang terlama.
  if (days === null || days <= 0) return "1. Belum jatuh tempo";
  if (days <= 30) return "2. 1-30 hari";
  if (days <= 60) return "3. 31-60 hari";
  if (days <= 90) return "4. 61-90 hari";
  return "5. > 90 hari";
};

/** Dokumen sumber baris (kunci tersembunyi untuk drilldown; tidak menjadi kolom). */
const ref = (model: RecordModel, id: string) => ({ _model: model, _id: id });

const O = schema.saleOrders;
const OL = schema.saleOrderLines;
const P = schema.partners;
const U = schema.users;
const PR = schema.products;
const PC = schema.productCategories;

function saleOrders(): Dataset {
  return {
    key: "sales_orders",
    label: "Pesanan penjualan",
    description: "Penawaran & pesanan penjualan: pelanggan, salesperson, status, nilai.",
    app: "sales",
    read: "sales.read",
    admin: "sales.manage",
    filters: DATE_FILTERS,
    async columns(tx, ctx) {
      return [
        col("name", "Nomor", "Pesanan"),
        col("dateOrder", "Tanggal", "Pesanan"),
        col("month", "Bulan", "Pesanan"),
        col("partner", "Pelanggan", "Pesanan"),
        col("salesperson", "Salesperson", "Pesanan"),
        col("team", "Tim penjualan", "Pesanan"),
        col("state", "Status", "Pesanan"),
        col("invoiceStatus", "Status tagih", "Pesanan"),
        col("amountUntaxed", "Total sebelum pajak", "Nilai", true),
        col("amountTax", "Pajak", "Nilai", true),
        col("amountTotal", "Total", "Nilai", true),
        col("currency", "Mata uang", "Nilai"),
        ...(await customColumns(tx, "sale_order", ctx)),
      ];
    },
    async rows(tx, ctx, q) {
      const custom = await customValues(tx, "sale_order", ctx);
      const rows = await tx
        .select({ o: O, partner: P.name, user: U.name, team: schema.salesTeams.name })
        .from(O)
        .innerJoin(P, eq(P.id, O.partnerId))
        .leftJoin(U, eq(U.id, O.userId))
        .leftJoin(schema.salesTeams, eq(schema.salesTeams.id, O.teamId))
        .where(and(eq(O.companyId, ctx.companyId), range(O.dateOrder, q)))
        .orderBy(asc(O.dateOrder));
      return rows.map(({ o, partner, user, team }) => ({
        ...ref("sale_order", o.id),
        _partnerId: o.partnerId,
        _userId: o.userId ?? "",
        name: o.name,
        dateOrder: o.dateOrder,
        month: month(o.dateOrder),
        partner,
        salesperson: user ?? "",
        team: team ?? "",
        state: SO_STATE[o.state] ?? o.state,
        invoiceStatus: { no: "Tidak ada", to_invoice: "Perlu ditagih", invoiced: "Sudah ditagih" }[
          o.invoiceStatus as string
        ],
        amountUntaxed: n(o.amountUntaxed),
        amountTax: n(o.amountTax),
        amountTotal: n(o.amountTotal),
        currency: o.currencyCode,
        ...custom(o.custom),
      }));
    },
  };
}

function saleLines(): Dataset {
  return {
    key: "sales_lines",
    label: "Baris penjualan (produk)",
    description: "Baris pesanan penjualan terkonfirmasi: produk, kategori, kuantitas, nilai per pelanggan.",
    app: "sales",
    read: "sales.read",
    admin: "sales.manage",
    filters: DATE_FILTERS,
    columns: () => [
      col("order", "Nomor pesanan", "Pesanan"),
      col("dateOrder", "Tanggal", "Pesanan"),
      col("month", "Bulan", "Pesanan"),
      col("partner", "Pelanggan", "Pesanan"),
      col("salesperson", "Salesperson", "Pesanan"),
      col("sku", "SKU", "Produk"),
      col("product", "Produk", "Produk"),
      col("category", "Kategori", "Produk"),
      col("quantity", "Kuantitas", "Nilai", true),
      col("priceUnit", "Harga satuan", "Nilai", true),
      col("subtotal", "Subtotal", "Nilai", true),
    ],
    async rows(tx, ctx, q) {
      const rows = await tx
        .select({
          orderId: O.id,
          partnerId: O.partnerId,
          userId: O.userId,
          productId: OL.productId,
          order: O.name,
          dateOrder: O.dateOrder,
          partner: P.name,
          user: U.name,
          sku: PR.sku,
          product: PR.name,
          category: PC.name,
          name: OL.name,
          quantity: OL.quantity,
          priceUnit: OL.priceUnit,
          subtotal: OL.priceSubtotal,
        })
        .from(OL)
        .innerJoin(O, eq(O.id, OL.orderId))
        .innerJoin(P, eq(P.id, O.partnerId))
        .leftJoin(U, eq(U.id, O.userId))
        .leftJoin(PR, eq(PR.id, OL.productId))
        .leftJoin(PC, eq(PC.id, PR.categoryId))
        .where(
          and(
            eq(O.companyId, ctx.companyId),
            eq(O.state, "sale"),
            eq(OL.isDownpayment, false),
            range(O.dateOrder, q),
          ),
        )
        .orderBy(asc(O.dateOrder));
      return rows.map((r) => ({
        ...ref("sale_order", r.orderId),
        _partnerId: r.partnerId,
        _userId: r.userId ?? "",
        _productId: r.productId ?? "",
        order: r.order,
        dateOrder: r.dateOrder,
        month: month(r.dateOrder),
        partner: r.partner,
        salesperson: r.user ?? "",
        sku: r.sku ?? "",
        product: r.product ?? r.name,
        category: r.category ?? "",
        quantity: n(r.quantity),
        priceUnit: n(r.priceUnit),
        subtotal: n(r.subtotal),
      }));
    },
  };
}

function crmLeads(): Dataset {
  const L = schema.crmLeads;
  return {
    key: "crm_leads",
    label: "Lead & peluang CRM",
    description: "Lead dan peluang: tahap, salesperson, nilai harapan, probabilitas, status.",
    app: "crm",
    read: "crm.read",
    admin: "crm.manage",
    filters: DATE_FILTERS,
    async columns(tx, ctx) {
      return [
        col("name", "Judul", "Lead"),
        col("leadType", "Jenis", "Lead"),
        col("leadStatus", "Status lead", "Lead"),
        col("campaign", "Kampanye", "Lead"),
        col("score", "Skor lead", "Nilai", true),
        col("industry", "Industri", "Lead"),
        col("city", "Kota", "Lead"),
        col("created", "Tanggal dibuat", "Lead"),
        col("month", "Bulan dibuat", "Lead"),
        col("partner", "Pelanggan", "Lead"),
        col("source", "Sumber", "Lead"),
        col("stage", "Tahap", "Lead"),
        col("salesperson", "Salesperson", "Lead"),
        col("team", "Tim penjualan", "Lead"),
        col("state", "Status", "Lead"),
        col("expectedClose", "Perkiraan tutup", "Lead"),
        col("closed", "Tanggal tutup", "Lead"),
        col("expectedRevenue", "Nilai harapan", "Nilai", true),
        col("probability", "Probabilitas (%)", "Nilai", true),
        col("weighted", "Nilai tertimbang", "Nilai", true),
        ...(await customColumns(tx, "crm_lead", ctx)),
      ];
    },
    async rows(tx, ctx, q) {
      const custom = await customValues(tx, "crm_lead", ctx);
      const rows = await tx
        .select({
          l: L,
          partner: P.name,
          user: U.name,
          stage: schema.crmStages.name,
          team: schema.salesTeams.name,
          campaign: schema.crmCampaigns.name,
        })
        .from(L)
        .leftJoin(P, eq(P.id, L.partnerId))
        .leftJoin(U, eq(U.id, L.userId))
        .leftJoin(schema.crmStages, eq(schema.crmStages.id, L.stageId))
        .leftJoin(schema.salesTeams, eq(schema.salesTeams.id, L.teamId))
        .leftJoin(schema.crmCampaigns, eq(schema.crmCampaigns.id, L.campaignId))
        .where(and(eq(L.companyId, ctx.companyId), rangeTs(L.createdAt, q)))
        .orderBy(asc(L.createdAt));
      return rows.map(({ l, partner, user, stage, team, campaign }) => {
        const revenue = n(l.expectedRevenue) ?? 0;
        const prob = n(l.probability) ?? 0;
        return {
          ...ref("crm_lead", l.id),
          _stageId: l.stageId ?? "",
          _userId: l.userId ?? "",
          _state: l.state,
          name: l.name,
          leadType: l.leadType === "lead" ? "Lead" : "Peluang",
          leadStatus: LEAD_STATUS_LABEL[l.leadStatus]?.[0] ?? l.leadStatus,
          campaign,
          score: l.score,
          industry: l.industry,
          city: l.city,
          created: day(l.createdAt),
          month: month(l.createdAt),
          partner: partner ?? l.partnerName ?? "",
          source: l.source ?? "",
          stage: stage ?? "",
          salesperson: user ?? "",
          team: team ?? "",
          state: { open: "Terbuka", won: "Menang", lost: "Kalah" }[l.state as string] ?? l.state,
          expectedClose: l.expectedClose ?? "",
          closed: day(l.closedAt),
          expectedRevenue: revenue,
          probability: prob,
          weighted: Math.round(revenue * prob) / 100,
          ...custom(l.custom),
        };
      });
    },
  };
}

const M = schema.accountMoves;
const ML = schema.accountMoveLines;
const A = schema.accounts;

function invoices(): Dataset {
  return {
    key: "invoices",
    label: "Faktur & tagihan",
    description:
      "Faktur pelanggan, tagihan pemasok, dan nota kredit terposting: sisa, jatuh tempo, umur piutang/utang.",
    app: "accounting",
    read: "accounting.read",
    admin: "accounting.manage",
    filters: [
      ...DATE_FILTERS,
      {
        key: "kind",
        label: "Jenis",
        type: "select",
        options: [
          ["customer", "Pelanggan"],
          ["vendor", "Pemasok"],
        ],
      },
    ],
    async columns(tx, ctx) {
      return [
        col("name", "Nomor", "Dokumen"),
        col("moveType", "Jenis", "Dokumen"),
        col("side", "Pelanggan/pemasok", "Dokumen"),
        col("date", "Tanggal", "Dokumen"),
        col("month", "Bulan", "Dokumen"),
        col("dueDate", "Jatuh tempo", "Dokumen"),
        col("partner", "Partner", "Dokumen"),
        col("paymentState", "Status bayar", "Dokumen"),
        col("overdueDays", "Hari lewat jatuh tempo", "Umur", true),
        col("aging", "Kelompok umur", "Umur"),
        col("amountUntaxed", "Total sebelum pajak", "Nilai", true),
        col("amountTax", "Pajak", "Nilai", true),
        col("amountTotal", "Total", "Nilai", true),
        col("amountResidual", "Sisa", "Nilai", true),
        col("currency", "Mata uang", "Nilai"),
        ...(await customColumns(tx, "account_move", ctx)),
      ];
    },
    async rows(tx, ctx, q) {
      const custom = await customValues(tx, "account_move", ctx);
      const types =
        q.kind === "customer"
          ? (["out_invoice", "out_refund"] as const)
          : q.kind === "vendor"
            ? (["in_invoice", "in_refund"] as const)
            : (["out_invoice", "out_refund", "in_invoice", "in_refund"] as const);
      const rows = await tx
        .select({ m: M, partner: P.name })
        .from(M)
        .leftJoin(P, eq(P.id, M.partnerId))
        .where(
          and(
            eq(M.companyId, ctx.companyId),
            eq(M.state, "posted"),
            inArray(M.moveType, [...types]),
            range(M.date, q),
          ),
        )
        .orderBy(asc(M.date));
      const today = businessToday();
      return rows.map(({ m, partner }) => {
        const sign = m.moveType.endsWith("refund") ? -1 : 1;
        const residual = (n(m.amountResidual) ?? 0) * sign;
        const overdue =
          m.dueDate && residual
            ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${m.dueDate}T00:00:00Z`)) / 864e5)
            : null;
        return {
          ...ref("account_move", m.id),
          _partnerId: m.partnerId ?? "",
          // Pemilik untuk KPI pribadi: yang memposting (atau pembuatnya).
          _userId: m.postedBy ?? m.createdBy ?? "",
          name: m.name,
          moveType: MOVE_TYPE[m.moveType] ?? m.moveType,
          side: m.moveType.startsWith("out") ? "Pelanggan" : "Pemasok",
          date: m.date,
          month: month(m.date),
          dueDate: m.dueDate ?? "",
          partner: partner ?? "",
          paymentState: PAYMENT_STATE[m.paymentState as string] ?? m.paymentState,
          overdueDays: overdue !== null && overdue > 0 ? overdue : 0,
          aging: agingBucket(overdue, residual),
          amountUntaxed: (n(m.amountUntaxed) ?? 0) * sign,
          amountTax: (n(m.amountTax) ?? 0) * sign,
          amountTotal: (n(m.amountTotal) ?? 0) * sign,
          amountResidual: residual,
          currency: m.currencyCode,
          ...custom(m.custom),
        };
      });
    },
  };
}

const ACCOUNT_TYPE: Record<string, string> = {
  asset_receivable: "Piutang",
  asset_cash: "Kas & bank",
  asset_current: "Aset lancar",
  asset_non_current: "Aset tidak lancar",
  asset_prepayments: "Biaya dibayar di muka",
  asset_fixed: "Aset tetap",
  liability_payable: "Utang usaha",
  liability_credit_card: "Kartu kredit",
  liability_current: "Liabilitas jangka pendek",
  liability_non_current: "Liabilitas jangka panjang",
  equity: "Ekuitas",
  equity_unaffected: "Laba tahun berjalan",
  income: "Pendapatan",
  income_other: "Pendapatan lain",
  expense: "Beban",
  expense_depreciation: "Beban penyusutan",
  expense_direct_cost: "Harga pokok",
  off_balance: "Di luar neraca",
};
/** Kelompok laba rugi: pendapatan positif, beban negatif (nilai = kredit − debit). */
const plGroup = (type: string) =>
  type.startsWith("income") ? "Pendapatan" : type.startsWith("expense") ? "Beban" : "Neraca";

function journalItems(): Dataset {
  const CC = schema.costCenters;
  const PFC = schema.profitCenters;
  return {
    key: "journal_items",
    label: "Item jurnal (buku besar)",
    description:
      "Baris jurnal terposting per akun: debit, kredit, saldo, nilai laba rugi, cost/profit center, cabang.",
    app: "accounting",
    read: "accounting.read",
    admin: "accounting.manage",
    filters: DATE_FILTERS,
    columns: () => [
      col("date", "Tanggal", "Jurnal"),
      col("month", "Bulan", "Jurnal"),
      col("move", "Nomor entri", "Jurnal"),
      col("accountCode", "Kode akun", "Akun"),
      col("account", "Akun", "Akun"),
      col("accountType", "Jenis akun", "Akun"),
      col("plGroup", "Kelompok laba rugi", "Akun"),
      col("partner", "Partner", "Jurnal"),
      col("label", "Keterangan", "Jurnal"),
      col("costCenter", "Cost center", "Dimensi"),
      col("profitCenter", "Profit center", "Dimensi"),
      col("branch", "Cabang", "Dimensi"),
      col("debit", "Debit", "Nilai", true),
      col("credit", "Kredit", "Nilai", true),
      col("balance", "Saldo (debit − kredit)", "Nilai", true),
      col("plAmount", "Nilai laba rugi (kredit − debit)", "Nilai", true),
    ],
    async rows(tx, ctx, q) {
      const rows = await tx
        .select({
          moveId: M.id,
          accountId: A.id,
          date: M.date,
          move: M.name,
          code: A.code,
          account: A.name,
          type: A.accountType,
          partner: P.name,
          label: ML.name,
          cc: CC.name,
          pc: PFC.name,
          branch: schema.branches.name,
          debit: ML.debit,
          credit: ML.credit,
        })
        .from(ML)
        .innerJoin(M, eq(M.id, ML.moveId))
        .innerJoin(A, eq(A.id, ML.accountId))
        .leftJoin(P, eq(P.id, ML.partnerId))
        .leftJoin(CC, eq(CC.id, ML.costCenterId))
        .leftJoin(PFC, eq(PFC.id, ML.profitCenterId))
        .leftJoin(schema.branches, eq(schema.branches.id, ML.branchId))
        .where(and(eq(M.companyId, ctx.companyId), eq(M.state, "posted"), range(M.date, q)))
        .orderBy(asc(M.date), asc(A.code));
      return rows.map((r) => {
        const debit = n(r.debit) ?? 0;
        const credit = n(r.credit) ?? 0;
        const group = plGroup(r.type);
        return {
          ...ref("account_move", r.moveId),
          _accountId: r.accountId,
          date: r.date,
          month: month(r.date),
          move: r.move ?? "",
          accountCode: r.code,
          account: r.account,
          accountType: ACCOUNT_TYPE[r.type] ?? r.type,
          plGroup: group,
          partner: r.partner ?? "",
          label: r.label ?? "",
          costCenter: r.cc ?? "",
          profitCenter: r.pc ?? "",
          branch: r.branch ?? "",
          debit,
          credit,
          balance: Math.round((debit - credit) * 100) / 100,
          plAmount: group === "Neraca" ? 0 : Math.round((credit - debit) * 100) / 100,
        };
      });
    },
  };
}

const PO = schema.purchaseOrders;
const POL = schema.purchaseOrderLines;

function purchaseOrders(): Dataset {
  return {
    key: "purchase_orders",
    label: "Pesanan pembelian",
    description: "RFQ & pesanan pembelian: pemasok, status, nilai, tanggal rencana.",
    app: "purchase",
    read: "purchase.read",
    admin: "purchase.manage",
    filters: DATE_FILTERS,
    async columns(tx, ctx) {
      return [
        col("name", "Nomor", "Pesanan"),
        col("dateOrder", "Tanggal", "Pesanan"),
        col("month", "Bulan", "Pesanan"),
        col("datePlanned", "Tanggal rencana terima", "Pesanan"),
        col("partner", "Pemasok", "Pesanan"),
        col("buyer", "Pembeli", "Pesanan"),
        col("state", "Status", "Pesanan"),
        col("receivedDate", "Tanggal diterima lengkap", "Penerimaan"),
        col("receivedOnTime", "Diterima tepat waktu", "Penerimaan"),
        col("amountUntaxed", "Total sebelum pajak", "Nilai", true),
        col("amountTotal", "Total", "Nilai", true),
        col("currency", "Mata uang", "Nilai"),
        ...(await customColumns(tx, "purchase_order", ctx)),
      ];
    },
    async rows(tx, ctx, q) {
      const custom = await customValues(tx, "purchase_order", ctx);
      // Penerimaan: lengkap bila semua penerimaan (bukan retur) selesai; tanggalnya = penerimaan terakhir.
      const SP = schema.stockPickings;
      const receipts = tx
        .select({
          po: SP.purchaseOrderId,
          open: sql<number>`count(*) filter (where ${SP.state} not in ('done', 'cancel'))`.as("open"),
          done: sql<number>`count(*) filter (where ${SP.state} = 'done')`.as("done"),
          last: sql<string | null>`max(${SP.dateDone})::date::text`.as("last"),
        })
        .from(SP)
        .where(
          and(eq(SP.companyId, ctx.companyId), eq(SP.pickingType, "incoming"), sql`${SP.returnOfId} is null`),
        )
        .groupBy(SP.purchaseOrderId)
        .as("receipts");
      const rows = await tx
        .select({
          o: PO,
          partner: P.name,
          user: U.name,
          open: receipts.open,
          done: receipts.done,
          last: receipts.last,
        })
        .from(PO)
        .innerJoin(P, eq(P.id, PO.partnerId))
        .leftJoin(U, eq(U.id, PO.userId))
        .leftJoin(receipts, eq(receipts.po, PO.id))
        .where(and(eq(PO.companyId, ctx.companyId), range(PO.dateOrder, q)))
        .orderBy(asc(PO.dateOrder));
      return rows.map(({ o, partner, user, open, done, last }) => {
        const complete = o.state === "purchase" && Number(done ?? 0) > 0 && Number(open ?? 0) === 0 && !!last;
        const planned = o.datePlanned ? day(o.datePlanned) : "";
        return {
          ...ref("purchase_order", o.id),
          _partnerId: o.partnerId,
          _userId: o.userId ?? "",
          name: o.name,
          dateOrder: o.dateOrder,
          month: month(o.dateOrder),
          datePlanned: o.datePlanned ?? "",
          partner,
          buyer: user ?? "",
          state: PO_STATE[o.state] ?? o.state,
          receivedDate: complete ? last! : "",
          receivedOnTime: complete && planned ? (last! <= planned ? "Ya" : "Tidak") : "",
          amountUntaxed: n(o.amountUntaxed),
          amountTotal: n(o.amountTotal),
          currency: o.currencyCode,
          ...custom(o.custom),
        };
      });
    },
  };
}

function purchaseLines(): Dataset {
  return {
    key: "purchase_lines",
    label: "Baris pembelian (produk)",
    description: "Baris pesanan pembelian terkonfirmasi: produk, pemasok, kuantitas, nilai.",
    app: "purchase",
    read: "purchase.read",
    admin: "purchase.manage",
    filters: DATE_FILTERS,
    columns: () => [
      col("order", "Nomor pesanan", "Pesanan"),
      col("dateOrder", "Tanggal", "Pesanan"),
      col("month", "Bulan", "Pesanan"),
      col("partner", "Pemasok", "Pesanan"),
      col("sku", "SKU", "Produk"),
      col("product", "Produk", "Produk"),
      col("category", "Kategori", "Produk"),
      col("quantity", "Kuantitas", "Nilai", true),
      col("priceUnit", "Harga satuan", "Nilai", true),
      col("subtotal", "Subtotal", "Nilai", true),
    ],
    async rows(tx, ctx, q) {
      const rows = await tx
        .select({
          orderId: PO.id,
          partnerId: PO.partnerId,
          productId: POL.productId,
          order: PO.name,
          dateOrder: PO.dateOrder,
          partner: P.name,
          sku: PR.sku,
          product: PR.name,
          category: PC.name,
          name: POL.name,
          quantity: POL.quantity,
          priceUnit: POL.priceUnit,
          subtotal: POL.priceSubtotal,
        })
        .from(POL)
        .innerJoin(PO, eq(PO.id, POL.orderId))
        .innerJoin(P, eq(P.id, PO.partnerId))
        .leftJoin(PR, eq(PR.id, POL.productId))
        .leftJoin(PC, eq(PC.id, PR.categoryId))
        .where(and(eq(PO.companyId, ctx.companyId), eq(PO.state, "purchase"), range(PO.dateOrder, q)))
        .orderBy(asc(PO.dateOrder));
      return rows.map((r) => ({
        ...ref("purchase_order", r.orderId),
        _partnerId: r.partnerId,
        _productId: r.productId ?? "",
        order: r.order,
        dateOrder: r.dateOrder,
        month: month(r.dateOrder),
        partner: r.partner,
        sku: r.sku ?? "",
        product: r.product ?? r.name,
        category: r.category ?? "",
        quantity: n(r.quantity),
        priceUnit: n(r.priceUnit),
        subtotal: n(r.subtotal),
      }));
    },
  };
}

function stockQuants(): Dataset {
  const Q = schema.stockQuants;
  const L = schema.stockLocations;
  const W = schema.warehouses;
  return {
    key: "stock_quants",
    label: "Stok per lokasi",
    description:
      "Stok tersedia per produk & lokasi internal: kuantitas, nilai (biaya rata-rata lapisan), minimum.",
    app: "inventory",
    read: "inventory.read",
    admin: "inventory.manage",
    columns: () => [
      col("sku", "SKU", "Produk"),
      col("product", "Produk", "Produk"),
      col("category", "Kategori", "Produk"),
      col("warehouse", "Gudang", "Lokasi"),
      col("location", "Lokasi", "Lokasi"),
      col("quantity", "Kuantitas", "Nilai", true),
      col("unitCost", "Biaya satuan", "Nilai", true),
      col("value", "Nilai stok", "Nilai", true),
      col("minQty", "Minimum (aturan reorder)", "Reorder", true),
      col("belowMin", "Di bawah minimum", "Reorder"),
    ],
    async rows(tx, ctx) {
      const rows = await tx
        .select({
          productId: Q.productId,
          sku: PR.sku,
          product: PR.name,
          cost: PR.cost,
          category: PC.name,
          warehouseId: L.warehouseId,
          warehouse: W.name,
          location: L.completeName,
          quantity: sql<string>`sum(${Q.quantity})`,
        })
        .from(Q)
        .innerJoin(L, eq(L.id, Q.locationId))
        .innerJoin(PR, eq(PR.id, Q.productId))
        .leftJoin(PC, eq(PC.id, PR.categoryId))
        .leftJoin(W, eq(W.id, L.warehouseId))
        .where(and(eq(Q.companyId, ctx.companyId), eq(L.usage, "internal")))
        .groupBy(Q.productId, PR.sku, PR.name, PR.cost, PC.name, L.warehouseId, W.name, L.completeName)
        .orderBy(asc(PR.sku));
      const V = schema.stockValuationLayers;
      const layers = await tx
        .select({
          productId: V.productId,
          qty: sql<string>`sum(${V.remainingQty})`,
          value: sql<string>`sum(${V.remainingValue})`,
        })
        .from(V)
        .where(eq(V.companyId, ctx.companyId))
        .groupBy(V.productId);
      const unit = new Map(
        layers.map((l) => [l.productId, Number(l.qty) ? Number(l.value) / Number(l.qty) : null]),
      );
      const R = schema.stockReorderRules;
      const rules = await tx
        .select({ productId: R.productId, warehouseId: R.warehouseId, minQty: R.minQty })
        .from(R)
        .where(and(eq(R.companyId, ctx.companyId), eq(R.active, true)));
      const min = new Map(rules.map((r) => [`${r.productId}:${r.warehouseId}`, Number(r.minQty)]));
      // Total per produk × gudang untuk pembanding minimum.
      const perWh = new Map<string, number>();
      for (const r of rows) {
        const k = `${r.productId}:${r.warehouseId}`;
        perWh.set(k, (perWh.get(k) ?? 0) + Number(r.quantity));
      }
      return rows.map((r) => {
        const qty = Number(r.quantity);
        const cost = unit.get(r.productId) ?? Number(r.cost ?? 0);
        const m = min.get(`${r.productId}:${r.warehouseId}`);
        return {
          ...ref("product", r.productId),
          _productId: r.productId,
          sku: r.sku ?? "",
          product: r.product,
          category: r.category ?? "",
          warehouse: r.warehouse ?? "",
          location: r.location,
          quantity: qty,
          unitCost: Math.round(cost * 100) / 100,
          value: Math.round(qty * cost * 100) / 100,
          minQty: m ?? null,
          belowMin:
            m !== undefined && (perWh.get(`${r.productId}:${r.warehouseId}`) ?? 0) < m ? "Ya" : "Tidak",
        };
      });
    },
  };
}

function stockMoves(): Dataset {
  const SM = schema.stockMoves;
  const SP = schema.stockPickings;
  const src = aliasedTable(schema.stockLocations, "src");
  const dst = aliasedTable(schema.stockLocations, "dst");
  return {
    key: "stock_moves",
    label: "Pergerakan stok",
    description:
      "Pergerakan stok selesai: masuk, keluar, internal, penyesuaian, produksi — kuantitas & nilai.",
    app: "inventory",
    read: "inventory.read",
    admin: "inventory.manage",
    filters: DATE_FILTERS,
    columns: () => [
      col("date", "Tanggal", "Pergerakan"),
      col("month", "Bulan", "Pergerakan"),
      col("reference", "Referensi", "Pergerakan"),
      col("kind", "Jenis", "Pergerakan"),
      col("sku", "SKU", "Produk"),
      col("product", "Produk", "Produk"),
      col("category", "Kategori", "Produk"),
      col("from", "Dari", "Lokasi"),
      col("to", "Ke", "Lokasi"),
      col("quantity", "Kuantitas", "Nilai", true),
      col("value", "Nilai", "Nilai", true),
    ],
    async rows(tx, ctx, q) {
      const rows = await tx
        .select({
          date: SM.date,
          reference: SM.reference,
          pickingId: SM.pickingId,
          productId: SM.productId,
          pickingType: SP.pickingType,
          isInventory: SM.isInventory,
          production: SM.productionOrderId,
          sku: PR.sku,
          product: PR.name,
          category: PC.name,
          from: src.completeName,
          fromUsage: src.usage,
          to: dst.completeName,
          toUsage: dst.usage,
          qty: SM.quantityDone,
          value: SM.value,
        })
        .from(SM)
        .innerJoin(PR, eq(PR.id, SM.productId))
        .leftJoin(PC, eq(PC.id, PR.categoryId))
        .leftJoin(SP, eq(SP.id, SM.pickingId))
        .innerJoin(src, eq(src.id, SM.locationId))
        .innerJoin(dst, eq(dst.id, SM.locationDestId))
        .where(and(eq(SM.companyId, ctx.companyId), eq(SM.state, "done"), rangeTs(SM.date, q)))
        .orderBy(asc(SM.date));
      const KIND: Record<string, string> = {
        incoming: "Penerimaan",
        outgoing: "Pengiriman",
        internal: "Transfer internal",
        dropship: "Dropship",
      };
      return rows.map((r) => ({
        ...(r.pickingId
          ? ref("stock_picking", r.pickingId)
          : r.production
            ? ref("production_order", r.production)
            : {}),
        _productId: r.productId,
        date: day(r.date),
        month: month(r.date),
        reference: r.reference ?? "",
        kind: r.production
          ? "Produksi"
          : r.isInventory
            ? "Penyesuaian"
            : r.pickingType
              ? (KIND[r.pickingType] ?? r.pickingType)
              : r.toUsage === "internal"
                ? "Masuk"
                : "Keluar",
        sku: r.sku ?? "",
        product: r.product,
        category: r.category ?? "",
        from: r.from,
        to: r.to,
        quantity: n(r.qty),
        value: n(r.value),
      }));
    },
  };
}

function productionOrders(): Dataset {
  const MO = schema.productionOrders;
  return {
    key: "production_orders",
    label: "Order produksi",
    description: "Order produksi: produk, kuantitas, status, biaya bahan & konversi, biaya per unit.",
    app: "mrp",
    read: "mrp.read",
    admin: "mrp.manage",
    filters: DATE_FILTERS,
    async columns(tx, ctx) {
      return [
        col("name", "Nomor", "Order"),
        col("datePlanned", "Tanggal rencana", "Order"),
        col("month", "Bulan", "Order"),
        col("dateDone", "Tanggal selesai", "Order"),
        col("onTime", "Selesai tepat waktu", "Order"),
        col("sku", "SKU", "Produk"),
        col("product", "Produk", "Produk"),
        col("state", "Status", "Order"),
        col("quantity", "Kuantitas rencana", "Nilai", true),
        col("qtyProduced", "Kuantitas hasil", "Nilai", true),
        col("materialCost", "Biaya bahan", "Biaya", true),
        col("conversionCost", "Biaya konversi", "Biaya", true),
        col("totalCost", "Total biaya", "Biaya", true),
        col("unitCost", "Biaya per unit", "Biaya", true),
        ...(await customColumns(tx, "production_order", ctx)),
      ];
    },
    async rows(tx, ctx, q) {
      const custom = await customValues(tx, "production_order", ctx);
      const rows = await tx
        .select({ o: MO, sku: PR.sku, product: PR.name })
        .from(MO)
        .innerJoin(PR, eq(PR.id, MO.productId))
        .where(and(eq(MO.companyId, ctx.companyId), range(MO.datePlanned, q)))
        .orderBy(asc(MO.datePlanned));
      return rows.map(({ o, sku, product }) => ({
        ...ref("production_order", o.id),
        _productId: o.productId,
        _userId: o.createdBy ?? "",
        name: o.name,
        datePlanned: o.datePlanned,
        month: month(o.datePlanned),
        dateDone: day(o.dateDone),
        onTime:
          o.state === "done" && o.dateDone ? (day(o.dateDone) <= day(o.datePlanned) ? "Ya" : "Tidak") : "",
        sku: sku ?? "",
        product,
        state: MO_STATE[o.state] ?? o.state,
        quantity: n(o.quantity),
        qtyProduced: n(o.qtyProduced),
        materialCost: n(o.materialCost),
        conversionCost: n(o.conversionCost),
        totalCost: (n(o.materialCost) ?? 0) + (n(o.conversionCost) ?? 0),
        unitCost: n(o.unitCost),
        ...custom(o.custom),
      }));
    },
  };
}

function payslipHistory(): Dataset {
  const S = schema.payslips;
  const RUN = schema.payrollRuns;
  const E = schema.employees;
  return {
    key: "payslips_history",
    label: "Riwayat biaya gaji",
    description:
      "Slip gaji terposting semua periode: bruto, neto, BPJS, biaya perusahaan per karyawan & departemen.",
    app: "payroll",
    read: "payroll.read",
    admin: "payroll.manage",
    filters: DATE_FILTERS,
    columns: () => [
      col("period", "Periode", "Payroll"),
      col("month", "Bulan", "Payroll"),
      col("run", "Payroll", "Payroll"),
      col("runKind", "Jenis payroll", "Payroll"),
      col("employeeNumber", "No. karyawan", "Karyawan"),
      col("employee", "Nama", "Karyawan"),
      col("department", "Departemen", "Karyawan"),
      col("gross", "Penghasilan bruto", "Nilai", true),
      col("employeeBpjs", "BPJS karyawan", "Nilai", true),
      col("employerBpjs", "BPJS perusahaan", "Nilai", true),
      col("net", "Gaji bersih", "Nilai", true),
      col("employerCost", "Biaya perusahaan (bruto + BPJS)", "Nilai", true),
    ],
    async rows(tx, ctx, q) {
      const rows = await tx
        .select({
          id: S.id,
          kind: RUN.kind,
          departmentId: E.departmentId,
          branch: schema.branches.name,
          period: RUN.periodStart,
          run: RUN.name,
          number: E.employeeNumber,
          employee: E.name,
          department: schema.departments.name,
          gross: S.gross,
          employeeBpjs: S.employeeBpjs,
          employerBpjs: S.employerBpjs,
          net: S.net,
        })
        .from(S)
        .innerJoin(RUN, eq(RUN.id, S.runId))
        .innerJoin(E, eq(E.id, S.employeeId))
        .leftJoin(schema.departments, eq(schema.departments.id, E.departmentId))
        .leftJoin(schema.branches, eq(schema.branches.id, S.branchId))
        .where(
          and(
            eq(S.companyId, ctx.companyId),
            inArray(RUN.state, ["done", "paid"]),
            // Bawaan tanpa payroll koreksi; `includeCorrections=1` (drilldown laporan biaya tenaga kerja) ikut.
            q.includeCorrections === "1" ? undefined : ne(RUN.kind, "correction"),
            range(RUN.periodStart, q),
          ),
        )
        .orderBy(asc(RUN.periodStart), asc(E.name));
      return rows.map((r) => {
        const gross = n(r.gross) ?? 0;
        const employer = n(r.employerBpjs) ?? 0;
        return {
          ...ref("payslip", r.id),
          _departmentId: r.departmentId ?? "",
          _branch: r.branch ?? "",
          period: r.period,
          month: month(r.period),
          run: r.run,
          runKind: r.kind === "correction" ? "Koreksi" : "Reguler",
          employeeNumber: r.number,
          employee: r.employee,
          department: r.department ?? "",
          gross,
          employeeBpjs: n(r.employeeBpjs),
          employerBpjs: employer,
          net: n(r.net),
          employerCost: Math.round((gross + employer) * 100) / 100,
        };
      });
    },
  };
}

/** Dataset laporan bisnis (hanya baca) — dipakai pembuat laporan & dashboard, bukan impor/ekspor SDM. */
function qualityChecks(): Dataset {
  const QC = schema.qualityChecks;
  return {
    key: "quality_checks",
    label: "Pemeriksaan mutu",
    description: "Pemeriksaan mutu: produk, pemasok, pemicu, status, kuantitas.",
    app: "quality",
    read: "quality.read",
    admin: "quality.manage",
    filters: DATE_FILTERS,
    columns: () => [
      col("name", "Nomor", "Pemeriksaan"),
      col("date", "Tanggal", "Pemeriksaan"),
      col("month", "Bulan", "Pemeriksaan"),
      col("trigger", "Pemicu", "Pemeriksaan"),
      col("state", "Status", "Pemeriksaan"),
      col("product", "Produk", "Produk"),
      col("partner", "Pemasok/pelanggan", "Pemeriksaan"),
      col("quantity", "Kuantitas", "Nilai", true),
    ],
    async rows(tx, ctx, q) {
      const rows = await tx
        .select({ c: QC, product: PR.name, partner: P.name })
        .from(QC)
        .innerJoin(PR, eq(PR.id, QC.productId))
        .leftJoin(P, eq(P.id, QC.partnerId))
        .where(and(eq(QC.companyId, ctx.companyId), rangeTs(QC.createdAt, q)))
        .orderBy(asc(QC.createdAt));
      return rows.map(({ c, product, partner }) => ({
        ...ref("quality_check", c.id),
        _productId: c.productId,
        _partnerId: c.partnerId ?? "",
        _state: c.state,
        name: c.name,
        date: day(c.createdAt),
        month: month(c.createdAt),
        trigger: QUALITY_TRIGGER_LABEL[c.trigger]?.[0] ?? c.trigger,
        state: CHECK_STATE_LABEL[c.state]?.[0] ?? c.state,
        product,
        partner: partner ?? "",
        quantity: n(c.quantity),
      }));
    },
  };
}

function maintenanceRequests(): Dataset {
  const RQ = schema.maintenanceRequests;
  const EQ = schema.equipment;
  return {
    key: "maintenance_requests",
    label: "Permintaan perawatan",
    description:
      "Permintaan perawatan (korektif & preventif) per peralatan: tanggal kerusakan/jadwal/selesai, downtime, biaya.",
    app: "maintenance",
    read: "maintenance.read",
    admin: "maintenance.manage",
    columns: () => [
      col("name", "Nomor", "Permintaan"),
      col("title", "Judul", "Permintaan"),
      col("equipment", "Peralatan", "Permintaan"),
      col("kind", "Jenis", "Permintaan"),
      col("state", "Status", "Permintaan"),
      col("breakdown", "Tanggal kerusakan", "Tanggal"),
      col("scheduled", "Tanggal terjadwal", "Tanggal"),
      col("finished", "Tanggal selesai", "Tanggal"),
      col("downtimeHours", "Downtime (jam)", "Nilai", true),
      col("partsCost", "Biaya suku cadang", "Nilai", true),
      col("vendorCost", "Biaya vendor", "Nilai", true),
      col("laborCost", "Biaya tenaga kerja", "Nilai", true),
      col("totalCost", "Total biaya", "Nilai", true),
    ],
    async rows(tx, ctx) {
      const rows = await tx
        .select({ r: RQ, code: EQ.code, equipment: EQ.name })
        .from(RQ)
        .innerJoin(EQ, eq(EQ.id, RQ.equipmentId))
        .where(and(eq(RQ.companyId, ctx.companyId), ne(RQ.state, "cancelled")))
        .orderBy(asc(RQ.createdAt));
      return rows.map(({ r, code, equipment }) => {
        const parts = n(r.partsCost) ?? 0;
        const vendor = n(r.vendorCost) ?? 0;
        const labor = n(r.laborCost) ?? 0;
        return {
          ...ref("maintenance_request", r.id),
          _equipmentId: r.equipmentId,
          _userId: r.technicianUserId ?? "",
          _kind: r.kind,
          _done: r.state === "done" ? "1" : "",
          name: r.name,
          title: r.title,
          equipment: `${code} ${equipment}`,
          kind: r.kind === "preventive" ? "Preventif" : "Korektif",
          state: REQUEST_STATE_LABEL[r.state]?.[0] ?? r.state,
          breakdown: day(r.breakdownAt),
          scheduled: r.scheduledDate ?? "",
          finished: day(r.finishedAt),
          downtimeHours: n(r.downtimeHours),
          partsCost: parts,
          vendorCost: vendor,
          laborCost: labor,
          totalCost: Math.round((parts + vendor + labor) * 100) / 100,
        };
      });
    },
  };
}

function fleetCosts(): Dataset {
  return {
    key: "fleet_costs",
    label: "Biaya armada",
    description: "Biaya kendaraan per kejadian: kontrak (awal & berkala) dan servis.",
    app: "fleet",
    read: "fleet.read",
    admin: "fleet.manage",
    filters: DATE_FILTERS,
    columns: () => [
      col("date", "Tanggal", "Biaya"),
      col("month", "Bulan", "Biaya"),
      col("vehicle", "Kendaraan", "Biaya"),
      col("category", "Kategori", "Biaya"),
      col("source", "Sumber", "Biaya"),
      col("amount", "Jumlah", "Nilai", true),
    ],
    async rows(tx, ctx, q) {
      const today = businessToday();
      const from = q.from && ISO.test(q.from) ? q.from : `${today.slice(0, 4)}-01-01`;
      const to = q.to && ISO.test(q.to) ? q.to : today;
      const rows = await fleetCostRows(tx, ctx.companyId, from, to);
      rows.sort((a, b) => a.date.localeCompare(b.date));
      return rows.map((r) => ({
        ...ref(r.refModel, r.refId),
        _vehicleId: r.vehicleId,
        _category: r.category,
        date: r.date,
        month: month(r.date),
        vehicle: r.vehicle,
        category: r.category,
        source: r.source === "contract" ? "Kontrak" : "Servis",
        amount: r.amount,
      }));
    },
  };
}

const CASH_SQL = sql.raw(
  `coalesce(a.cash_flow_category, case when a.account_type = 'asset_cash' then 'cash' else '' end) = 'cash'`,
);

/** Arus kas metode langsung: baris lawan kas pada jurnal yang menyentuh kas/bank (positif = kas masuk). */
function cashFlows(): Dataset {
  return {
    key: "cash_flows",
    label: "Arus kas",
    description:
      "Kas masuk & keluar per kategori (pelanggan, pemasok, gaji, pajak, aset, pendanaan) dari jurnal kas/bank.",
    app: "accounting",
    read: "accounting.read",
    admin: "accounting.manage",
    filters: DATE_FILTERS,
    columns: () => [
      col("date", "Tanggal", "Arus kas"),
      col("month", "Bulan", "Arus kas"),
      col("move", "Jurnal", "Arus kas"),
      col("journal", "Buku jurnal", "Arus kas"),
      col("direction", "Arah", "Arus kas"),
      col("category", "Kategori", "Arus kas"),
      col("account", "Akun lawan", "Arus kas"),
      col("partner", "Partner", "Arus kas"),
      col("amount", "Arus kas bersih", "Nilai", true),
      col("inflow", "Kas masuk", "Nilai", true),
      col("outflow", "Kas keluar", "Nilai", true),
    ],
    async rows(tx, ctx, q) {
      const from = q.from && ISO.test(q.from) ? q.from : "0001-01-01";
      const to = q.to && ISO.test(q.to) ? q.to : "9999-12-31";
      const rows = await tx.execute<{
        move_id: string;
        move: string | null;
        journal: string | null;
        date: string;
        account_type: string;
        account: string;
        partner: string | null;
        amount: string;
      }>(sql`
        with cm as (
          select distinct l.move_id from account_move_lines l
          join account_moves m on m.id = l.move_id join accounts a on a.id = l.account_id
          where m.company_id = ${ctx.companyId} and m.state = 'posted' and m.date between ${from} and ${to}
            and ${CASH_SQL}
        )
        select m.id as move_id, m.name as move, j.name as journal, m.date::text as date, a.account_type,
          a.code || ' ' || a.name as account, p.name as partner, sum(-l.balance) as amount
        from account_move_lines l join account_moves m on m.id = l.move_id join accounts a on a.id = l.account_id
        left join journals j on j.id = m.journal_id left join partners p on p.id = l.partner_id
        where l.move_id in (select move_id from cm) and not (${CASH_SQL})
        group by m.id, m.name, j.name, m.date, a.account_type, a.code, a.name, p.name
        order by m.date`);
      return [...rows].flatMap((r) => {
        const amount = n(r.amount) ?? 0;
        const cat = cashCategory(r.account_type, r.account, amount);
        if (!cat || !amount) return [];
        return [
          {
            ...ref("account_move", r.move_id),
            date: r.date,
            month: month(r.date),
            move: r.move ?? "",
            journal: r.journal ?? "",
            direction: amount > 0 ? "Masuk" : "Keluar",
            category: CASH_CATEGORIES[cat].label[0],
            account: r.account,
            partner: r.partner ?? "",
            amount,
            inflow: amount > 0 ? amount : 0,
            outflow: amount < 0 ? -amount : 0,
          },
        ];
      });
    },
  };
}

/** Pengiriman & penerimaan selesai: tepat waktu, tepat jumlah (OTIF), keterlambatan. */
function deliveries(): Dataset {
  return {
    key: "deliveries",
    label: "Pengiriman & penerimaan",
    description:
      "Pengiriman ke pelanggan & penerimaan dari pemasok yang selesai: jadwal vs realisasi, tepat waktu, tepat jumlah.",
    app: "inventory",
    read: "inventory.read",
    admin: "inventory.manage",
    filters: DATE_FILTERS,
    columns: () => [
      col("name", "Nomor", "Dokumen"),
      col("kind", "Jenis", "Dokumen"),
      col("partner", "Partner", "Dokumen"),
      col("scheduled", "Jadwal", "Waktu"),
      col("done", "Selesai", "Waktu"),
      col("month", "Bulan selesai", "Waktu"),
      col("daysLate", "Hari terlambat", "Waktu", true),
      col("onTime", "Tepat waktu", "Kinerja"),
      col("inFull", "Tepat jumlah", "Kinerja"),
      col("otif", "OTIF", "Kinerja"),
      col("quantity", "Kuantitas diminta", "Nilai", true),
      col("quantityDone", "Kuantitas terkirim/diterima", "Nilai", true),
    ],
    async rows(tx, ctx, q) {
      const from = q.from && ISO.test(q.from) ? q.from : "0001-01-01";
      const to = q.to && ISO.test(q.to) ? q.to : "9999-12-31";
      const rows = await tx.execute<{
        id: string;
        name: string;
        picking_type: string;
        partner: string | null;
        scheduled: string;
        done: string;
        quantity: string;
        quantity_done: string;
        in_full: boolean | null;
      }>(sql`
        select t.id, t.name, t.picking_type, pa.name as partner, t.scheduled_date::text as scheduled,
          t.date_done::date::text as done, sum(mv.quantity) as quantity, sum(mv.quantity_done) as quantity_done,
          bool_and(mv.quantity_done >= mv.quantity) filter (where mv.state <> 'cancel') as in_full
        from stock_pickings t join stock_moves mv on mv.picking_id = t.id
        left join partners pa on pa.id = t.partner_id
        where t.company_id = ${ctx.companyId} and t.state = 'done' and t.return_of_id is null
          and t.picking_type in ('incoming', 'outgoing') and t.date_done::date between ${from} and ${to}
        group by t.id, pa.name
        order by t.date_done`);
      return [...rows].map((r) => {
        const late = Math.round((Date.parse(r.done) - Date.parse(r.scheduled)) / 864e5);
        const onTime = late <= 0;
        const inFull = r.in_full !== false;
        return {
          ...ref("stock_picking", r.id),
          name: r.name,
          kind: r.picking_type === "outgoing" ? "Pengiriman" : "Penerimaan",
          partner: r.partner ?? "",
          scheduled: r.scheduled,
          done: r.done,
          month: month(r.done),
          daysLate: Math.max(0, late),
          onTime: onTime ? "Ya" : "Tidak",
          inFull: inFull ? "Ya" : "Tidak",
          otif: onTime && inFull ? "Ya" : "Tidak",
          quantity: n(r.quantity),
          quantityDone: n(r.quantity_done),
        };
      });
    },
  };
}

export function businessDatasets(): Dataset[] {
  return [
    saleOrders(),
    saleLines(),
    crmLeads(),
    invoices(),
    journalItems(),
    purchaseOrders(),
    purchaseLines(),
    stockQuants(),
    stockMoves(),
    productionOrders(),
    payslipHistory(),
    qualityChecks(),
    maintenanceRequests(),
    fleetCosts(),
    cashFlows(),
    deliveries(),
  ];
}

export type { Row };
