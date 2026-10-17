import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, isNull, lte, schema, sql, type Db } from "@erp/db";
import { depreciationSchedule } from "@erp/shared";
import { currentContext } from "../common/request-context.js";
import { assertCompanyAccounts, assertCompanyJournal, assertDimensions, loadBooks } from "./context.js";
import { MoveService } from "./move.service.js";

/** Validasi sebelum simpan (dipakai CRUD): hanya draft yang bisa diubah; akun & jurnal milik perusahaan. */
export async function validateAsset(tx: Db, values: Record<string, unknown>, id?: string) {
  const companyId = String(values.companyId ?? currentContext().companyId);
  if (id) {
    const [asset] = await tx
      .select({ state: schema.assets.state })
      .from(schema.assets)
      .where(eq(schema.assets.id, id));
    if (asset && asset.state !== "draft")
      throw new BadRequestException("Aset yang sudah berjalan tidak bisa diubah");
  }
  const refs = (["assetAccountId", "depreciationAccountId", "expenseAccountId"] as const)
    .filter((k) => typeof values[k] === "string")
    .map((k) => ({ path: k, id: values[k] as string }));
  await assertCompanyAccounts(tx, companyId, refs);
  if (!id && !values.journalId) values.journalId = (await loadBooks(tx, companyId)).settings.generalJournalId;
  if (typeof values.journalId === "string")
    await assertCompanyJournal(tx, companyId, values.journalId, ["general"]);
  await assertDimensions(tx, companyId, [values as { branchId?: string; businessUnitId?: string }]);
  if (
    values.firstDepreciationDate &&
    values.acquisitionDate &&
    String(values.firstDepreciationDate) < String(values.acquisitionDate)
  ) {
    throw new BadRequestException("Tanggal mulai penyusutan tidak boleh sebelum tanggal perolehan");
  }
}

@Injectable()
export class AssetService {
  constructor(@Inject(MoveService) private readonly moves: MoveService) {}

  async get(tx: Db, id: string) {
    const [asset] = await tx
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.id, id), eq(schema.assets.companyId, currentContext().companyId)));
    if (!asset) throw new NotFoundException("Aset tidak ditemukan");
    const schedule = await tx
      .select({ line: schema.assetDepreciationLines, moveName: schema.accountMoves.name })
      .from(schema.assetDepreciationLines)
      .leftJoin(schema.accountMoves, eq(schema.accountMoves.id, schema.assetDepreciationLines.moveId))
      .where(eq(schema.assetDepreciationLines.assetId, id))
      .orderBy(asc(schema.assetDepreciationLines.sequence));
    return { ...asset, schedule: schedule.map((r) => ({ ...r.line, moveName: r.moveName })) };
  }

  /** Konfirmasi aset: buat jadwal penyusutan dan ubah status menjadi berjalan. */
  async confirm(tx: Db, id: string) {
    const asset = await this.get(tx, id);
    if (asset.state !== "draft") throw new BadRequestException("Aset sudah dikonfirmasi");
    const books = await loadBooks(tx, asset.companyId);
    const lines = depreciationSchedule({
      cost: asset.cost,
      salvageValue: asset.salvageValue,
      usefulLifeMonths: asset.usefulLifeMonths,
      method: asset.method,
      firstDepreciationDate: asset.firstDepreciationDate,
      decimals: books.decimals,
    });
    await tx.insert(schema.assetDepreciationLines).values(lines.map((l) => ({ ...l, assetId: id })));
    await tx
      .update(schema.assets)
      .set({ state: "running", updatedAt: sql`now()` })
      .where(eq(schema.assets.id, id));
    return this.get(tx, id);
  }

  /** Posting semua penyusutan yang jatuh pada/sebelum `date` untuk aset berjalan di perusahaan aktif. */
  async depreciate(tx: Db, date: string) {
    const companyId = currentContext().companyId;
    const due = await tx
      .select({ line: schema.assetDepreciationLines, asset: schema.assets })
      .from(schema.assetDepreciationLines)
      .innerJoin(schema.assets, eq(schema.assets.id, schema.assetDepreciationLines.assetId))
      .where(
        and(
          eq(schema.assets.companyId, companyId),
          eq(schema.assets.state, "running"),
          isNull(schema.assetDepreciationLines.moveId),
          lte(schema.assetDepreciationLines.date, date),
        ),
      )
      .orderBy(asc(schema.assetDepreciationLines.date), asc(schema.assets.name))
      .for("update", { of: schema.assetDepreciationLines });

    const touched = new Set<string>();
    for (const { line, asset } of due) {
      // Baris bernilai nol (mungkin di akhir saldo menurun) tidak perlu dijurnal.
      if (Number(line.amount) === 0) continue;
      const label = `Penyusutan ${asset.code ? `${asset.code} ` : ""}${asset.name} (${line.sequence}/${asset.usefulLifeMonths})`;
      const moveId = await this.moves.createEntry(
        tx,
        {
          journalId: asset.journalId,
          date: line.date,
          ref: label,
          lines: [
            {
              accountId: asset.expenseAccountId,
              name: label,
              debit: line.amount,
              credit: "0",
              branchId: asset.branchId,
              businessUnitId: asset.businessUnitId,
            },
            {
              accountId: asset.depreciationAccountId,
              name: label,
              debit: "0",
              credit: line.amount,
              branchId: asset.branchId,
              businessUnitId: asset.businessUnitId,
            },
          ],
        },
        companyId,
      );
      await this.moves.post(tx, moveId);
      await tx
        .update(schema.assetDepreciationLines)
        .set({ moveId })
        .where(eq(schema.assetDepreciationLines.id, line.id));
      touched.add(asset.id);
    }
    // Aset yang seluruh jadwalnya sudah diposting menjadi selesai.
    for (const assetId of touched) {
      const [open] = await tx
        .select({ id: schema.assetDepreciationLines.id })
        .from(schema.assetDepreciationLines)
        .where(
          and(
            eq(schema.assetDepreciationLines.assetId, assetId),
            isNull(schema.assetDepreciationLines.moveId),
            sql`${schema.assetDepreciationLines.amount} <> 0`,
          ),
        )
        .limit(1);
      if (!open)
        await tx
          .update(schema.assets)
          .set({ state: "closed", updatedAt: sql`now()` })
          .where(eq(schema.assets.id, assetId));
    }
    return { posted: due.filter((d) => Number(d.line.amount) !== 0).length, assets: touched.size };
  }
}
