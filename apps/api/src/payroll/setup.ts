import { and, eq, inArray, schema, type Db } from "@erp/db";

/** Komponen gaji bawaan: [kode, nama, jenis, tunjangan tetap, kode akun lawan]. */
const COMPONENTS: [string, string, "allowance" | "deduction", boolean, string | null][] = [
  ["TJAB", "Tunjangan jabatan", "allowance", true, null],
  ["TKEL", "Tunjangan keluarga", "allowance", true, null],
  ["TRANS", "Tunjangan transport", "allowance", false, null],
  ["MAKAN", "Tunjangan makan", "allowance", false, null],
  ["THR", "Tunjangan Hari Raya", "allowance", false, null],
  ["BONUS", "Bonus", "allowance", false, null],
  ["PINJ", "Potongan pinjaman karyawan", "deduction", false, "1-1800"],
];

/** Pengaturan payroll & komponen gaji bawaan untuk perusahaan yang sudah punya bagan akun. Idempoten. */
export async function installPayroll(tx: Db, companyId: string) {
  const [existing] = await tx
    .select({ id: schema.payrollSettings.companyId })
    .from(schema.payrollSettings)
    .where(eq(schema.payrollSettings.companyId, companyId));
  if (existing) return;
  const accounts = await tx
    .select({ id: schema.accounts.id, code: schema.accounts.code })
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.companyId, companyId),
        inArray(schema.accounts.code, ["6-1000", "6-1100", "2-1500", "2-1300", "2-1400", "1-1800"]),
      ),
    );
  const [journal] = await tx
    .select({ id: schema.journals.id })
    .from(schema.journals)
    .where(and(eq(schema.journals.companyId, companyId), eq(schema.journals.code, "SAL")));
  const account = (code: string) => accounts.find((a) => a.code === code)?.id;
  const required = ["6-1000", "6-1100", "2-1500", "2-1300", "2-1400"].map(account);
  if (required.some((id) => !id) || !journal) return; // bagan akun non-standar: atur manual
  await tx.insert(schema.payrollSettings).values({
    companyId,
    salaryExpenseAccountId: account("6-1000")!,
    bpjsExpenseAccountId: account("6-1100")!,
    salaryPayableAccountId: account("2-1500")!,
    pph21PayableAccountId: account("2-1300")!,
    bpjsPayableAccountId: account("2-1400")!,
    employeeLoanAccountId: account("1-1800") ?? null,
    journalId: journal.id,
  });
  await tx
    .insert(schema.salaryComponents)
    .values(
      COMPONENTS.map(([code, name, kind, fixed, acc]) => ({
        companyId,
        code,
        name,
        kind,
        fixed,
        accountId: acc ? (account(acc) ?? null) : null,
      })),
    )
    .onConflictDoNothing();
}

export const DEFAULT_LEAVE_TYPES: [string, boolean, boolean][] = [
  ["Cuti tahunan", true, true],
  ["Sakit (dengan surat dokter)", true, false],
  ["Cuti melahirkan", true, false],
  ["Izin tanpa upah", false, false],
];
