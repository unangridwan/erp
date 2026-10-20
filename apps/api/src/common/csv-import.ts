import ExcelJS from "exceljs";
import { z, type AnyZodObject, type ZodTypeAny } from "zod";

/** Ambil tipe dasar dari skema zod (melewati optional/nullable/default/transform). */
function baseType(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) current = current.unwrap();
    else if (current instanceof z.ZodDefault) current = current._def.innerType;
    else if (current instanceof z.ZodEffects) current = current.innerType();
    else return current;
  }
}

const TRUE = new Set(["true", "1", "ya", "y", "yes"]);
const FALSE = new Set(["false", "0", "tidak", "t", "no", "n"]);

/**
 * Ubah satu baris CSV (semua string) ke bentuk yang diharapkan skema: sel kosong diabaikan
 * (agar default berlaku), boolean dari ya/tidak/true/false/1/0. Kolom di luar skema diabaikan.
 */
export function coerceCsvRow(schema: AnyZodObject, row: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.shape as Record<string, ZodTypeAny>)) {
    const raw = row[key]?.trim();
    if (raw === undefined || raw === "") continue;
    const type = baseType(field);
    if (type instanceof z.ZodBoolean) {
      const lower = raw.toLowerCase();
      out[key] = TRUE.has(lower) ? true : FALSE.has(lower) ? false : raw;
    } else {
      out[key] = raw;
    }
  }
  return out;
}

export const exportColumns = (schema: AnyZodObject) => ["id", ...Object.keys(schema.shape)];

/** Teks sel Excel: tanggal → YYYY-MM-DD, rumus → hasilnya, rich text → teks biasa. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as { result?: unknown; richText?: { text: string }[]; text?: string; hyperlink?: string };
    if ("result" in v) return cellText(v.result);
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.text !== undefined) return String(v.text);
    return "";
  }
  return String(value);
}

/**
 * Baris lembar pertama berkas .xlsx (base64) sebagai objek berkunci judul kolom baris pertama, sama seperti
 * `parseCsv`; baris kosong dilewati.
 */
export async function parseXlsx(base64: string): Promise<Record<string, string>[]> {
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(Buffer.from(base64, "base64") as unknown as ArrayBuffer);
  } catch {
    throw new Error("Berkas Excel tidak valid (gunakan format .xlsx)");
  }
  const sheet = book.worksheets[0];
  if (!sheet) throw new Error("Berkas Excel tidak punya lembar kerja");
  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cellText(cell.value).trim();
  });
  const rows: Record<string, string>[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const out: Record<string, string> = {};
    let filled = false;
    headers.forEach((h, i) => {
      if (!h) return;
      const text = cellText(row.getCell(i + 1).value).trim();
      out[h] = text;
      if (text) filled = true;
    });
    if (filled) rows.push(out);
  }
  return rows;
}

/** Berkas .xlsx satu lembar dari kolom & baris (untuk ekspor/template impor). */
export async function toXlsx(sheetName: string, columns: string[], rows: Record<string, unknown>[]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(sheetName.slice(0, 31));
  sheet.addRow(columns).font = { bold: true };
  for (const r of rows)
    sheet.addRow(
      columns.map((c) => {
        const v = r[c];
        if (v === null || v === undefined) return "";
        if (Array.isArray(v)) return v.join(",");
        if (v instanceof Date) return v.toISOString();
        return typeof v === "object" ? JSON.stringify(v) : v;
      }),
    );
  sheet.columns.forEach((col) => (col.width = 18));
  return Buffer.from(await book.xlsx.writeBuffer());
}
