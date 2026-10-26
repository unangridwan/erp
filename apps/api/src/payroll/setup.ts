import { and, eq, inArray, schema, type Db } from "@erp/db";

/** Komponen gaji bawaan: [kode, nama, jenis, tunjangan tetap, kode akun lawan]. */
const COMPONENTS: [string, string, "allowance" | "deduction", boolean, string | null][] = [
  ["TJAB", "Tunjangan jabatan", "allowance", true, null],
  ["TKEL", "Tunjangan keluarga", "allowance", true, null],
  ["TRANS", "Tunjangan transport", "allowance", false, null],
  ["MAKAN", "Tunjangan makan", "allowance", false, null],
  ["THR", "Tunjangan Hari Raya", "allowance", false, null],
  ["BONUS", "Bonus", "allowance", false, null],
  ["RAPEL", "Rapel kenaikan upah", "allowance", false, null],
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
        inArray(schema.accounts.code, [
          "6-1000",
          "6-1100",
          "6-1110",
          "2-1500",
          "2-1300",
          "2-1400",
          "2-1410",
          "1-1800",
        ]),
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
    bpjsTkExpenseAccountId: account("6-1100")!,
    bpjsKesExpenseAccountId: account("6-1110") ?? account("6-1100")!,
    salaryPayableAccountId: account("2-1500")!,
    pph21PayableAccountId: account("2-1300")!,
    bpjsTkPayableAccountId: account("2-1400")!,
    bpjsKesPayableAccountId: account("2-1410") ?? account("2-1400")!,
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
  const components = await tx
    .select({ id: schema.salaryComponents.id, code: schema.salaryComponents.code })
    .from(schema.salaryComponents)
    .where(
      and(
        eq(schema.salaryComponents.companyId, companyId),
        inArray(schema.salaryComponents.code, ["THR", "RAPEL"]),
      ),
    );
  await tx
    .update(schema.payrollSettings)
    .set({
      thrComponentId: components.find((c) => c.code === "THR")?.id ?? null,
      retroComponentId: components.find((c) => c.code === "RAPEL")?.id ?? null,
    })
    .where(eq(schema.payrollSettings.companyId, companyId));
}

/** Jenis cuti bawaan tenant baru: [nama, dibayar, memakai jatah, aturan tambahan]. */
export const DEFAULT_LEAVE_TYPES: [
  string,
  boolean,
  boolean,
  { requiresAttachment?: boolean; countCalendarDays?: boolean; allowHalfDay?: boolean }?,
][] = [
  ["Cuti tahunan", true, true],
  ["Sakit (dengan surat dokter)", true, false, { requiresAttachment: true }],
  ["Cuti melahirkan", true, false, { countCalendarDays: true, allowHalfDay: false }],
  ["Izin tanpa upah", false, false],
  ["Cuti menikah", true, false],
  ["Cuti ayah/paternitas", true, false],
  ["Cuti duka", true, false],
  ["Cuti pengganti", true, true],
];
