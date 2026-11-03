import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, isNull, or, schema, sql, type Db } from "@erp/db";
import {
  contractVars,
  DEFAULT_CONTRACT_TEMPLATES,
  renderContractTemplate,
  tanggalPanjang,
  type ContractDocInput,
} from "@erp/shared";
import { createHash, randomBytes } from "node:crypto";
import { ActivityService } from "../activity/activity.service.js";
import { currentContext } from "../common/request-context.js";
import { CONFIG, type AppConfig } from "../config.js";
import { NotificationService } from "../notifications/notification.service.js";
import { EmployeeService } from "./employee.service.js";
import { renderContractPdf, type ContractPdfSignature } from "./letters-pdf.js";

const C = schema.contracts;
const T = schema.contractTemplates;
const S = schema.contractSignatures;
type Contract = typeof C.$inferSelect;

export type PdfMode = "print" | "esign" | "signed";

/** Kode verifikasi dokumen: 10 karakter tanpa huruf/angka yang mirip (0/O, 1/I). */
function verifyCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...randomBytes(10)].map((b) => alphabet[b % alphabet.length]).join("");
}

/** Gambar tanda tangan dari kanvas: data URL / base64 PNG. */
function pngFrom(image: string) {
  const data = Buffer.from(image.replace(/^data:image\/png;base64,/, ""), "base64");
  if (data.length < 60 || data.subarray(1, 4).toString() !== "PNG")
    throw new BadRequestException("Tanda tangan harus berupa gambar PNG");
  return data;
}

/**
 * Dokumen kontrak kerja dari template: isi dirender dari data karyawan & kontrak (tetap mengikuti data terbaru sampai
 * dibekukan saat diajukan/ditandatangani), PDF cetak/e-sign luar/bertanda tangan, tanda tangan digital di aplikasi,
 * unggah hasil tanda tangan basah/layanan luar, dan kode verifikasi.
 */
