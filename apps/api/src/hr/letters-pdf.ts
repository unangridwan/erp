import PDFDocument from "pdfkit";

const fmt = (v: string) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Number(v));

function render(build: (doc: PDFKit.PDFDocument, width: number) => void, title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: title } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    build(doc, doc.page.width - doc.page.margins.left - doc.page.margins.right);
    doc.end();
  });
}

/** Surat penawaran kerja: kop perusahaan, nomor, lalu isi surat yang sudah dirender dari template. */
export function renderOfferPdf(data: { company: string; number: string | null; body: string }) {
  return render(
    (doc, width) => {
      doc.font("Helvetica-Bold").fontSize(14).text(data.company);
      if (data.number) doc.font("Helvetica").fontSize(9).fillColor("#555").text(`No. ${data.number}`);
      doc
        .moveDown(0.5)
        .moveTo(doc.x, doc.y)
        .lineTo(doc.x + width, doc.y)
        .stroke("#cccccc");
      doc.moveDown(1).fillColor("#000").font("Helvetica").fontSize(11).text(data.body, { width, lineGap: 3 });
    },
    `Penawaran kerja ${data.number ?? ""}`.trim(),
  );
}

/** Full & Final Statement: hak & kewajiban karyawan yang keluar beserta saldo akhir. */
export function renderSettlementPdf(data: {
  company: string;
  employee: { name: string; number: string; department: string | null; job: string | null };
  resignDate: string | null;
  resignReason: string | null;
  items: { label: string; amount: string; direction: "pay" | "deduct" }[];
  totalPay: string;
  totalDeduct: string;
  net: string;
  openTasks: string[];
}) {
  return render((doc, width) => {
    doc.font("Helvetica-Bold").fontSize(14).text(data.company);
    doc.fontSize(12).text("Full & Final Statement (Perhitungan Hak Akhir)", { align: "right" });
    doc.moveDown(0.5);
    const info: [string, string][] = [
      ["Nama", data.employee.name],
      ["No. karyawan", data.employee.number],
      ["Departemen", data.employee.department ?? "—"],
      ["Jabatan", data.employee.job ?? "—"],
      ["Tanggal keluar", data.resignDate ?? "—"],
      ["Alasan keluar", data.resignReason ?? "—"],
    ];
    for (const [label, value] of info) {
      const y = doc.y;
      doc.font("Helvetica-Bold").fontSize(10).text(label, doc.page.margins.left, y, { width: 110 });
      doc.font("Helvetica").text(value, doc.page.margins.left + 110, y, { width: width - 110 });
    }
    doc.moveDown(1);
    const row = (label: string, amount: string, bold = false) => {
      const y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10);
      doc.text(label, doc.page.margins.left, y, { width: width - 120 });
      doc.text(amount, doc.page.margins.left + width - 120, y, { width: 120, align: "right" });
      doc.moveDown(0.3);
    };
    for (const [title, dir] of [
      ["Hak karyawan", "pay"],
      ["Kewajiban karyawan (dipotong)", "deduct"],
    ] as const) {
      doc.font("Helvetica-Bold").fontSize(11).text(title, doc.page.margins.left);
      doc.moveDown(0.3);
      const rows = data.items.filter((i) => i.direction === dir);
      if (!rows.length) row("—", "0");
      for (const i of rows) row(i.label, fmt(i.amount));
      row("Subtotal", fmt(dir === "pay" ? data.totalPay : data.totalDeduct), true);
      doc.moveDown(0.6);
    }
    row(
      Number(data.net) >= 0 ? "Dibayar ke karyawan" : "Ditagih ke karyawan",
      `Rp ${fmt(String(Math.abs(Number(data.net))))}`,
      true,
    );
    if (data.openTasks.length) {
      doc
        .moveDown(1)
        .font("Helvetica-Bold")
        .fontSize(10)
        .text("Checklist offboarding belum selesai:", doc.page.margins.left);
      doc.font("Helvetica").fontSize(9);
      for (const t of data.openTasks) doc.text(`• ${t}`);
    }
    doc.moveDown(3).font("Helvetica").fontSize(10);
    const y = doc.y;
    doc.text("Karyawan", doc.page.margins.left, y, { width: width / 2, align: "center" });
    doc.text("HR", doc.page.margins.left + width / 2, y, { width: width / 2, align: "center" });
  }, `Full & Final ${data.employee.name}`);
}
