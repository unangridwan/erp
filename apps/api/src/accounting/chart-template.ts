import { eq, schema, type Db } from "@erp/db";

type AccountType = (typeof schema.ACCOUNT_TYPES)[number];

/**
 * Bagan akun standar untuk perusahaan dagang/jasa di Indonesia (mengacu pola SAK EP/EMKM).
 * Kunci (`key`) dipakai untuk menghubungkan akun dengan jurnal, pajak, dan pengaturan bawaan.
 */
const ACCOUNTS: {
  key?: string;
  code: string;
  name: string;
  type: AccountType;
  reconcile?: boolean;
  branchClearing?: boolean;
}[] = [
  { key: "cash", code: "1-1100", name: "Kas", type: "asset_cash" },
  { key: "bank", code: "1-1200", name: "Bank", type: "asset_cash" },
  { key: "receivable", code: "1-1300", name: "Piutang Usaha", type: "asset_receivable", reconcile: true },
  {
    key: "icReceivable",
    code: "1-1310",
    name: "Piutang Antar Perusahaan",
    type: "asset_receivable",
    reconcile: true,
  },
  { key: "stock", code: "1-1400", name: "Persediaan Barang Dagang", type: "asset_current" },
  { key: "vatIn", code: "1-1500", name: "PPN Masukan", type: "asset_current" },
  { key: "pph23Prepaid", code: "1-1510", name: "PPh 23 Dibayar Dimuka", type: "asset_current" },
  { code: "1-1600", name: "Uang Muka Pembelian", type: "asset_current" },
  { code: "1-1700", name: "Biaya Dibayar Dimuka", type: "asset_current" },
  { code: "1-1800", name: "Piutang Karyawan", type: "asset_current" },
  {
    code: "1-1900",
    name: "Rekening Antar Kantor (RK Pusat–Cabang)",
    type: "asset_current",
    branchClearing: true,
  },
  { code: "1-2100", name: "Peralatan Kantor", type: "asset_fixed" },
  { code: "1-2190", name: "Akumulasi Penyusutan Peralatan Kantor", type: "asset_fixed" },
  { code: "1-2200", name: "Kendaraan", type: "asset_fixed" },
  { code: "1-2290", name: "Akumulasi Penyusutan Kendaraan", type: "asset_fixed" },
  { code: "1-2300", name: "Bangunan", type: "asset_fixed" },
  { code: "1-2390", name: "Akumulasi Penyusutan Bangunan", type: "asset_fixed" },
  { code: "1-3100", name: "Investasi pada Entitas Anak", type: "asset_non_current" },
  { code: "1-3200", name: "Investasi pada Entitas Asosiasi", type: "asset_non_current" },
  { key: "payable", code: "2-1100", name: "Utang Usaha", type: "liability_payable", reconcile: true },
  {
    key: "icPayable",
    code: "2-1110",
    name: "Utang Antar Perusahaan",
    type: "liability_payable",
    reconcile: true,
  },
  { key: "vatOut", code: "2-1200", name: "PPN Keluaran", type: "liability_current" },
  { code: "2-1300", name: "Utang PPh 21", type: "liability_current" },
  { key: "pph23Payable", code: "2-1310", name: "Utang PPh 23", type: "liability_current" },
  { code: "2-1320", name: "Utang PPh 4 Ayat 2", type: "liability_current" },
  { code: "2-1330", name: "Utang PPh 25/29", type: "liability_current" },
  { code: "2-1400", name: "Utang BPJS", type: "liability_current" },
  { code: "2-1500", name: "Utang Gaji", type: "liability_current" },
  { key: "customerDown", code: "2-1600", name: "Uang Muka Pelanggan", type: "liability_current" },
  { code: "2-1700", name: "Biaya Masih Harus Dibayar", type: "liability_current" },
  { key: "stockInput", code: "2-1800", name: "Barang Diterima Belum Ditagih", type: "liability_current" },
  { code: "2-2100", name: "Utang Bank Jangka Panjang", type: "liability_non_current" },
  { code: "2-2200", name: "Liabilitas Imbalan Kerja", type: "liability_non_current" },
  { code: "3-1000", name: "Modal Disetor", type: "equity" },
  { key: "retained", code: "3-2000", name: "Saldo Laba", type: "equity" },
  { code: "3-3000", name: "Dividen", type: "equity" },
  { code: "3-9000", name: "Laba Tahun Berjalan", type: "equity_unaffected" },
  { key: "income", code: "4-1000", name: "Pendapatan Penjualan", type: "income" },
  { code: "4-1100", name: "Pendapatan Jasa", type: "income" },
  { code: "4-1200", name: "Pendapatan Antar Perusahaan", type: "income" },
  { code: "4-1900", name: "Potongan Penjualan", type: "income" },
  { code: "4-9000", name: "Pendapatan Lain-lain", type: "income_other" },
  { key: "fxGain", code: "4-9100", name: "Laba Selisih Kurs", type: "income_other" },
  {
    key: "unrealizedFxGain",
    code: "4-9110",
    name: "Laba Selisih Kurs Belum Terealisasi",
    type: "income_other",
  },
  { code: "4-9200", name: "Pendapatan Bunga", type: "income_other" },
  { code: "4-9400", name: "Laba (Rugi) Pelepasan Investasi", type: "income_other" },
  { key: "assetDisposal", code: "4-9500", name: "Laba (Rugi) Pelepasan Aset Tetap", type: "income_other" },
  { key: "cogs", code: "5-1000", name: "Harga Pokok Penjualan", type: "expense_direct_cost" },
  { key: "priceDifference", code: "5-1100", name: "Selisih Harga Pembelian", type: "expense_direct_cost" },
  { key: "stockAdjustment", code: "5-1200", name: "Selisih Persediaan", type: "expense_direct_cost" },
  { code: "6-1000", name: "Beban Gaji dan Tunjangan", type: "expense" },
  { code: "6-1100", name: "Beban BPJS", type: "expense" },
  { code: "6-2000", name: "Beban Sewa", type: "expense" },
  { code: "6-3000", name: "Beban Listrik, Air, dan Telepon", type: "expense" },
  { code: "6-4000", name: "Beban Penyusutan", type: "expense_depreciation" },
  { key: "expense", code: "6-5000", name: "Beban Umum dan Administrasi", type: "expense" },
  { code: "6-6000", name: "Beban Pemasaran", type: "expense" },
  { code: "6-7000", name: "Beban Antar Perusahaan", type: "expense" },
  { code: "7-1000", name: "Beban Administrasi Bank", type: "expense_other" },
  { key: "fxLoss", code: "7-1100", name: "Rugi Selisih Kurs", type: "expense_other" },
  {
    key: "unrealizedFxLoss",
    code: "7-1110",
    name: "Rugi Selisih Kurs Belum Terealisasi",
    type: "expense_other",
  },
  { code: "7-1200", name: "Beban Bunga", type: "expense_other" },
  { code: "8-1000", name: "Beban Pajak Penghasilan", type: "expense_other" },
];

