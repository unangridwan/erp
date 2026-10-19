import { num, sectionRows, type Cell, type Sheet } from "../accounting/report-export.js";
import type { ConsolidationService } from "./consolidation.service.js";

type Report = Awaited<ReturnType<ConsolidationService["report"]>>;
type Worksheet = Awaited<ReturnType<ConsolidationService["worksheet"]>>;
type Run = Awaited<ReturnType<ConsolidationService["get"]>>;

const ENTRY_KIND: Record<string, string> = {
  investment: "Eliminasi investasi",
  nci_profit: "Bagian laba KNP",
  intercompany: "Antar perusahaan",
  equity_method: "Metode ekuitas",
  unrealized_profit: "Laba belum terealisasi",
  disposal: "Pelepasan entitas anak",
  translation: "Translasi",
  manual: "Manual",
};

/** Paket laporan konsolidasian sebagai lembar-lembar Excel. */
export function consolidationSheets(run: Run, report: Report, ws: Worksheet): Sheet[] {
  const period = `${run.dateFrom} s.d. ${run.dateTo} (${run.currencyCode})`;
  const twoCol = [
    { header: "Akun", width: 55 },
    { header: "Jumlah", width: 20, numeric: true },
  ];
  const bs = report.balanceSheet;
  const pl = report.profitLoss;
  const sheets: Sheet[] = [
    {
      title: "Posisi Keuangan",
      subtitle: `Laporan posisi keuangan konsolidasian per ${run.dateTo} (${run.currencyCode})`,
      columns: twoCol,
      rows: [
        ...sectionRows("Aset", bs.assets),
        ...sectionRows("Liabilitas", bs.liabilities),
        ...sectionRows("Ekuitas yang diatribusikan ke pemilik entitas induk", bs.equity),
        { cells: ["Kepentingan non-pengendali", num(bs.nonControllingInterest)], bold: true },
        { cells: ["Total ekuitas", num(bs.totalEquity)], bold: true },
        { cells: ["Total liabilitas dan ekuitas", num(bs.totalLiabilitiesEquity)], bold: true },
      ],
    },
    {
      title: "Laba Rugi",
      subtitle: `Laporan laba rugi konsolidasian ${period}`,
      columns: twoCol,
      rows: [
        ...sectionRows("Pendapatan", pl.income),
        ...sectionRows("Harga pokok penjualan", pl.directCost),
        { cells: ["Laba kotor", num(pl.grossProfit)], bold: true },
        ...sectionRows("Beban usaha", pl.expense),
        { cells: ["Laba usaha", num(pl.operatingProfit)], bold: true },
        ...sectionRows("Pendapatan lain-lain", pl.otherIncome),
        ...sectionRows("Beban lain-lain", pl.otherExpense),
        { cells: ["Laba bersih", num(pl.netProfit)], bold: true },
        { cells: ["Diatribusikan ke pemilik entitas induk", num(pl.attributableToOwners)] },
        { cells: ["Diatribusikan ke kepentingan non-pengendali", num(pl.attributableToNci)] },
      ],
    },
  ];
  if (report.equityChanges) {
    const headers = [
      "Modal & cadangan lain",
      "Saldo laba",
      "Selisih kurs penjabaran",
      "Selisih transaksi dengan KNP",
      "Pemilik entitas induk",
      "Kepentingan non-pengendali",
      "Total ekuitas",
    ];
    sheets.push({
      title: "Perubahan Ekuitas",
      subtitle: `Laporan perubahan ekuitas konsolidasian ${period}`,
      columns: [{ header: "", width: 55 }, ...headers.map((h) => ({ header: h, width: 18, numeric: true }))],
      rows: report.equityChanges.rows.map((r) => ({
        cells: [r.label, ...report.equityChanges!.columns.map((c) => num(r.values[c]))] as Cell[],
        bold: r.key === "opening" || r.key === "closing",
      })),
    });
  }
  if (report.cashFlow) {
    const cf = report.cashFlow;
    const section = (title: string, s: { items: { label: string; amount: string }[]; total: string }) => [
      { cells: [title, null] as Cell[], bold: true },
      ...s.items.map((i) => ({ cells: [i.label, num(i.amount)] as Cell[] })),
      { cells: [`Kas bersih ${title.toLowerCase()}`, num(s.total)] as Cell[], bold: true },
    ];
    sheets.push({
      title: "Arus Kas",
      subtitle: `Laporan arus kas konsolidasian (metode tidak langsung) ${period}`,
      columns: twoCol,
      rows: [
        ...section("Dari aktivitas operasi", cf.operating),
        ...section("Dari aktivitas investasi", cf.investing),
        ...section("Dari aktivitas pendanaan", cf.financing),
        { cells: ["Pengaruh selisih kurs penjabaran", num(cf.translationEffect)] },
        { cells: ["Kenaikan (penurunan) kas bersih", num(cf.netChange)], bold: true },
        { cells: ["Kas awal periode", num(cf.cashOpening)] },
        { cells: ["Kas akhir periode", num(cf.cashClosing)], bold: true },
      ],
    });
  }
  sheets.push({
    title: "Kertas Kerja",
    subtitle: `Kertas kerja konsolidasi ${period} — debit positif, kredit negatif`,
    columns: [
      { header: "Kode", width: 12 },
      { header: "Akun grup", width: 40 },
      ...ws.columns.map((c) => ({ header: c.name, width: 18, numeric: true })),
      { header: "Jumlah gabungan", width: 18, numeric: true },
      { header: "Eliminasi & penyesuaian", width: 18, numeric: true },
      { header: "Konsolidasian", width: 18, numeric: true },
    ],
    rows: ws.rows.map((r) => ({
      cells: [
        r.code,
        r.name,
        ...ws.columns.map((c) => num(r.byCompany[c.companyId])),
        num(r.total),
        num(r.adjustments),
        num(r.consolidated),
      ],
    })),
  });
  const entity = (id: string | null) =>
    id ? (run.entities.find((e) => e.companyId === id)?.name ?? "") : "(grup)";
  sheets.push({
    title: "Jurnal Eliminasi",
    subtitle: `Jurnal eliminasi & penyesuaian konsolidasi ${period}`,
    columns: [
      { header: "Jenis", width: 22 },
      { header: "Keterangan", width: 50 },
      { header: "Akun grup", width: 40 },
      { header: "Entitas", width: 25 },
      { header: "Debit", width: 18, numeric: true },
      { header: "Kredit", width: 18, numeric: true },
    ],
    rows: run.entries.flatMap((e) =>
      e.lines.map((l) => ({
        cells: [
          ENTRY_KIND[e.kind] ?? e.kind,
          e.description,
          `${l.code} ${l.name}`,
          entity(l.companyId),
          Number(l.amount) > 0 ? num(l.amount) : null,
          Number(l.amount) < 0 ? -Number(l.amount) : null,
        ] as Cell[],
      })),
    ),
  });
  return sheets;
}
