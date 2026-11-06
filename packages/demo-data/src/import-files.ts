/** File siap impor per perusahaan, mengikuti format importer ERP (data-transfer & impor CSV/Excel daftar). */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import type { Cell, Model, Row } from "./model.js";
import { SHEETS } from "./sheets.js";

const cell = (v: Cell | undefined) =>
  v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "ya" : "tidak") : v;

export async function writeSheetFile(path: string, columns: [string, string][], rows: Row[]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Data");
  sheet.addRow(columns.map(([, h]) => h)).font = { bold: true };
  for (const r of rows) sheet.addRow(columns.map(([k]) => cell(r[k])));
  columns.forEach(([, h], i) => (sheet.getColumn(i + 1).width = Math.max(12, h.length + 2)));
  await book.xlsx.writeFile(path);
}

/** Judul kolom lembar (tanpa kolom Perusahaan) — sama dengan judul template data-transfer ERP. */
const hrColumns = (sheet: string, extra: [string, string][] = []): [string, string][] => [
  ...SHEETS.find((s) => s.name === sheet)!
    .columns.filter(([k]) => k !== "company")
    .map(([k, h]) => [k, h] as [string, string]),
  ...extra,
];

export interface ImportFile {
  company: string;
  file: string;
  menu: string;
}

export async function writeImportFiles(model: Model, dir: string): Promise<ImportFile[]> {
  const out: ImportFile[] = [];
  const of = (sheet: string, company?: string) =>
    (model[sheet] ?? []).filter((r) => !company || r.company === company);
  const put = async (
    company: string,
    file: string,
    menu: string,
    columns: [string, string][],
    rows: Row[],
  ) => {
    if (!rows.length) return;
    await mkdir(join(dir, company), { recursive: true });
    await writeSheetFile(join(dir, company, file), columns, rows);
    out.push({ company, file: `${company}/${file}`, menu });
  };

  // Tingkat grup (perusahaan aktif mana pun). Impor daftar memakai nama field sebagai judul kolom.
  await put(
    "GRUP",
    "01-unit-bisnis.xlsx",
    "Pengaturan › Unit Bisnis › Impor",
    [
      ["code", "code"],
      ["name", "name"],
    ],
    of("Unit Bisnis"),
  );
  await put(
    "GRUP",
    "02-kurs.xlsx",
    "Akuntansi › Kurs Mata Uang › Impor",
    [
      ["currencyCode", "currencyCode"],
      ["rateDate", "rateDate"],
      ["rate", "rate"],
    ],
    of("Kurs"),
  );
  await put(
    "GRUP",
    "03-golongan-upah.xlsx",
    "Karyawan › Golongan Upah › Impor",
    ["code", "name", "baseWage", "minWage", "maxWage", "sequence"].map((k) => [k, k] as [string, string]),
    of("Golongan Upah"),
  );

  for (const company of [...new Set(of("Perusahaan").map((r) => String(r.code)))]) {
    const partnerCols = [
      "name",
      "kind",
      "isCustomer",
      "isSupplier",
      "npwp",
      "email",
      "phone",
      "street",
      "city",
      "province",
      "countryCode",
      "taxDocumentType",
      "taxTrxCode",
    ].map((k) => [k, k] as [string, string]);
    await put(company, "01-partner.xlsx", "Kontak › Partner › Impor", partnerCols, of("Partner", company));
    await put(
      company,
      "02-akun-tambahan.xlsx",
      "Akuntansi › Bagan Akun › Impor",
      [
        ["code", "code"],
        ["name", "name"],
        ["accountType", "accountType"],
      ],
      of("Akun Tambahan", company),
    );
    await put(
      company,
      "03-saldo-awal.xlsx",
      "Onboarding › Saldo Awal (salin kolom kode akun, debit, kredit, keterangan)",
      [
        ["accountCode", "Kode Akun"],
        ["debit", "Debit"],
        ["credit", "Kredit"],
        ["name", "Keterangan"],
        ["partner", "Partner (isi manual)"],
      ],
      of("Saldo Awal", company),
    );
    await put(
      company,
      "04-karyawan.xlsx",
      "Karyawan › Impor/Ekspor Data › Karyawan › Impor",
      hrColumns("Karyawan"),
      of("Karyawan", company),
    );
    await put(
      company,
      "05-kontrak.xlsx",
      "Karyawan › Impor/Ekspor Data › Kontrak › Impor",
      hrColumns("Kontrak", [["start", "Mulai Berlaku"]]),
      of("Kontrak", company).map((r) => ({ ...r, start: true })),
    );
    await put(
      company,
      "06-keluarga.xlsx",
      "Karyawan › Impor/Ekspor Data › Keluarga › Impor",
      hrColumns("Keluarga"),
      of("Keluarga", company),
    );
    await put(
      company,
      "07-pendidikan.xlsx",
      "Karyawan › Impor/Ekspor Data › Pendidikan › Impor",
      hrColumns("Pendidikan"),
      of("Pendidikan", company),
    );
    await put(
      company,
      "08-alokasi-cuti.xlsx",
      "Cuti & Klaim › Impor/Ekspor Data › Alokasi Cuti › Impor",
      hrColumns("Alokasi Cuti"),
      of("Alokasi Cuti", company),
    );
    for (const period of ["2026-08", "2026-09", "2026-10"])
      await put(
        company,
        `09-absensi-${period}.xlsx`,
        "Kehadiran › Impor/Ekspor Data › Absensi › Impor",
        hrColumns("Absensi"),
        of("Absensi", company).filter((r) => String(r.date).startsWith(period)),
      );
    await put(
      company,
      "10-lembur.xlsx",
      "Kehadiran › Impor/Ekspor Data › Lembur › Impor",
      hrColumns("Lembur"),
      of("Lembur", company),
    );
    await put(
      company,
      "11-anggaran-tenaga-kerja.xlsx",
      "Karyawan › Perencanaan › Anggaran Tenaga Kerja › Impor (tahun 2026)",
      [
        ["department", "Departemen"],
        ["month", "Bulan"],
        ["headcount", "Headcount"],
        ["cost", "Biaya"],
      ],
      of("Anggaran Tenaga Kerja", company),
    );
  }
  return out;
}