const JOURNALS: {
  key: string;
  code: string;
  name: string;
  type: (typeof schema.JOURNAL_TYPES)[number];
  account?: string;
}[] = [
  { key: "sale", code: "INV", name: "Faktur Penjualan", type: "sale", account: "income" },
  { key: "purchase", code: "BILL", name: "Tagihan Pembelian", type: "purchase", account: "expense" },
  { key: "bank", code: "BNK1", name: "Bank", type: "bank", account: "bank" },
  { key: "cash", code: "CSH1", name: "Kas", type: "cash", account: "cash" },
  { key: "general", code: "MISC", name: "Jurnal Umum", type: "general" },
  { key: "stock", code: "STJ", name: "Valuasi Persediaan", type: "general" },
  { key: "payroll", code: "SAL", name: "Gaji", type: "general" },
];

// PMK 131/2024: PPN 12%; untuk barang/jasa non-mewah DPP = 11/12 harga jual (efektif 11%).
const DPP_11_12 = "0.9166666667";
const TAXES: {
  name: string;
  use: "sale" | "purchase";
  amount: string;
  baseRatio: string;
  account: string;
  kind: (typeof schema.TAX_KINDS)[number];
}[] = [
  {
    name: "PPN Keluaran 12% (DPP 11/12)",
    use: "sale",
    amount: "12",
    baseRatio: DPP_11_12,
    account: "vatOut",
    kind: "vat",
  },
  {
    name: "PPN Keluaran 12% (barang mewah)",
    use: "sale",
    amount: "12",
    baseRatio: "1",
    account: "vatOut",
    kind: "vat_luxury",
  },
  {
    name: "PPh 23 2% (dipotong pelanggan)",
    use: "sale",
    amount: "-2",
    baseRatio: "1",
    account: "pph23Prepaid",
    kind: "pph23",
  },
  {
    name: "PPN Masukan 12% (DPP 11/12)",
    use: "purchase",
    amount: "12",
    baseRatio: DPP_11_12,
    account: "vatIn",
    kind: "vat",
  },
  {
    name: "PPN Masukan 12% (barang mewah)",
    use: "purchase",
    amount: "12",
    baseRatio: "1",
    account: "vatIn",
    kind: "vat_luxury",
  },
  {
    name: "PPh 23 2% (dipotong)",
    use: "purchase",
    amount: "-2",
    baseRatio: "1",
    account: "pph23Payable",
    kind: "pph23",
  },
];

