import ExcelJS from "exceljs";
import { z, type ZodType } from "zod";

export type AnyZodObject = z.ZodObject<z.ZodRawShape>;
type ZodTypeAny = ZodType;

/** Ambil tipe dasar dari skema zod (melewati optional/nullable/default/transform). */
function baseType(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  for (;;) {
    if (
      current instanceof z.ZodOptional ||
      current instanceof z.ZodNullable ||
      current instanceof z.ZodDefault ||
      current instanceof z.ZodPrefault
    )
      current = current.unwrap() as ZodTypeAny;
    // Transform/preprocess di zod 4 berupa pipa: tipe masukan ada di sisi `in`.
    else if (current instanceof z.ZodPipe) current = current.def.in as ZodTypeAny;
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
  for (const [key, field] of Object.entries(schema.shape as unknown as Record<string, ZodTypeAny>)) {
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

/** Teks sel Excel: tanggal → YYYY-MM-DD (jam → HH:MM), rumus → hasilnya, rich text → teks biasa. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const iso = value.toISOString();
    // Sel jam saja (Excel menyimpannya sebagai 30 Des 1899) → HH:MM; tanggal+jam → "YYYY-MM-DD HH:MM".
    if (iso.startsWith("1899-12-3")) return iso.slice(11, 16);
    return iso.slice(11, 19) === "00:00:00" ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  }
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

export interface XlsxSheet {
  name: string;
  columns: { key: string; header?: string; width?: number; numeric?: boolean }[];
  rows: Record<string, unknown>[];
  /** Baris total di bawah: kunci kolom → nilai. */
  totals?: Record<string, unknown>;
}

const xlsxCell = (v: unknown, numeric?: boolean) => {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(",");
  if (v instanceof Date) return v.toISOString();
  if (numeric && typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return typeof v === "object" ? JSON.stringify(v) : v;
};

/** Berkas .xlsx beberapa lembar: judul tebal & dibekukan, lebar kolom, angka sebagai angka, baris total opsional. */
export async function toXlsxBook(sheets: XlsxSheet[]) {
  const book = new ExcelJS.Workbook();
  for (const s of sheets) {
    const sheet = book.addWorksheet(s.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
    sheet.addRow(s.columns.map((c) => c.header ?? c.key)).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of s.rows) sheet.addRow(s.columns.map((c) => xlsxCell(r[c.key], c.numeric)));
    if (s.totals)
      sheet.addRow(s.columns.map((c) => xlsxCell(s.totals![c.key], c.numeric))).font = { bold: true };
    s.columns.forEach((c, i) => {
      const col = sheet.getColumn(i + 1);
      col.width = c.width ?? Math.min(40, Math.max(12, (c.header ?? c.key).length + 2));
      if (c.numeric) col.numFmt = "#,##0.##";
    });
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

/** Berkas .xlsx satu lembar dari kolom & baris (untuk ekspor/template impor). */
export function toXlsx(sheetName: string, columns: string[], rows: Record<string, unknown>[]) {
  return toXlsxBook([{ name: sheetName, columns: columns.map((key) => ({ key, width: 18 })), rows }]);
}
