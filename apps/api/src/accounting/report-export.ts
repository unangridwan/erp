import ExcelJS from "exceljs";

type Cell = string | number | null;
interface Sheet {
  title: string;
  subtitle: string;
  columns: { header: string; width: number; numeric?: boolean }[];
  rows: { cells: Cell[]; bold?: boolean }[];
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
interface SectionData {
  accounts: { code: string; name: string; amount: string }[];
  total: string;
}

function sectionRows(title: string, s: SectionData): Sheet["rows"] {
  return [
    { cells: [title, null], bold: true },
    ...s.accounts.map((a) => ({
      cells: [`${a.code ? `${a.code} ` : ""}${a.name}`, num(a.amount)] as Cell[],
    })),
    { cells: [`Total ${title.toLowerCase()}`, num(s.total)], bold: true },
  ];
}

/** Ubah hasil laporan (JSON) menjadi lembar kerja tabular. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function reportSheet(name: string, data: any): Sheet {
  const twoCol = [
    { header: "Akun", width: 50 },
    { header: "Jumlah", width: 20, numeric: true },
  ];
  switch (name) {
    case "profit-loss":
      return {
        title: "Laporan Laba Rugi",
        subtitle: `${data.dateFrom} s.d. ${data.dateTo}`,
        columns: twoCol,
        rows: [
          ...sectionRows("Pendapatan", data.income),
          ...sectionRows("Harga pokok penjualan", data.directCost),
          { cells: ["Laba kotor", num(data.grossProfit)], bold: true },
          ...sectionRows("Beban operasional", data.expense),
          { cells: ["Laba usaha", num(data.operatingProfit)], bold: true },
          ...sectionRows("Pendapatan lain-lain", data.otherIncome),
          ...sectionRows("Beban lain-lain", data.otherExpense),
          { cells: ["Laba bersih", num(data.netProfit)], bold: true },
        ],
      };
    case "balance-sheet":
      return {
        title: "Neraca",
        subtitle: `Per ${data.date}`,
        columns: twoCol,
        rows: [
          ...sectionRows("Aset", data.assets),
          ...sectionRows("Liabilitas", data.liabilities),
          ...sectionRows("Ekuitas", data.equity),
          { cells: ["Total liabilitas dan ekuitas", num(data.totalLiabilitiesAndEquity)], bold: true },
        ],
      };
    case "trial-balance":
      return {
        title: "Neraca Saldo",
        subtitle: `${data.dateFrom} s.d. ${data.dateTo}`,
        columns: [
          { header: "Kode", width: 12 },
          { header: "Akun", width: 45 },
          { header: "Saldo awal", width: 18, numeric: true },
          { header: "Debit", width: 18, numeric: true },
          { header: "Kredit", width: 18, numeric: true },
          { header: "Saldo akhir", width: 18, numeric: true },
        ],
        rows: [
          ...data.lines.map((l: Record<string, string>) => ({
            cells: [l.code, l.name, num(l.opening), num(l.debit), num(l.credit), num(l.closing)],
          })),
          {
            cells: [
              "",
              "Total",
              num(data.totals.opening),
              num(data.totals.debit),
              num(data.totals.credit),
              num(data.totals.closing),
            ],
            bold: true,
          },
        ],
      };
    case "general-ledger":
      return {
        title: `Buku Besar ${data.account.code} ${data.account.name}`,
        subtitle: `${data.dateFrom} s.d. ${data.dateTo}`,
        columns: [
          { header: "Tanggal", width: 12 },
          { header: "Entri", width: 18 },
          { header: "Partner", width: 28 },
          { header: "Keterangan", width: 40 },
          { header: "Debit", width: 18, numeric: true },
          { header: "Kredit", width: 18, numeric: true },
          { header: "Saldo", width: 18, numeric: true },
        ],
        rows: [
          { cells: ["", "", "", "Saldo awal", null, null, num(data.opening)], bold: true },
          ...data.lines.map((l: Record<string, string | null>) => ({
            cells: [
              l.date,
              l.move_name,
              l.partner,
              l.label ?? l.ref,
              num(l.debit),
              num(l.credit),
              num(l.balance),
            ],
          })),
        ],
      };
    case "aged":
      return {
        title: data.type === "receivable" ? "Umur Piutang" : "Umur Utang",
        subtitle: `Per ${data.date}`,
        columns: [
          { header: "Partner", width: 35 },
          ...["Belum jatuh tempo", "1–30", "31–60", "61–90", "> 90", "Total"].map((h) => ({
            header: h,
            width: 16,
            numeric: true,
          })),
        ],
        rows: [...data.partners, { ...data.totals, partner: "Total", isTotal: true }].map(
          (p: Record<string, string>) => ({
            cells: [
              p.partner ?? "",
              ...["current", "d1_30", "d31_60", "d61_90", "over90", "total"].map((k) => num(p[k])),
            ],
            bold: Boolean(p.isTotal),
          }),
        ),
      };
    case "budget":
      return {
        title: `Anggaran vs Realisasi — ${data.budget.name}`,
        subtitle: `${data.budget.dateFrom} s.d. ${data.budget.dateTo}`,
        columns: [
          { header: "Kode", width: 12 },
          { header: "Akun", width: 40 },
          { header: "Anggaran", width: 18, numeric: true },
          { header: "Realisasi", width: 18, numeric: true },
          { header: "Selisih", width: 18, numeric: true },
          { header: "Capaian %", width: 12, numeric: true },
        ],
        rows: data.lines.map((l: Record<string, string | number | null>) => ({
          cells: [
            l.code,
            l.name,
            num(l.budget),
            num(l.actual),
            num(l.variance),
            l.achievement as number | null,
          ],
        })),
      };
    default:
      throw new Error(`Laporan ${name} tidak dikenal`);
  }
}

export async function toXlsx(sheet: Sheet, company: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERP";
  const ws = wb.addWorksheet(sheet.title.slice(0, 31));
  ws.addRow([company]).font = { bold: true, size: 13 };
  ws.addRow([sheet.title]).font = { bold: true, size: 12 };
  ws.addRow([sheet.subtitle]);
  ws.addRow([]);
  const header = ws.addRow(sheet.columns.map((c) => c.header));
  header.font = { bold: true };
  header.eachCell((cell) => (cell.border = { bottom: { style: "thin" } }));
  sheet.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width;
    if (c.numeric) col.numFmt = "#,##0.00;[Red]-#,##0.00";
  });
  for (const row of sheet.rows) {
    const r = ws.addRow(row.cells);
    if (row.bold) r.font = { bold: true };
  }
  ws.views = [{ state: "frozen", ySplit: 5 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
