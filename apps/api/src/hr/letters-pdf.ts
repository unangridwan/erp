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

export interface ContractPdfSignature {
  name: string;
  title: string | null;
  image: Buffer;
  signedAt: Date;
  inPerson: boolean;
  ip: string | null;
}

/**
 * Dokumen kontrak kerja. `print` = kolom tanda tangan kosong + kotak meterai (dicetak, ditandatangani basah);
 * `esign` = kolom tanda tangan PDF (AcroForm /Sig) untuk layanan tanda tangan elektronik luar; `signed` = gambar tanda
 * tangan yang dibuat di aplikasi + lembar jejak audit (waktu, IP, hash dokumen, kode verifikasi).
 */
export function renderContractPdf(data: {
  mode: "print" | "esign" | "signed";
  company: { name: string; address: string | null };
  title: string;
  number: string;
  body: string;
  city: string;
  date: string;
  companySigner: { label: string; name: string; title: string | null };
  employeeSigner: { name: string };
  signatures: { company?: ContractPdfSignature; employee?: ContractPdfSignature };
  verifyCode: string | null;
  verifyUrl: string | null;
  documentHash: string | null;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 56, bottom: 64, left: 64, right: 64 },
      bufferPages: true,
      info: { Title: `${data.title} ${data.number}`, Subject: data.employeeSigner.name },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;

    // Kop perusahaan.
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#000").text(data.company.name, left, doc.y, { width });
    if (data.company.address)
      doc.font("Helvetica").fontSize(9).fillColor("#444").text(data.company.address, { width });
    doc
      .moveDown(0.4)
      .moveTo(left, doc.y)
      .lineTo(left + width, doc.y)
      .lineWidth(1)
      .stroke("#333333");
    doc.moveDown(1.2).fillColor("#000");
    doc.font("Helvetica-Bold").fontSize(13).text(data.title, left, doc.y, { width, align: "center" });
    doc.font("Helvetica").fontSize(10).text(`Nomor: ${data.number}`, { width, align: "center" });
    doc.moveDown(1.2);

    // Isi: judul pasal tebal & rata tengah, paragraf rata kanan-kiri.
    for (const block of data.body.split(/\n{2,}/)) {
      const lines = block.split("\n");
      if (/^Pasal\s+\d+/i.test(lines[0] ?? "")) {
        if (doc.y > bottom() - 60) doc.addPage();
        doc.font("Helvetica-Bold").fontSize(10.5).text(lines[0]!, left, doc.y, { width, align: "center" });
        lines.shift();
      }
      if (lines.length)
        doc
          .font("Helvetica")
          .fontSize(10.5)
          .text(lines.join("\n"), left, doc.y, { width, align: "justify", lineGap: 2.5 });
      doc.moveDown(0.8);
    }

    // Blok tanda tangan (tidak terpotong halaman).
    if (doc.y > bottom() - 190) doc.addPage();
    doc.moveDown(0.5);
    doc
      .font("Helvetica")
      .fontSize(10.5)
      .text(`${data.city}, ${data.date}`, left, doc.y, { width, align: "right" });
    doc.moveDown(1);
    const colW = (width - 40) / 2;
    const cols = [
      {
        x: left,
        head: "PIHAK PERTAMA",
        sub: data.company.name,
        name: data.companySigner.name,
        title: data.companySigner.title,
        sig: data.signatures.company,
        field: "TTD_Perusahaan",
        stamp: false,
      },
      {
        x: left + colW + 40,
        head: "PIHAK KEDUA",
        sub: "Karyawan",
        name: data.employeeSigner.name,
        title: null,
        sig: data.signatures.employee,
        field: "TTD_Karyawan",
        stamp: true,
      },
    ];
    const top = doc.y;
    const boxH = 72;
    if (data.mode === "esign") {
      doc.initForm();
      (
        doc as unknown as { _root: { data: { AcroForm: { data: Record<string, unknown> } } } }
      )._root.data.AcroForm.data.SigFlags = 1;
    }
    for (const c of cols) {
      doc.font("Helvetica-Bold").fontSize(10.5).text(c.head, c.x, top, { width: colW, align: "center" });
      doc.font("Helvetica").fontSize(9.5).text(c.sub, c.x, doc.y, { width: colW, align: "center" });
      const boxY = doc.y + 6;
      if (data.mode === "signed" && c.sig) {
        doc.image(c.sig.image, c.x + colW / 2 - 80, boxY, {
          fit: [160, boxH - 14],
          align: "center",
          valign: "center",
        });
        doc
          .font("Helvetica")
          .fontSize(7)
          .fillColor("#555")
          .text(
            `Ditandatangani elektronik ${c.sig.signedAt.toISOString().replace("T", " ").slice(0, 16)} UTC`,
            c.x,
            boxY + boxH - 12,
            { width: colW, align: "center" },
          )
          .fillColor("#000");
      } else if (data.mode === "esign") {
        doc
          .rect(c.x + 10, boxY, colW - 20, boxH - 4)
          .dash(3, { space: 3 })
          .stroke("#888888")
          .undash();
        const dict = (
          doc as unknown as { _fieldDict: (n: string, t: null, o: object) => Record<string, unknown> }
        )._fieldDict(c.field, null, { FT: "Sig" });
        dict.Subtype = "Widget";
        dict.F = 4;
        doc.annotate(c.x + 10, boxY, colW - 20, boxH - 4, dict);
        const ref = doc.page.annotations[doc.page.annotations.length - 1];
        (doc as unknown as { _addToParent: (r: unknown) => void })._addToParent(ref);
      } else if (c.stamp) {
        // Tempat meterai untuk tanda tangan basah pihak kedua.
        doc
          .rect(c.x + 14, boxY + 8, 62, 44)
          .dash(2, { space: 2 })
          .stroke("#999999")
          .undash();
        doc
          .font("Helvetica")
          .fontSize(7)
          .fillColor("#777")
          .text("Meterai\n10.000", c.x + 14, boxY + 20, { width: 62, align: "center" })
          .fillColor("#000");
      }
      const nameY = boxY + boxH + 4;
      doc
        .font("Helvetica-Bold")
        .fontSize(10.5)
        .text(c.name, c.x, nameY, { width: colW, align: "center", underline: true });
      if (c.title)
        doc.font("Helvetica").fontSize(9.5).text(c.title, c.x, doc.y, { width: colW, align: "center" });
    }
    doc.x = left;

    // Lembar jejak audit tanda tangan elektronik.
    if (data.mode === "signed" && (data.signatures.company || data.signatures.employee)) {
      doc.addPage();
      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .text("Jejak Audit Tanda Tangan Elektronik", left, doc.y, { width });
      doc.moveDown(0.6).font("Helvetica").fontSize(9.5);
      const rows: [string, string][] = [
        ["Dokumen", `${data.title} No. ${data.number}`],
        ["Hash dokumen (SHA-256)", data.documentHash ?? "—"],
        ["Kode verifikasi", data.verifyCode ?? "—"],
      ];
      if (data.verifyUrl) rows.push(["Verifikasi", data.verifyUrl]);
      for (const [label, signer] of [
        ["Pihak pertama", data.signatures.company],
        ["Pihak kedua", data.signatures.employee],
      ] as const) {
        if (!signer) continue;
        rows.push([
          label,
          `${signer.name}${signer.title ? `, ${signer.title}` : ""} — ${signer.signedAt.toISOString()}${
            signer.ip ? ` — IP ${signer.ip}` : ""
          }${signer.inPerson ? " — ditandatangani langsung di hadapan HR" : ""}`,
        ]);
      }
      for (const [label, value] of rows) {
        const y = doc.y;
        doc.font("Helvetica-Bold").text(label, left, y, { width: 150 });
        doc.font("Helvetica").text(value, left + 160, y, { width: width - 160 });
        doc.moveDown(0.5);
      }
      doc
        .moveDown(0.5)
        .fontSize(8.5)
        .fillColor("#555")
        .text(
          "Tanda tangan dibuat melalui aplikasi setelah penanda tangan menyetujui isi dokumen. Perubahan isi dokumen setelah ditandatangani menghasilkan hash yang berbeda.",
          left,
          doc.y,
          { width },
        )
        .fillColor("#000");
    }

    // Kaki halaman: nomor dokumen, halaman, kode verifikasi.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const footer = [
        `${data.number} · Halaman ${i + 1} dari ${range.count}`,
        data.verifyCode ? `Kode verifikasi ${data.verifyCode}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      // Teks di bawah margin bawah memicu halaman baru di pdfkit; margin dinolkan sementara.
      const margin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor("#777")
        .text(footer, left, doc.page.height - margin + 24, {
          width,
          align: "center",
          lineBreak: false,
        })
        .fillColor("#000");
      doc.page.margins.bottom = margin;
    }
    doc.end();
  });
}
