import PDFDocument from "pdfkit";

export interface PayslipPdfData {
  company: string;
  title: string;
  period: string;
  employee: { name: string; number: string; department: string | null; job: string | null; ptkp: string };
  earnings: { name: string; amount: string }[];
  deductions: { name: string; amount: string }[];
  /** BPJS Kesehatan & BPJS Ketenagakerjaan selalu ditampilkan terpisah. */
  bpjs: { title: string; wage: string; rows: { name: string; employee: string; employer: string }[] }[];
  /** Benefit (asuransi, DPLK, fasilitas): porsi perusahaan tidak dibayarkan tunai, porsi karyawan sudah di potongan. */
  benefits?: { name: string; employee: string; employer: string }[];
  net: string;
  pph21Info: string;
  /** Saldo cuti per akhir periode, mis. "Cuti Tahunan 8 hari". */
  leaveBalances?: { name: string; remaining: string }[];
}

const fmt = (v: string) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Number(v));

/** Slip gaji A5 landscape: pendapatan, potongan, gaji bersih, dan informasi iuran perusahaan. */
export function renderPayslipPdf(
  data: PayslipPdfData,
  opts: { password?: string | null } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: { Title: `${data.title} ${data.employee.name}` },
      // Dilindungi kata sandi (AES-128, PDF 1.7) untuk slip yang dikirim via email.
      ...(opts.password
        ? {
            pdfVersion: "1.7" as const,
            userPassword: opts.password,
            permissions: { printing: "highResolution" as const, copying: true },
          }
        : {}),
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

    // Rincian BPJS per program: kolom karyawan (memotong gaji) & perusahaan (tidak memotong gaji).
    let bottom = y;
    data.bpjs.forEach((program, i) => {
      const x = left + i * (col + 24);
      let yy = y;
      doc.font("Helvetica-Bold").fontSize(9).text(program.title, x, yy, { width: col });
      yy += 12;
      doc
        .font("Helvetica")
        .fontSize(8)
        .text(`Dasar upah Rp ${fmt(program.wage)}`, x, yy, { width: col });
      yy += 12;
      doc.font("Helvetica-Bold").text("Program", x, yy, { width: col - 140 });
      doc.text("Karyawan", x + col - 140, yy, { width: 70, align: "right" });
      doc.text("Perusahaan", x + col - 70, yy, { width: 70, align: "right" });
      yy += 12;
      doc.font("Helvetica");
      const rows = program.rows.length
        ? program.rows
        : [{ name: "Tidak terdaftar", employee: "0", employer: "0" }];
      for (const r of rows) {
        doc.text(r.name, x, yy, { width: col - 140 });
        doc.text(fmt(r.employee), x + col - 140, yy, { width: 70, align: "right" });
        doc.text(fmt(r.employer), x + col - 70, yy, { width: 70, align: "right" });
        yy += 12;
      }
      const total = (k: "employee" | "employer") => String(rows.reduce((t, r) => t + Number(r[k]), 0));
      doc.font("Helvetica-Bold").text("Subtotal", x, yy, { width: col - 140 });
      doc.text(fmt(total("employee")), x + col - 140, yy, { width: 70, align: "right" });
      doc.text(fmt(total("employer")), x + col - 70, yy, { width: 70, align: "right" });
      bottom = Math.max(bottom, yy + 14);
    });
    y = bottom;
    if (data.benefits?.length) {
      doc.font("Helvetica-Bold").fontSize(9).text("Benefit & asuransi", left, y, { width: col });
      y += 12;
      doc.fontSize(8).text("Paket", left, y, { width: col - 140 });
      doc.text("Karyawan", left + col - 140, y, { width: 70, align: "right" });
      doc.text("Perusahaan", left + col - 70, y, { width: 70, align: "right" });
      y += 12;
      doc.font("Helvetica");
      for (const b of data.benefits) {
        doc.text(b.name, left, y, { width: col - 140 });
        doc.text(fmt(b.employee), left + col - 140, y, { width: 70, align: "right" });
        doc.text(fmt(b.employer), left + col - 70, y, { width: 70, align: "right" });
        y += 12;
      }
      y += 2;
    }
    y += 8;
    doc.font("Helvetica").fontSize(8).fillColor("#555").text(data.pph21Info, left, y, { width });
    if (data.leaveBalances?.length) {
      const days = (v: string) =>
        new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(v));
      doc
        .moveDown(0.5)
        .text(
          `Saldo cuti per akhir periode: ${data.leaveBalances.map((b) => `${b.name} ${days(b.remaining)} hari`).join(" · ")}`,
          { width },
        );
    }
    doc.end();
  });
}

interface SlipForPdf {
  employee: { name: string; employeeNumber: string; departmentName: string | null; jobName: string | null };
  run: { name: string; periodStart: string; kind?: "regular" | "correction" };
  ptkpStatus: string;
  lines: { code: string; name: string; category: string; amount: string; benefitPlanId?: string | null }[];
  bpjsKesWage: string;
  bpjsTkWage: string;
  net: string;
  gross: string;
  isFinal: boolean;
  terCategory: string;
  terRate: string | null;
  leaveBalances?: { leaveTypeName: string; remaining: string }[];
}

