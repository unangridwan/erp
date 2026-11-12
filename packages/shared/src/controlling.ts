import { Decimal } from "decimal.js";
import { z } from "zod";

/** Kategori cost center untuk pengelompokan laporan & sumber alokasi. */
export const COST_CENTER_CATEGORIES = ["production", "sales", "admin", "service"] as const;
export type CostCenterCategory = (typeof COST_CENTER_CATEGORIES)[number];

export const COST_CENTER_CATEGORY_LABEL: Record<CostCenterCategory, [string, string]> = {
  production: ["Produksi", "Production"],
  sales: ["Penjualan & pemasaran", "Sales & marketing"],
  admin: ["Administrasi & umum", "General & administrative"],
  service: ["Layanan pendukung", "Support service"],
};

/** Jenis akun yang wajib ber-cost center bila pengaturan "cost center wajib" aktif. */
export const COST_CENTER_REQUIRED_TYPES = ["expense", "expense_depreciation"] as const;

const code = z
  .string()
  .trim()
  .min(1, "Kode wajib diisi")
  .max(20)
  .regex(/^[A-Za-z0-9._-]+$/, "Kode hanya huruf, angka, titik, garis bawah, atau strip");
const optionalUuid = z.string().uuid().nullish();

export const profitCenterSchema = z.object({
  code,
  name: z.string().trim().min(1).max(120),
  parentId: optionalUuid,
  managerEmployeeId: optionalUuid,
  description: z.string().trim().max(500).nullish(),
  active: z.boolean().default(true),
});

export const costCenterSchema = profitCenterSchema.extend({
  profitCenterId: optionalUuid,
  category: z.enum(COST_CENTER_CATEGORIES).default("admin"),
});

export const controllingReportQuery = z.object({
  dateFrom: z.string().date(),
  dateTo: z.string().date(),
  branchId: z.string().uuid().optional(),
});

export interface TreeNode {
  id: string;
  parentId: string | null;
  code: string;
}

/** Id node beserta seluruh turunannya. */
export function descendantIds(nodes: TreeNode[], id: string): string[] {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
  }
  const out: string[] = [];
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    stack.push(...(children.get(cur) ?? []));
  }
  return out;
}

/** Apakah menjadikan `parentId` induk dari `id` membentuk siklus. */
export function wouldCycle(nodes: TreeNode[], id: string, parentId: string | null | undefined): boolean {
  if (!parentId) return false;
  if (parentId === id) return true;
  return descendantIds(nodes, id).includes(parentId);
}

export type Amounts = Record<string, string>;

export interface TreeRow<N extends TreeNode> {
  node: N;
  depth: number;
  /** Nilai milik node sendiri. */
  own: Amounts;
  /** Nilai node + seluruh turunan. */
  total: Amounts;
  hasChildren: boolean;
}

/**
 * Susun pohon berurutan (induk lalu anak, urut kode) dengan nilai sendiri dan total turunan.
 * Node yatim (induknya tidak ada di daftar) diperlakukan sebagai akar.
 */
export function rollupTree<N extends TreeNode>(
  nodes: N[],
  own: Map<string, Amounts>,
  keys: string[],
): TreeRow<N>[] {
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string | null, N[]>();
  for (const n of nodes) {
    const parent = n.parentId && ids.has(n.parentId) ? n.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), n]);
  }
  for (const list of children.values())
    list.sort((a, b) => a.code.localeCompare(b.code, "id", { numeric: true }));
  const zero = () => Object.fromEntries(keys.map((k) => [k, new Decimal(0)])) as Record<string, Decimal>;
  const out: TreeRow<N>[] = [];
  const visit = (node: N, depth: number, path: Set<string>): Record<string, Decimal> => {
    const mine = own.get(node.id) ?? {};
    const total = zero();
    for (const k of keys) total[k] = total[k]!.plus(mine[k] ?? 0);
    const index = out.length;
    out.push({ node, depth, own: {}, total: {}, hasChildren: false });
    const kids = path.has(node.id) ? [] : (children.get(node.id) ?? []);
    for (const child of kids) {
      const sub = visit(child, depth + 1, new Set([...path, node.id]));
      for (const k of keys) total[k] = total[k]!.plus(sub[k]!);
    }
    out[index] = {
      node,
      depth,
      own: Object.fromEntries(keys.map((k) => [k, new Decimal(mine[k] ?? 0).toFixed(2)])),
      total: Object.fromEntries(keys.map((k) => [k, total[k]!.toFixed(2)])),
      hasChildren: kids.length > 0,
    };
    return total;
  };
  for (const root of children.get(null) ?? []) visit(root, 0, new Set());
  return out;
}

/** Saldo per jenis akun (debit − kredit) → laba rugi ringkas satu profit center. */
export function profitCenterStatement(byType: Record<string, Decimal.Value>) {
  const bal = (t: string) => new Decimal(byType[t] ?? 0);
  // Pendapatan bersaldo kredit (negatif) → dibalik agar positif.
  const revenue = bal("income").negated();
  const otherIncome = bal("income_other").negated();
  const cogs = bal("expense_direct_cost");
  const opex = bal("expense").plus(bal("expense_depreciation"));
  const otherExpense = bal("expense_other");
  const grossProfit = revenue.minus(cogs);
  const operatingProfit = grossProfit.minus(opex);
  const netProfit = operatingProfit.plus(otherIncome).minus(otherExpense);
  const margin = revenue.isZero() ? null : netProfit.div(revenue).times(100).toDecimalPlaces(1).toNumber();
  return {
    revenue: revenue.toFixed(2),
    cogs: cogs.toFixed(2),
    grossProfit: grossProfit.toFixed(2),
    opex: opex.toFixed(2),
    operatingProfit: operatingProfit.toFixed(2),
    otherIncome: otherIncome.toFixed(2),
    otherExpense: otherExpense.toFixed(2),
    netProfit: netProfit.toFixed(2),
    margin,
  };
}

export const PROFIT_CENTER_KEYS = [
  "revenue",
  "cogs",
  "grossProfit",
  "opex",
  "operatingProfit",
  "otherIncome",
  "otherExpense",
  "netProfit",
] as const;

/** Selisih realisasi terhadap anggaran: nilai & persen (null bila anggaran nol). */
export function budgetVariance(actual: Decimal.Value, budget: Decimal.Value) {
  const a = new Decimal(actual);
  const b = new Decimal(budget);
  const variance = a.minus(b);
  return {
    variance: variance.toFixed(2),
    percent: b.isZero() ? null : a.div(b).times(100).toDecimalPlaces(1).toNumber(),
  };
}
