import PDFDocument from "pdfkit";

export interface PayslipPdfData {
  company: string;
  title: string;
  period: string;
  employee: { name: string; number: string; department: string | null; job: string | null; ptkp: string };
  earnings: { name: string; amount: string }[];
  deductions: { name: string; amount: string }[];
  employer: { name: string; amount: string }[];
  net: string;
  pph21Info: string;
}

const fmt = (v: string) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Number(v));

/** Slip gaji A5 landscape: pendapatan, potongan, gaji bersih, dan informasi iuran perusahaan. */
export function renderPayslipPdf(data: PayslipPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: { Title: `${data.title} ${data.employee.name}` },
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
      .text(`${data.title} — ${data.period}`, left, 48, { align: "right", width });
    doc
      .font("Helvetica")
      .fontSize(9)
      .text("Rahasia — hanya untuk karyawan yang bersangkutan", left, 66, { align: "right", width });

    let y = 96;
    const info: [string, string][] = [
      ["Nama", data.employee.name],
      ["NIK karyawan", data.employee.number],
      ["Departemen", data.employee.department ?? "—"],
      ["Jabatan", data.employee.job ?? "—"],
      ["Status PTKP", data.employee.ptkp],
    ];
    for (const [label, value] of info) {
      doc.font("Helvetica-Bold").fontSize(9).text(label, left, y, { width: 90 });
      doc.font("Helvetica").text(value, left + 90, y, { width: width / 2 - 90 });
      y += 14;
    }

    y += 12;
    const col = (width - 24) / 2;
    const table = (x: number, title: string, rows: { name: string; amount: string }[], total: string) => {
      let yy = y;
      doc.font("Helvetica-Bold").fontSize(10).text(title, x, yy, { width: col });
      yy += 16;
      doc
        .moveTo(x, yy - 2)
        .lineTo(x + col, yy - 2)
        .stroke();
      doc.font("Helvetica").fontSize(9);
      for (const r of rows) {
        doc.text(r.name, x, yy, { width: col - 90 });
        doc.text(fmt(r.amount), x + col - 90, yy, { width: 90, align: "right" });
        yy += 14;
      }
      doc
        .moveTo(x, yy)
        .lineTo(x + col, yy)
        .stroke();
      doc.font("Helvetica-Bold").text("Total", x, yy + 4, { width: col - 90 });
      doc.text(fmt(total), x + col - 90, yy + 4, { width: 90, align: "right" });
      return yy + 20;
    };
    const sum = (rows: { amount: string }[]) => String(rows.reduce((s, r) => s + Number(r.amount), 0));
    const a = table(left, "Pendapatan", data.earnings, sum(data.earnings));
    const b = table(left + col + 24, "Potongan", data.deductions, sum(data.deductions));
    y = Math.max(a, b) + 8;

    doc.rect(left, y, width, 28).fillAndStroke("#f0f0f5", "#cccccc");
    doc
      .fillColor("#000")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Gaji bersih (take home pay)", left + 10, y + 8);
    doc.text(`Rp ${fmt(data.net)}`, left, y + 8, { width: width - 10, align: "right" });
    y += 44;

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .text("Iuran yang dibayar perusahaan (tidak memotong gaji)", left, y);
    y += 14;
    doc.font("Helvetica");
    for (const r of data.employer) {
      doc.text(r.name, left, y, { width: 300 });
      doc.text(fmt(r.amount), left + 300, y, { width: 90, align: "right" });
      y += 13;
    }
    y += 8;
    doc.fontSize(8).fillColor("#555").text(data.pph21Info, left, y, { width });
    doc.end();
  });
}