/**
 * Pasang bagan akun, jurnal, pajak, dan pengaturan akuntansi bawaan untuk sebuah perusahaan.
 * Idempoten: tidak melakukan apa-apa bila perusahaan sudah punya pengaturan akuntansi.
 */
export async function installChart(tx: Db, companyId: string): Promise<boolean> {
  const [existing] = await tx
    .select({ id: schema.accountingSettings.companyId })
    .from(schema.accountingSettings)
    .where(eq(schema.accountingSettings.companyId, companyId));
  if (existing) return false;

  const rows = await tx
    .insert(schema.accounts)
    .values(
      ACCOUNTS.map((a) => ({
        companyId,
        code: a.code,
        name: a.name,
        accountType: a.type,
        reconcile: a.reconcile ?? false,
        branchClearing: a.branchClearing ?? false,
      })),
    )
    .returning({ id: schema.accounts.id, code: schema.accounts.code });
  const byCode = new Map(rows.map((r) => [r.code, r.id]));
  const account = (key: string) => byCode.get(ACCOUNTS.find((a) => a.key === key)!.code)!;

  const journals = await tx
    .insert(schema.journals)
    .values(
      JOURNALS.map((j) => ({
        companyId,
        code: j.code,
        name: j.name,
        journalType: j.type,
        defaultAccountId: j.account ? account(j.account) : null,
      })),
    )
    .returning({ id: schema.journals.id, code: schema.journals.code });
  const journal = (key: string) =>
    journals.find((j) => j.code === JOURNALS.find((x) => x.key === key)!.code)!.id;

  const taxes = await tx
    .insert(schema.taxes)
    .values(
      TAXES.map((t) => ({
        companyId,
        name: t.name,
        typeTaxUse: t.use,
        amount: t.amount,
        baseRatio: t.baseRatio,
        accountId: account(t.account),
        taxKind: t.kind,
      })),
    )
    .returning({ id: schema.taxes.id, name: schema.taxes.name });
  const tax = (name: string) => taxes.find((t) => t.name === name)!.id;

  await tx.insert(schema.accountingSettings).values({
    companyId,
    receivableAccountId: account("receivable"),
    payableAccountId: account("payable"),
    icReceivableAccountId: account("icReceivable"),
    icPayableAccountId: account("icPayable"),
    retainedEarningsAccountId: account("retained"),
    saleJournalId: journal("sale"),
    purchaseJournalId: journal("purchase"),
    generalJournalId: journal("general"),
    fxGainAccountId: account("fxGain"),
    fxLossAccountId: account("fxLoss"),
    unrealizedFxGainAccountId: account("unrealizedFxGain"),
    unrealizedFxLossAccountId: account("unrealizedFxLoss"),
    assetDisposalAccountId: account("assetDisposal"),
    defaultSaleTaxId: tax("PPN Keluaran 12% (DPP 11/12)"),
    defaultPurchaseTaxId: tax("PPN Masukan 12% (DPP 11/12)"),
    downPaymentAccountId: account("customerDown"),
    stockValuationAccountId: account("stock"),
    stockInputAccountId: account("stockInput"),
    cogsAccountId: account("cogs"),
    stockAdjustmentAccountId: account("stockAdjustment"),
    priceDifferenceAccountId: account("priceDifference"),
    stockJournalId: journal("stock"),
  });
  return true;
}
