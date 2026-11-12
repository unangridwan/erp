import PDFDocument from "pdfkit";

export interface DunningPdfData {
  name: string;
  date: string;
  levelName: string;
  company: {
    name: string;
    npwp: string | null;
    street: string | null;
    city: string | null;
    phone: string | null;
    email: string | null;
  };
  partner: { name: string; street: string | null; city: string | null };
  currencyCode: string;
  body: string;
  invoices: {
    name: string;
    date: string;
    dueDate: string;
    amountTotal: string;
    residual: string;
    daysOverdue: number;
  }[];
  totalOverdue: string;
}

const fmt = (v: string) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(v));
const fmtDate = (d: string) =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** Surat teguran pembayaran (A4): kop perusahaan, isi surat, tabel faktur tertunggak, total. */
export function renderDunningPdf(data: DunningPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 56,
      info: { Title: `${data.levelName} ${data.name}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc.font("Helvetica-Bold").fontSize(15).text(data.company.name, left, 56);
    doc.font("Helvetica").fontSize(9);
    const address = [data.company.street, data.company.city].filter(Boolean).join(", ");
    if (address) doc.text(address);
    const contact = [data.company.phone, data.company.email].filter(Boolean).join(" · ");
    if (contact) doc.text(contact);
    if (data.company.npwp) doc.text(`NPWP: ${data.company.npwp}`);
    doc
      .moveTo(left, doc.y + 6)
      .lineTo(left + width, doc.y + 6)
      .stroke();

    doc.moveDown(1.5).fontSize(10);
    doc.text(`Nomor: ${data.name}`);
    doc.text(`Tanggal: ${fmtDate(data.date)}`);
    doc.text(`Perihal: ${data.levelName}`);
    doc.moveDown();
    doc.font("Helvetica-Bold").text("Kepada:");
    doc.font("Helvetica").text(data.partner.name);
    if (data.partner.street) doc.text(data.partner.street);
    if (data.partner.city) doc.text(data.partner.city);
    doc.moveDown();

    // Isi surat: baris daftar faktur ("- INV/…") diganti tabel di posisi yang sama; penutup ikut isi surat.
    const lines = data.body.replace(/\r/g, "").split("\n");
    const isInvoiceLine = (line: string) => data.invoices.some((i) => line.startsWith(`- ${i.name} `));
    const first = lines.findIndex(isInvoiceLine);
    const before = first < 0 ? lines : lines.slice(0, first);
    const after = first < 0 ? [] : lines.slice(first).filter((line) => !isInvoiceLine(line));
    const paragraph = (text: string[]) => {
      const t = text
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (t) doc.font("Helvetica").fontSize(10).text(t, left, doc.y, { width, align: "left" });
    };
    paragraph(before);
    doc.moveDown();

    const cols = [
      { label: "Faktur", width: width - 330, align: "left" as const },
      { label: "Tanggal", width: 75, align: "left" as const },
      { label: "Jatuh tempo", width: 75, align: "left" as const },
      { label: "Hari", width: 40, align: "right" as const },
      { label: `Sisa (${data.currencyCode})`, width: 140, align: "right" as const },
    ];
    let y = doc.y;
    const row = (cells: string[], bold = false) => {
      if (y > doc.page.height - 100) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
      let x = left;
      cells.forEach((c, i) => {
        doc.text(c, x + 2, y, { width: cols[i]!.width - 4, align: cols[i]!.align });
        x += cols[i]!.width;
      });
      y += 16;
    };
    row(
      cols.map((c) => c.label),
      true,
    );
    doc
      .moveTo(left, y - 3)
      .lineTo(left + width, y - 3)
      .stroke();
    for (const inv of data.invoices) {
      row([inv.name, fmtDate(inv.date), fmtDate(inv.dueDate), String(inv.daysOverdue), fmt(inv.residual)]);
    }
    doc
      .moveTo(left, y - 3)
      .lineTo(left + width, y - 3)
      .stroke();
    row(["Total tertunggak", "", "", "", fmt(data.totalOverdue)], true);
    doc.y = y + 8;
    doc.moveDown();
    paragraph(after);
    doc.end();
  });
}