/** Data PDF slip gaji dari slip lengkap (`PayrollService.payslip`). */
/** Program BPJS per kode baris: [judul, kode karyawan, kode perusahaan, nama program]. */
const BPJS_PROGRAMS: [string, [string, string | null, string | null][]][] = [
  ["BPJS Kesehatan", [["Jaminan Kesehatan", "BPJS_KES_EE", "BPJS_KES_ER"]]],
  [
    "BPJS Ketenagakerjaan",
    [
      ["Jaminan Hari Tua (JHT)", "JHT_EE", "JHT_ER"],
      ["Jaminan Kecelakaan Kerja (JKK)", null, "JKK"],
      ["Jaminan Kematian (JKM)", null, "JKM"],
      ["Jaminan Pensiun (JP)", "JP_EE", "JP_ER"],
    ],
  ],
];

/** Satu baris per paket benefit: porsi karyawan (potongan) & porsi perusahaan (benefit_employer). */
export function benefitRows(lines: SlipForPdf["lines"]) {
  const byPlan = new Map<string, { name: string; employee: string; employer: string }>();
  for (const l of lines) {
    if (!l.benefitPlanId) continue;
    const row = byPlan.get(l.benefitPlanId) ?? {
      name: l.name.replace(/ \((perusahaan|karyawan)\)$/, ""),
      employee: "0",
      employer: "0",
    };
    if (l.category === "benefit_employer") row.employer = String(Number(l.amount));
    else row.employee = String(-Number(l.amount));
    byPlan.set(l.benefitPlanId, row);
  }
  return [...byPlan.values()];
}

export function payslipPdfData(slip: SlipForPdf, company: string): PayslipPdfData {
  const amount = (code: string | null) =>
    code ? String(Math.abs(Number(slip.lines.find((l) => l.code === code)?.amount ?? 0))) : "0";
  const deduction = (l: { amount: string }) => String(-Number(l.amount));
  const bpjsEmployee = (program: "kes" | "tk") =>
    slip.lines.filter(
      (l) => l.category === "bpjs_employee" && l.code.startsWith("BPJS_KES") === (program === "kes"),
    );
  const subtotal = (rows: { amount: string }[]) => String(rows.reduce((t, l) => t - Number(l.amount), 0));
  return {
    company,
    title: "Slip Gaji",
    period: slip.run.name,
    employee: {
      name: slip.employee.name,
      number: slip.employee.employeeNumber,
      department: slip.employee.departmentName,
      job: slip.employee.jobName,
      ptkp: slip.ptkpStatus,
    },
    earnings: slip.lines
      .filter((l) => ["basic", "allowance", "overtime", "unpaid"].includes(l.category))
      .map((l) => ({ name: l.name, amount: l.amount })),
    // Potongan tampil positif; PPh 21 lebih potong (baris positif) tampil sebagai pengembalian (negatif). Iuran BPJS
    // karyawan satu baris per program: BPJS Kesehatan dan BPJS Ketenagakerjaan.
    deductions: [
      ...(bpjsEmployee("kes").length
        ? [{ name: "BPJS Kesehatan", amount: subtotal(bpjsEmployee("kes")) }]
        : []),
      ...(bpjsEmployee("tk").length
        ? [{ name: "BPJS Ketenagakerjaan (JHT, JP)", amount: subtotal(bpjsEmployee("tk")) }]
        : []),
      ...slip.lines
        .filter((l) => ["tax", "deduction"].includes(l.category))
        .map((l) => ({ name: l.name, amount: deduction(l) })),
    ],
    bpjs: BPJS_PROGRAMS.map(([title, rows], i) => ({
      title,
      wage: i === 0 ? slip.bpjsKesWage : slip.bpjsTkWage,
      rows: rows
        .map(([name, ee, er]) => ({ name, employee: amount(ee), employer: amount(er) }))
        .filter((r) => Number(r.employee) || Number(r.employer)),
    })),
    benefits: benefitRows(slip.lines),
    net: slip.net,
    leaveBalances: slip.leaveBalances?.map((b) => ({ name: b.leaveTypeName, remaining: b.remaining })),
    pph21Info: slip.isFinal
      ? `PPh 21 masa pajak terakhir dihitung setahun (tarif Pasal 17) dikurangi PPh 21 yang telah dipotong (termasuk slip sebelumnya di bulan ini). Penghasilan bruto slip ini Rp ${slip.gross}.`
      : slip.run.kind === "correction"
        ? `Slip koreksi: PPh 21 = TER kategori ${slip.terCategory} tarif ${slip.terRate ?? 0}% × bruto gabungan bulan ini (slip asli + koreksi) dikurangi PPh 21 yang sudah dipotong. Bruto slip ini Rp ${slip.gross}.`
        : `PPh 21 metode TER kategori ${slip.terCategory} tarif ${slip.terRate ?? 0}% × penghasilan bruto Rp ${slip.gross} (termasuk premi JKK, JKM, BPJS Kesehatan yang dibayar perusahaan).`,
  };
}

export const payslipFilename = (slip: {
  employee: { employeeNumber: string };
  run: { periodStart: string };
}) =>
  `slip-${slip.employee.employeeNumber}-${slip.run.periodStart.slice(0, 7)}.pdf`.replace(/[^\w.-]+/g, "_");

/** Kata sandi PDF slip via email: tanggal lahir DDMMYYYY (kosong bila tanggal lahir belum diisi). */
export const payslipPassword = (birthDate: string | null) =>
  birthDate ? `${birthDate.slice(8, 10)}${birthDate.slice(5, 7)}${birthDate.slice(0, 4)}` : null;
