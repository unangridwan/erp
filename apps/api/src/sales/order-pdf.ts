import PDFDocument from "pdfkit";

export interface OrderPdfData {
  title: string;
  name: string;
  company: { name: string; npwp: string | null };
  partner: { name: string; street: string | null; city: string | null; npwp: string | null };
  dateOrder: string;
  validityDate: string | null;
  paymentTerm: string | null;
  salesperson: string | null;
  clientOrderRef: string | null;
  currencyCode: string;
  lines: { name: string; quantity: string; priceUnit: string; discount: string; subtotal: string }[];
  taxes: { name: string; amount: string }[];
  amountUntaxed: string;
  amountTotal: string;
  note: string | null;
}

const fmt = (v: string, digits = 2) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(
    Number(v),
  );
const fmtDate = (d: string) =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** PDF penawaran / pesanan penjualan (A4). */
export function renderOrderPdf(data: OrderPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `${data.title} ${data.name}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc.font("Helvetica-Bold").fontSize(16).text(data.company.name, left, 48);
    doc.font("Helvetica").fontSize(9);
    if (data.company.npwp) doc.text(`NPWP: ${data.company.npwp}`);
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .text(`${data.title} ${data.name}`, left, 48, { align: "right", width });

    doc.moveDown(2).font("Helvetica-Bold").fontSize(10).text("Kepada:", left, 110);
    doc.font("Helvetica").text(data.partner.name);
    if (data.partner.street) doc.text(data.partner.street);
    if (data.partner.city) doc.text(data.partner.city);
    if (data.partner.npwp) doc.text(`NPWP: ${data.partner.npwp}`);

    const meta: [string, string | null][] = [
      ["Tanggal", fmtDate(data.dateOrder)],
      ["Berlaku hingga", data.validityDate ? fmtDate(data.validityDate) : null],
      ["Termin", data.paymentTerm],
      ["Penjual", data.salesperson],
      ["Ref. pelanggan", data.clientOrderRef],
      ["Mata uang", data.currencyCode],
    ];
    let y = 110;
    for (const [label, value] of meta) {
      if (!value) continue;
      doc.font("Helvetica-Bold").text(label, left + width / 2, y, { width: 90 });
      doc.font("Helvetica").text(value, left + width / 2 + 90, y, { width: width / 2 - 90 });
      y += 14;
    }

    // Tabel baris: deskripsi, kuantitas, harga, diskon, subtotal.
    const cols = [
      { label: "Deskripsi", width: width - 290, align: "left" as const },
      { label: "Kuantitas", width: 60, align: "right" as const },
      { label: "Harga satuan", width: 90, align: "right" as const },
      { label: "Disk. %", width: 45, align: "right" as const },
      { label: "Subtotal", width: 95, align: "right" as const },
    ];
    y = Math.max(doc.y, y) + 24;
    const row = (cells: string[], bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
      const height = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: cols[i]!.width - 6 })));
      if (y + height > doc.page.height - doc.page.margins.bottom - 80) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      let x = left;
      cells.forEach((c, i) => {
        doc.text(c, x + 3, y, { width: cols[i]!.width - 6, align: cols[i]!.align });
        x += cols[i]!.width;
      });
      y += height + 6;
    };
    row(
      cols.map((c) => c.label),
      true,
    );
    doc
      .moveTo(left, y - 3)
      .lineTo(left + width, y - 3)
      .stroke();
    for (const l of data.lines) {
      row([l.name, fmt(l.quantity, 4), fmt(l.priceUnit, 4), fmt(l.discount, 2), fmt(l.subtotal)]);
    }
    doc
      .moveTo(left, y)
      .lineTo(left + width, y)
      .stroke();
    y += 8;

    const total = (label: string, value: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9);
      doc.text(label, left + width - 280, y, { width: 180, align: "right" });
      doc.text(fmt(value), left + width - 95, y, { width: 92, align: "right" });
      y += bold ? 18 : 14;
    };
    total("Subtotal", data.amountUntaxed);
    for (const t of data.taxes) total(t.name, t.amount);
    total(`Total (${data.currencyCode})`, data.amountTotal, true);

    if (data.note) {
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .text("Catatan", left, y + 16);
      doc.font("Helvetica").text(data.note, { width });
    }
    doc.end();
  });
}
