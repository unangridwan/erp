import PDFDocument from "pdfkit";

export interface TotalRewardsData {
  company: string;
  year: number;
  employee: { name: string; number: string; department: string | null; job: string | null };
  /** Diterima tunai (bruto, sebelum potongan). */
  cash: { name: string; amount: string }[];
  /** Dibayar perusahaan untuk karyawan (BPJS & benefit), tidak tunai. */
  employer: { name: string; amount: string }[];
  cashTotal: string;
  employerTotal: string;
  total: string;
  months: number;
  currentWage: string | null;
  benefits: string[];
}

const fmt = (v: string) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Number(v));

/** Laporan total rewards (total kompensasi) setahun per karyawan, A4. */
export function renderTotalRewardsPdf(data: TotalRewardsData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: { Title: `Total Rewards ${data.year} ${data.employee.name}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc.font("Helvetica-Bold").fontSize(14).text(data.company, left, 48);
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .text(`Total Rewards ${data.year}`, left, 48, { align: "right", width });
    doc
      .font("Helvetica")
      .fontSize(9)
      .text("Rahasia — hanya untuk karyawan yang bersangkutan", left, 66, { align: "right", width });

    let y = 96;
    for (const [label, value] of [
      ["Nama", data.employee.name],
      ["NIK karyawan", data.employee.number],
      ["Departemen", data.employee.department ?? "—"],
      ["Jabatan", data.employee.job ?? "—"],
      ["Upah pokok saat ini", data.currentWage ? `Rp ${fmt(data.currentWage)} / bulan` : "—"],
    ] as const) {
      doc.font("Helvetica-Bold").fontSize(9).text(label, left, y, { width: 110 });
      doc.font("Helvetica").text(value, left + 110, y, { width: width - 110 });
      y += 14;
    }
    y += 6;
    doc
      .fontSize(9)
      .fillColor("#555")
      .text(
        `Berdasarkan ${data.months} slip gaji terposting tahun ${data.year}. Nilai kotor sebelum potongan pajak & iuran karyawan.`,
        left,
        y,
        { width },
      );
    doc.fillColor("#000");
    y += 22;

    const table = (title: string, rows: { name: string; amount: string }[], total: string) => {
      doc.font("Helvetica-Bold").fontSize(10).text(title, left, y, { width });
      y += 16;
      doc
        .moveTo(left, y - 2)
        .lineTo(left + width, y - 2)
        .stroke();
      doc.font("Helvetica").fontSize(9);
      for (const r of rows.length ? rows : [{ name: "—", amount: "0" }]) {
        doc.text(r.name, left, y, { width: width - 120 });
        doc.text(fmt(r.amount), left + width - 120, y, { width: 120, align: "right" });
        y += 14;
      }
      doc
        .moveTo(left, y)
        .lineTo(left + width, y)
        .stroke();
      doc.font("Helvetica-Bold").text("Subtotal", left, y + 4, { width: width - 120 });
      doc.text(fmt(total), left + width - 120, y + 4, { width: 120, align: "right" });
      y += 28;
    };
    table("Penghasilan tunai", data.cash, data.cashTotal);
    table("Dibayar perusahaan untuk Anda (BPJS & benefit)", data.employer, data.employerTotal);

    doc.rect(left, y, width, 30).fill("#f1ecf0");
    doc
      .fillColor("#000")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Total rewards setahun", left + 10, y + 9);
    doc.text(`Rp ${fmt(data.total)}`, left, y + 9, { width: width - 10, align: "right" });
    y += 44;
    if (data.benefits.length)
      doc
        .font("Helvetica")
        .fontSize(9)
        .text(`Benefit aktif: ${data.benefits.join(", ")}.`, left, y, { width });
    doc.end();
  });
}
