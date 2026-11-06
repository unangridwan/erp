import { and, eq, inArray, isNull, lt, or, schema, sql, type Db } from "@erp/db";
import { currentContext } from "../common/request-context.js";

const AP = schema.applicants;

/** Kolom data pribadi yang dicatat di log akses. */
export type PersonalField = "nik" | "npwp" | "bankAccount" | "kkNo" | "salary";

/**
 * Catat akses data pribadi karyawan (UU PDP): siapa, data apa, untuk apa. Akses karyawan atas datanya sendiri tidak
 * dicatat. `employeeId` kosong + `count` = akses massal (mis. ekspor).
 */
export async function logPersonalDataAccess(
  tx: Db,
  input: {
    employeeId?: string | null;
    employeeUserId?: string | null;
    fields: PersonalField[];
    purpose: string;
    count?: number;
  },
) {
  const ctx = currentContext();
  if (!input.fields.length) return;
  if (input.employeeUserId && input.employeeUserId === ctx.userId) return;
  await tx.insert(schema.personalDataAccessLogs).values({
    companyId: ctx.companyId,
    userId: ctx.userId,
    employeeId: input.employeeId ?? null,
    fields: input.fields,
    purpose: input.purpose.slice(0, 200),
    recordCount: input.count ?? 1,
  });
}

/** Bidang terenkripsi yang terisi pada data karyawan. */
export function filledPersonalFields(e: {
  nikEnc: string | null;
  npwpEnc: string | null;
  bankAccountEnc: string | null;
  kkNoEnc: string | null;
}): PersonalField[] {
  return [
    e.nikEnc ? "nik" : null,
    e.npwpEnc ? "npwp" : null,
    e.bankAccountEnc ? "bankAccount" : null,
    e.kkNoEnc ? "kkNo" : null,
  ].filter((f): f is PersonalField => f !== null);
}

/**
 * Anonimkan pelamar (UU PDP: hak penghapusan / masa retensi habis): identitas & catatan dihapus, berkas CV dan
 * dokumen pelamar dihapus; statistik rekrutmen (tahap, sumber, tanggal) tetap.
 */
export async function anonymizeApplicants(tx: Db, ids: string[]) {
  if (!ids.length) return 0;
  await tx.delete(schema.hrDocuments).where(inArray(schema.hrDocuments.applicantId, ids));
  await tx
    .update(schema.applicantInterviews)
    .set({ result: null })
    .where(inArray(schema.applicantInterviews.applicantId, ids));
  const rows = await tx
    .update(AP)
    .set({
      name: "Pelamar (dianonimkan)",
      email: null,
      phone: null,
      notes: null,
      expectedWage: null,
      refuseReason: null,
      anonymizedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(inArray(AP.id, ids), isNull(AP.anonymizedAt), isNull(AP.employeeId)))
    .returning({ id: AP.id });
  return rows.length;
}

/**
 * Masa retensi data pelamar: pelamar yang ditolak, atau lowongannya sudah ditutup tanpa diterima, lebih lama dari
 * `months` bulan sejak tahap terakhirnya, dianonimkan.
 */
export async function runApplicantRetention(tx: Db, companyId: string, months: number | null) {
  if (!months) return 0;
  const cutoff = sql`now() - make_interval(months => ${months})`;
  const due = await tx
    .select({ id: AP.id })
    .from(AP)
    .innerJoin(schema.jobOpenings, eq(schema.jobOpenings.id, AP.openingId))
    .where(
      and(
        eq(AP.companyId, companyId),
        isNull(AP.anonymizedAt),
        isNull(AP.employeeId),
        or(eq(AP.stage, "refused"), eq(schema.jobOpenings.state, "closed")),
        lt(AP.stageChangedAt, cutoff),
      ),
    );
  return anonymizeApplicants(
    tx,
    due.map((d) => d.id),
  );
}
