import PDFDocument from "pdfkit";
import { code128, code128Width } from "@erp/shared";

export interface Label {
  title: string;
  subtitle?: string | null;
  /** Teks yang dikodekan (barcode produk/SKU atau nomor lot/serial). */
  code: string;
}

const COLS = 3;
const ROWS = 8;
const PAGE = { width: 595.28, height: 841.89, marginX: 20, marginY: 24 };

/** Label barcode Code 128 di kertas A4 (3 × 8 label per halaman). */
export function renderLabelsPdf(labels: Label[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: "Label barcode" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const w = (PAGE.width - PAGE.marginX * 2) / COLS;
    const h = (PAGE.height - PAGE.marginY * 2) / ROWS;
    labels.forEach((label, i) => {
      const slot = i % (COLS * ROWS);
      if (i > 0 && slot === 0) doc.addPage();
      const x = PAGE.marginX + (slot % COLS) * w;
      const y = PAGE.marginY + Math.floor(slot / COLS) * h;
      const pad = 8;
      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor("#000")
        .text(label.title, x + pad, y + pad, {
          width: w - pad * 2,
          height: 10,
          ellipsis: true,
          lineBreak: false,
        });
      if (label.subtitle)
        doc
          .font("Helvetica")
          .fontSize(7)
          .text(label.subtitle, x + pad, y + pad + 11, {
            width: w - pad * 2,
            height: 9,
            ellipsis: true,
            lineBreak: false,
          });
      let modules: number[];
      try {
        modules = code128(label.code);
      } catch {
        doc.fontSize(7).text("(kode tidak bisa dibuat barcode)", x + pad, y + 40, { width: w - pad * 2 });
        return;
      }
      const barArea = w - pad * 2;
      const unit = Math.min(1.2, barArea / (code128Width(modules) + 20));
      const barWidth = unit * code128Width(modules);
      let bx = x + (w - barWidth) / 2;
      const by = y + pad + 24;
      const bh = h - pad * 2 - 40;
      modules.forEach((m, k) => {
        if (k % 2 === 0) doc.rect(bx, by, m * unit, bh).fill("#000");
        bx += m * unit;
      });
      doc
        .font("Courier")
        .fontSize(8)
        .fillColor("#000")
        .text(label.code, x + pad, by + bh + 3, { width: w - pad * 2, align: "center", lineBreak: false });
    });
    doc.end();
  });
}