@Injectable()
export class ContractDocumentService {
  constructor(
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  // ---- Template ----

  /** Template bawaan PKWT & PKWTT dibuat otomatis untuk perusahaan yang belum punya template. */
  async ensureTemplates(tx: Db, companyId: string) {
    const [any] = await tx.select({ id: T.id }).from(T).where(eq(T.companyId, companyId)).limit(1);
    if (any) return;
    await tx.insert(T).values(
      DEFAULT_CONTRACT_TEMPLATES.map((t) => ({
        ...t,
        companyId,
        isDefault: true,
        signerTitle: "Direktur",
      })),
    );
  }

  async templates(tx: Db) {
    const companyId = currentContext().companyId;
    await this.ensureTemplates(tx, companyId);
    return tx.select().from(T).where(eq(T.companyId, companyId)).orderBy(asc(T.name));
  }

  async template(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(T)
      .where(and(eq(T.id, id), eq(T.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Template kontrak tidak ditemukan");
    return row;
  }

  /** Satu template bawaan per jenis kontrak: menandai bawaan mencabut tanda bawaan template lain di jenis yang sama. */
  async clearOtherDefaults(
    tx: Db,
    companyId: string,
    contractType: "pkwt" | "pkwtt" | null,
    exceptId: string,
  ) {
    await tx
      .update(T)
      .set({ isDefault: false })
      .where(
        and(
          eq(T.companyId, companyId),
          contractType ? eq(T.contractType, contractType) : isNull(T.contractType),
          sql`${T.id} <> ${exceptId}`,
        ),
      );
  }

  /** Template kontrak: yang dipilih, atau bawaan untuk jenis kontrak, atau template umum. */
  private async templateFor(tx: Db, contract: Contract) {
    await this.ensureTemplates(tx, contract.companyId);
    if (contract.templateId) {
      const [row] = await tx.select().from(T).where(eq(T.id, contract.templateId));
      if (row) return row;
    }
    const rows = await tx
      .select()
      .from(T)
      .where(
        and(
          eq(T.companyId, contract.companyId),
          eq(T.active, true),
          or(eq(T.contractType, contract.contractType), isNull(T.contractType)),
        ),
      );
    return (
      rows.find((t) => t.isDefault && t.contractType === contract.contractType) ??
      rows.find((t) => t.contractType === contract.contractType) ??
      rows.find((t) => t.isDefault) ??
      rows[0] ??
      null
    );
  }

  // ---- Isi dokumen ----

  /** Data placeholder dari kontrak, karyawan (NIK didekripsi), struktur organisasi & perusahaan. */
  async docInput(
    tx: Db,
    contract: Contract,
    signer?: { name: string | null; title: string | null; city: string | null },
  ) {
    const employee = this.employees.decrypted(await this.employees.find(tx, contract.employeeId));
    const one = async <V>(q: Promise<V[]>) => (await q)[0];
    const job = employee.jobId
      ? await one(
          tx
            .select({ n: schema.jobPositions.name })
            .from(schema.jobPositions)
            .where(eq(schema.jobPositions.id, employee.jobId)),
        )
      : undefined;
    const dept = employee.departmentId
      ? await one(
          tx
            .select({ n: schema.departments.name })
            .from(schema.departments)
            .where(eq(schema.departments.id, employee.departmentId)),
        )
      : undefined;
    const grade = employee.gradeId
      ? await one(
          tx
            .select({ n: schema.salaryGrades.name })
            .from(schema.salaryGrades)
            .where(eq(schema.salaryGrades.id, employee.gradeId)),
        )
      : undefined;
    const location = employee.workLocationId
      ? await one(
          tx
            .select({ n: schema.workLocations.name })
            .from(schema.workLocations)
            .where(eq(schema.workLocations.id, employee.workLocationId)),
        )
      : undefined;
    const [company] = await tx
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.id, contract.companyId));
    const allowances = await this.components(tx, contract.id, contract.companyId);
    const address = company
      ? [company.street, company.city, company.province, company.postalCode].filter(Boolean).join(", ") ||
        null
      : null;
    const input: ContractDocInput = {
      contract: {
        name: contract.name,
        contractType: contract.contractType,
        dateStart: contract.dateStart,
        dateEnd: contract.dateEnd,
        wage: contract.wage,
        wageType: contract.wageType,
      },
      allowances,
      employee: {
        name: employee.name,
        employeeNumber: employee.employeeNumber,
        nik: (employee as { nik?: string | null }).nik ?? null,
        birthPlace: employee.birthPlace,
        birthDate: employee.birthDate,
        gender: employee.gender,
        address: employee.address,
        job: job?.n ?? null,
        department: dept?.n ?? null,
        grade: grade?.n ?? null,
        workLocation: location?.n ?? null,
      },
      company: {
        name: company?.name ?? "",
        address,
        npwp: company?.npwp ?? null,
        city: company?.city ?? null,
      },
      signer: signer ?? { name: contract.signerName, title: contract.signerTitle, city: contract.signCity },
    };
    return { input, employee, companyAddress: address };
  }

  /**
   * Komponen gaji kontrak untuk dokumen: tunjangan/potongan di kontrak (nilai kosong = nilai bawaan komponen) dan
   * komponen otomatis aktif yang tidak ditimpa kontrak — sama seperti perhitungan payroll.
   */
  async components(tx: Db, contractId: string, companyId: string) {
    const SC = schema.salaryComponents;
    const rows = await tx
      .select({
        componentId: SC.id,
        name: SC.name,
        amount: schema.contractAllowances.amount,
        rate: SC.rate,
        fixed: SC.fixed,
        kind: SC.kind,
        calc: SC.calc,
      })
      .from(schema.contractAllowances)
      .innerJoin(SC, eq(SC.id, schema.contractAllowances.componentId))
      .where(eq(schema.contractAllowances.contractId, contractId))
      .orderBy(asc(SC.code));
    const auto = await tx
      .select({ id: SC.id, name: SC.name, rate: SC.rate, fixed: SC.fixed, kind: SC.kind, calc: SC.calc })
      .from(SC)
      .where(and(eq(SC.companyId, companyId), eq(SC.active, true), eq(SC.autoAssign, true)))
      .orderBy(asc(SC.code));
    return [
      ...rows.map((r) => ({
        name: r.name,
        amount: r.calc !== "fixed_amount" && Number(r.amount) <= 0 ? (r.rate ?? "0") : r.amount,
        fixed: r.fixed,
        kind: r.kind,
        calc: r.calc,
      })),
      ...auto
        .filter((a) => !rows.some((r) => r.componentId === a.id))
        .map((a) => ({ name: a.name, amount: a.rate ?? "0", fixed: a.fixed, kind: a.kind, calc: a.calc })),
    ];
  }

  /** Judul, isi & penandatangan dokumen: isi tersimpan (diedit/dibekukan) atau dirender dari template. */
  async document(tx: Db, contract: Contract) {
    const template = await this.templateFor(tx, contract);
    const signer = {
      name: contract.signerName ?? template?.signerName ?? null,
      title: contract.signerTitle ?? template?.signerTitle ?? null,
      city: contract.signCity ?? template?.city ?? null,
    };
    const { input, employee, companyAddress } = await this.docInput(tx, contract, signer);
    const vars = contractVars(input);
    const title =
      contract.documentTitle ??
      template?.title ??
      (contract.contractType === "pkwt"
        ? "PERJANJIAN KERJA WAKTU TERTENTU"
        : "PERJANJIAN KERJA WAKTU TIDAK TERTENTU");
    const body = contract.body ?? (template ? renderContractTemplate(template.body, vars) : "");
    return {
      template,
      title,
      body,
      signer,
      vars,
      employee,
      company: { name: input.company.name, address: companyAddress },
      city: vars.kota!,
    };
  }

  /** Hash isi dokumen + data inti kontrak (berubah bila isi atau syarat kontrak diubah). */
  hash(contract: Contract, doc: { title: string; body: string }) {
    return createHash("sha256")
      .update(
        JSON.stringify({
          number: contract.name,
          employeeId: contract.employeeId,
          title: doc.title,
          body: doc.body,
          contractType: contract.contractType,
          dateStart: contract.dateStart,
          dateEnd: contract.dateEnd,
          wage: contract.wage,
        }),
      )
      .digest("hex");
  }

  /** Bekukan isi dokumen (disimpan) + hash + kode verifikasi; dipakai saat diajukan/ditandatangani/diunggah. */
  private async freeze(tx: Db, contract: Contract) {
    const doc = await this.document(tx, contract);
    if (!doc.body) throw new BadRequestException("Isi dokumen kontrak kosong; pilih template dulu");
    const documentHash = this.hash(contract, doc);
    const [row] = await tx
      .update(C)
      .set({
        body: doc.body,
        documentTitle: doc.title,
        signerName: doc.signer.name,
        signerTitle: doc.signer.title,
        signCity: doc.signer.city,
        templateId: contract.templateId ?? doc.template?.id ?? null,
        documentHash,
        verifyCode: contract.verifyCode ?? verifyCode(),
        updatedAt: sql`now()`,
      })
      .where(eq(C.id, contract.id))
      .returning();
    return row!;
  }

  /** Berkas kontrak bertanda tangan yang diunggah. */
  async signedFile(tx: Db, contract: Contract) {
    const [row] = contract.signedFileName
      ? await tx
          .select({ data: schema.contractSignedFiles.data })
          .from(schema.contractSignedFiles)
          .where(eq(schema.contractSignedFiles.contractId, contract.id))
      : [];
    if (!row) throw new NotFoundException("Belum ada berkas kontrak bertanda tangan");
    return { name: contract.signedFileName!, type: contract.signedFileType!, content: row.data };
  }

  private async signatures(tx: Db, contractId: string) {
    return tx.select().from(S).where(eq(S.contractId, contractId)).orderBy(asc(S.signedAt));
  }

  /** Dokumen tidak bisa diubah setelah ada tanda tangan / file bertanda tangan. */
  async assertEditable(tx: Db, contract: Contract) {
    const sigs = await this.signatures(tx, contract.id);
    if (sigs.length || contract.signedFileName)
      throw new BadRequestException(
        "Kontrak sudah ditandatangani; batalkan tanda tangan dulu untuk mengubah isi atau syarat kontrak",
      );
  }

  /** Ringkasan dokumen untuk halaman kontrak / portal. */
  async summary(tx: Db, contract: Contract) {
    const doc = await this.document(tx, contract);
    const sigs = await this.signatures(tx, contract.id);
    return {
      contractId: contract.id,
      templateId: contract.templateId ?? doc.template?.id ?? null,
      templateName: doc.template?.name ?? null,
      title: doc.title,
      body: doc.body,
      bodyCustom: contract.bodyCustom,
      signerName: doc.signer.name,
      signerTitle: doc.signer.title,
      city: doc.signer.city,
      signState: contract.signState,
      signMethod: contract.signMethod,
      signRequestedAt: contract.signRequestedAt,
      documentHash: contract.documentHash,
      verifyCode: contract.verifyCode,
      verifyUrl: contract.verifyCode
        ? `${this.config.webOrigin}/verify/contract/${contract.verifyCode}`
        : null,
      signedFile: contract.signedFileName
        ? {
            name: contract.signedFileName,
            type: contract.signedFileType,
            uploadedAt: contract.signedUploadedAt,
          }
        : null,
      signatures: sigs.map((s) => ({
        role: s.role,
        signerName: s.signerName,
        signerTitle: s.signerTitle,
        signedAt: s.signedAt,
        inPerson: s.inPerson,
      })),
      employeeHasAccount: !!doc.employee.userId,
    };
  }

  /** Pilih template / edit isi / atur penandatangan perusahaan (hanya sebelum ditandatangani). */
  async update(
    tx: Db,
    contract: Contract,
    input: {
      templateId?: string | null;
      body?: string | null;
      signerName?: string | null;
      signerTitle?: string | null;
      city?: string | null;
    },
  ) {
    await this.assertEditable(tx, contract);
    if (input.templateId) await this.template(tx, input.templateId);
    const templateChanged = input.templateId !== undefined && input.templateId !== contract.templateId;
    const custom = !!input.body && !templateChanged;
    await tx
      .update(C)
      .set({
        ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
        // Template baru → isi kembali dirender dari template; isi dikirim → isi kustom.
        body: custom ? input.body! : null,
        bodyCustom: custom,
        documentTitle: templateChanged ? null : contract.documentTitle,
        ...(input.signerName !== undefined ? { signerName: input.signerName } : {}),
        ...(input.signerTitle !== undefined ? { signerTitle: input.signerTitle } : {}),
        ...(input.city !== undefined ? { signCity: input.city } : {}),
        documentHash: null,
        updatedAt: sql`now()`,
      })
      .where(eq(C.id, contract.id));
  }

  /** Syarat kontrak berubah sebelum ditandatangani → isi template dirender ulang dari data baru. */
  async refreshAfterContractChange(tx: Db, contract: Contract) {
    if (contract.bodyCustom || !contract.body) return;
    await tx
      .update(C)
      .set({ body: null, documentTitle: null, documentHash: null })
      .where(eq(C.id, contract.id));
  }

  // ---- PDF ----

  async pdf(tx: Db, contract: Contract, mode: PdfMode) {
    const doc = await this.document(tx, contract);
    if (!doc.body) throw new BadRequestException("Isi dokumen kontrak kosong; pilih template dulu");
    const sigs = await this.signatures(tx, contract.id);
    if (mode === "signed" && !sigs.length)
      throw new BadRequestException("Kontrak belum ditandatangani secara digital di aplikasi");
    const toPdf = (s: (typeof sigs)[number] | undefined): ContractPdfSignature | undefined =>
      s && {
        name: s.signerName,
        title: s.signerTitle,
        image: s.image,
        signedAt: s.signedAt,
        inPerson: s.inPerson,
        ip: s.ip,
      };
    const content = await renderContractPdf({
      mode,
      company: doc.company,
      title: doc.title,
      number: contract.name,
      body: doc.body,
      city: doc.city,
      date: tanggalPanjang(contract.dateStart),
      companySigner: { label: "PIHAK PERTAMA", name: doc.signer.name ?? "………………", title: doc.signer.title },
      employeeSigner: { name: doc.employee.name },
      signatures: {
        company: mode === "signed" ? toPdf(sigs.find((s) => s.role === "company")) : undefined,
        employee: mode === "signed" ? toPdf(sigs.find((s) => s.role === "employee")) : undefined,
      },
      verifyCode: contract.verifyCode,
      verifyUrl: contract.verifyCode
        ? `${this.config.webOrigin}/verify/contract/${contract.verifyCode}`
        : null,
      documentHash: contract.documentHash ?? this.hash(contract, doc),
    });
    const suffix = { print: "cetak", esign: "e-sign", signed: "ditandatangani" }[mode];
    return { name: `${contract.name.replace(/[^\w.-]+/g, "_")}-${suffix}.pdf`, content };
  }

  /**
   * Pratinjau PDF template: diisi data karyawan terpilih (kontrak terakhirnya bila ada) atau data contoh, tanpa
   * menyimpan apa pun.
   */
  async previewPdf(
    tx: Db,
    tpl: {
      title: string;
      body: string;
      contractType?: "pkwt" | "pkwtt" | null;
      signerName?: string | null;
      signerTitle?: string | null;
      city?: string | null;
    },
    employeeId?: string | null,
  ) {
    const companyId = currentContext().companyId;
    const signer = { name: tpl.signerName ?? null, title: tpl.signerTitle ?? null, city: tpl.city ?? null };
    let input: ContractDocInput;
    let number = "KTR/CONTOH/0001";
    let date = new Date().toISOString().slice(0, 10);
    if (employeeId) {
      const employee = await this.employees.find(tx, employeeId);
      const [latest] = await tx
        .select()
        .from(C)
        .where(and(eq(C.employeeId, employee.id), sql`${C.state} <> 'cancel'`))
        .orderBy(sql`${C.dateStart} desc`)
        .limit(1);
      const contract: Contract =
        latest ??
        ({
          id: "00000000-0000-0000-0000-000000000000",
          companyId,
          employeeId: employee.id,
          name: number,
          contractType: tpl.contractType ?? "pkwt",
          wageType: "monthly",
          dateStart: employee.joinDate,
          dateEnd: employee.resignDate,
          wage: "0",
        } as Contract);
      input = (await this.docInput(tx, contract, signer)).input;
      number = contract.name;
      date = contract.dateStart;
    } else {
      const [company] = await tx.select().from(schema.companies).where(eq(schema.companies.id, companyId));
      const start = date;
      const end = new Date(Date.UTC(+start.slice(0, 4) + 1, +start.slice(5, 7) - 1, +start.slice(8, 10) - 1))
        .toISOString()
        .slice(0, 10);
      input = {
        contract: {
          name: number,
          contractType: tpl.contractType ?? "pkwt",
          dateStart: start,
          dateEnd: tpl.contractType === "pkwtt" ? null : end,
          wage: "6500000",
          wageType: "monthly",
        },
        allowances: [{ name: "Tunjangan Transport", amount: "500000", fixed: true }],
        employee: {
          name: "Budi Santoso",
          employeeNumber: "EMP/2026/0001",
          nik: "3174000000000001",
          birthPlace: "Jakarta",
          birthDate: "1995-05-17",
          gender: "male",
          address: "Jl. Contoh No. 1, Jakarta Selatan",
          job: "Staf Administrasi",
          department: "Umum",
          grade: null,
          workLocation: "Kantor Pusat",
        },
        company: {
          name: company?.name ?? "",
          address: company
            ? [company.street, company.city, company.province, company.postalCode]
                .filter(Boolean)
                .join(", ") || null
            : null,
          npwp: company?.npwp ?? null,
          city: company?.city ?? null,
        },
        signer,
      };
    }
    const vars = contractVars(input);
    return renderContractPdf({
      mode: "print",
      company: { name: input.company.name, address: input.company.address },
      title: tpl.title,
      number,
      body: renderContractTemplate(tpl.body, vars),
      city: vars.kota!,
      date: tanggalPanjang(date),
      companySigner: { label: "PIHAK PERTAMA", name: signer.name ?? "………………", title: signer.title },
      employeeSigner: { name: input.employee.name },
      signatures: {},
      verifyCode: null,
      verifyUrl: null,
      documentHash: null,
    });
  }

  // ---- Tanda tangan ----

  /** Minta tanda tangan karyawan lewat portal: isi dibekukan & karyawan diberi notifikasi. */
  async requestSignature(tx: Db, contract: Contract) {
    if (contract.signState === "signed") throw new BadRequestException("Kontrak sudah ditandatangani");
    const frozen = await this.freeze(tx, contract);
    await tx
      .update(C)
      .set({
        signState: contract.signState === "unsigned" ? "pending" : contract.signState,
        signRequestedAt: new Date(),
      })
      .where(eq(C.id, contract.id));
    const [employee] = await tx
      .select({ userId: schema.employees.userId })
      .from(schema.employees)
      .where(eq(schema.employees.id, contract.employeeId));
    await this.notifications.notify(tx, [employee?.userId], {
      kind: "contract_sign",
      title: `Kontrak ${frozen.name} menunggu tanda tangan Anda`,
      body: "Baca isi kontrak lalu tanda tangani di portal karyawan.",
      link: "/me",
      companyId: contract.companyId,
    });
    await this.log(tx, contract, `Tanda tangan kontrak ${frozen.name} diminta`);
  }

  async sign(
    tx: Db,
    contract: Contract,
    input: {
      role: "company" | "employee";
      image: string;
      inPerson: boolean;
      signerName: string;
      signerTitle: string | null;
      ip: string | null;
      userAgent: string | null;
    },
  ) {
    if (contract.signedFileName)
      throw new BadRequestException("Kontrak sudah ditandatangani lewat dokumen yang diunggah");
    const existing = await this.signatures(tx, contract.id);
    if (existing.some((s) => s.role === input.role))
      throw new BadRequestException(
        input.role === "company" ? "Pihak perusahaan sudah menandatangani" : "Karyawan sudah menandatangani",
      );
    const frozen = existing.length ? contract : await this.freeze(tx, contract);
    await tx.insert(S).values({
      contractId: contract.id,
      role: input.role,
      signerName: input.signerName,
      signerTitle: input.signerTitle,
      signerUserId: currentContext().userId,
      image: pngFrom(input.image),
      inPerson: input.inPerson,
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      documentHash: frozen.documentHash!,
    });
    const complete = existing.length + 1 >= 2;
    await tx
      .update(C)
      .set({ signState: complete ? "signed" : "partial", signMethod: "digital", updatedAt: sql`now()` })
      .where(eq(C.id, contract.id));
    await this.log(
      tx,
      contract,
      `Kontrak ${contract.name} ditandatangani secara digital oleh ${input.signerName} (${input.role === "company" ? "perusahaan" : "karyawan"}${input.inPerson ? ", di hadapan HR" : ""})`,
    );
  }

  /** Unggah kontrak yang sudah ditandatangani basah (scan) atau lewat layanan e-sign luar. */
  async uploadSigned(
    tx: Db,
    contract: Contract,
    input: { method: "manual" | "external"; name: string; type: string; data: string },
  ) {
    const existing = await this.signatures(tx, contract.id);
    if (existing.length)
      throw new BadRequestException(
        "Kontrak sedang ditandatangani digital di aplikasi; batalkan tanda tangan dulu",
      );
    const file = Buffer.from(input.data, "base64");
    if (file.length > 7 * 1024 * 1024) throw new BadRequestException("Berkas maksimal 7 MB");
    const magic = file.subarray(0, 4).toString("latin1");
    const ok =
      input.type === "application/pdf"
        ? magic === "%PDF"
        : input.type === "image/png"
          ? magic.slice(1) === "PNG"
          : file[0] === 0xff && file[1] === 0xd8;
    if (!ok) throw new BadRequestException("Isi berkas tidak sesuai jenisnya (PDF/JPG/PNG)");
    await this.freeze(tx, contract);
    await tx
      .insert(schema.contractSignedFiles)
      .values({ contractId: contract.id, data: file })
      .onConflictDoUpdate({ target: schema.contractSignedFiles.contractId, set: { data: file } });
    await tx
      .update(C)
      .set({
        signedFileName: input.name,
        signedFileType: input.type,
        signedUploadedAt: new Date(),
        signedUploadedBy: currentContext().userId,
        signState: "signed",
        signMethod: input.method,
        updatedAt: sql`now()`,
      })
      .where(eq(C.id, contract.id));
    await this.log(
      tx,
      contract,
      `Kontrak ${contract.name} bertanda tangan diunggah (${input.method === "manual" ? "tanda tangan basah" : "e-sign layanan luar"})`,
    );
  }

  /** Batalkan tanda tangan (mis. isi kontrak perlu diubah): tanda tangan & file dihapus, isi kembali bisa diubah. */
  async resetSignatures(tx: Db, contract: Contract) {
    await tx.delete(S).where(eq(S.contractId, contract.id));
    await tx.delete(schema.contractSignedFiles).where(eq(schema.contractSignedFiles.contractId, contract.id));
    await tx
      .update(C)
      .set({
        signState: "unsigned",
        signMethod: null,
        signRequestedAt: null,
        signedFileName: null,
        signedFileType: null,
        signedUploadedAt: null,
        signedUploadedBy: null,
        documentHash: null,
        ...(contract.bodyCustom ? {} : { body: null, documentTitle: null }),
        updatedAt: sql`now()`,
      })
      .where(eq(C.id, contract.id));
    await this.log(tx, contract, `Tanda tangan kontrak ${contract.name} dibatalkan`);
  }

  private log(tx: Db, contract: Contract, message: string) {
    return this.activity.log(tx, {
      resModel: "employee",
      resId: contract.employeeId,
      action: "comment",
      message,
    });
  }
}
