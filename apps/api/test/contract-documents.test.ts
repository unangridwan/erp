import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
/** PNG 1×1 sebagai gambar tanda tangan dari kanvas. */
const SIGNATURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const binary = (req: request.Test) =>
  req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  });

/**
 * Dokumen kontrak kerja: template bawaan, kontrak dibuat bersama karyawan baru (langsung berlaku), isi terisi data
 * karyawan, PDF cetak / e-sign luar / bertanda tangan, tanda tangan HR & karyawan (portal), kunci setelah ditandatangani,
 * unggah hasil tanda tangan basah, verifikasi publik.
 */
describe.skipIf(!hasDb)("Template & tanda tangan kontrak", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let nina: Api;
  let other: Api;
  let pkwt: { id: string; name: string };
  let employeeId: string;
  let contractId: string;
  let verifyCode: string;

  const login = async (slug: string, email: string) =>
    client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: slug, email, password: "rahasia123" })
          .expect(200)
      ).body.token,
    );

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "kontrakdoc");
    const me = (await a.get("/auth/me").expect(200)).body;
    const roles = (await a.get("/roles").expect(200)).body as { id: string; code: string }[];
    const userRole = roles.find((r) => r.code === "user")!.id;
    const user = async (name: string, email: string) =>
      (
        await a
          .post("/users", {
            name,
            email,
            password: "rahasia123",
            roleIds: [userRole],
            companyIds: [me.activeCompanyId],
          })
          .expect(201)
      ).body.id as string;
    const ninaUser = await user("Nina Kontrak", "nina@example.com");
    const otherUser = await user("Oki Lain", "oki@example.com");
    await a.post("/employees", { name: "Oki Lain", userId: otherUser, joinDate: "2025-01-01" }).expect(201);
    const job = (await a.post("/job-positions", { name: "Staf Gudang" }).expect(201)).body.id;
    const templates = (await a.get("/contract-templates").expect(200)).body.items;
    pkwt = templates.find((t: { contractType: string }) => t.contractType === "pkwt");
    const created = await a
      .post("/employees", {
        name: "Nina Kontrak",
        userId: ninaUser,
        jobId: job,
        joinDate: "2026-11-16",
        nik: "3273015506950002",
        birthPlace: "Bandung",
        birthDate: "1995-06-15",
        gender: "female",
        address: "Jl. Merdeka No. 5, Bandung",
        contract: { templateId: pkwt.id, contractType: "pkwt", dateEnd: "2027-11-15", wage: 6500000 },
      })
      .expect(201);
    employeeId = created.body.id;
    contractId = created.body.contractId;
    nina = await login(a.slug, "nina@example.com");
    other = await login(a.slug, "oki@example.com");
  });
  afterAll(() => app?.close());

  it("template bawaan PKWT & PKWTT dibuat otomatis, beserta daftar placeholder", async () => {
    const t = (await a.get("/contract-templates").expect(200)).body.items;
    expect(t.map((x: { name: string }) => x.name).sort()).toEqual(["PKWT standar", "PKWTT standar"]);
    const keys = (await a.get("/contract-templates/placeholders").expect(200)).body.map(
      (p: { key: string }) => p.key,
    );
    expect(keys).toEqual(expect.arrayContaining(["nama", "nik", "gaji_terbilang", "tanggal_mulai"]));
  });

  it("karyawan baru + kontrak: kontrak langsung berlaku mulai tanggal masuk", async () => {
    const c = (await a.get(`/contracts/${contractId}`).expect(200)).body;
    expect(c).toMatchObject({
      employeeId,
      state: "running",
      contractType: "pkwt",
      dateStart: "2026-11-16",
      dateEnd: "2027-11-15",
      templateId: pkwt.id,
    });
    expect(c.signedFile).toBeUndefined();
    expect((await a.get(`/employees/${employeeId}`).expect(200)).body.active).toBe(true);
  });

  it("kontrak tidak valid membatalkan pembuatan karyawan", async () => {
    const before = (await a.get("/employees?limit=100").expect(200)).body.total;
    const res = await a
      .post("/employees", {
        name: "Gagal Kontrak",
        joinDate: "2026-12-01",
        contract: { contractType: "pkwt", wage: 5000000 },
      })
      .expect(400);
    expect(res.body.errors?.[0]?.path).toBe("contract.dateEnd");
    expect((await a.get("/employees?limit=100").expect(200)).body.total).toBe(before);
  });

  it("isi dokumen terisi dari data karyawan & kontrak", async () => {
    const doc = (await a.get(`/contracts/${contractId}/document`).expect(200)).body;
    expect(doc).toMatchObject({
      templateName: "PKWT standar",
      title: "PERJANJIAN KERJA WAKTU TERTENTU",
      signState: "unsigned",
      employeeHasAccount: true,
    });
    expect(doc.body).toContain("Nina Kontrak");
    expect(doc.body).toContain("3273015506950002");
    expect(doc.body).toContain("Staf Gudang");
    expect(doc.body).toContain("enam juta lima ratus ribu rupiah");
    expect(doc.body).toContain("16 November 2026");
    expect(doc.body).not.toMatch(/\{[a-z_]+\}/);
  });

  it("PDF cetak & e-sign luar; PDF bertanda tangan butuh tanda tangan", async () => {
    const print = await binary(a.get(`/contracts/${contractId}/pdf?mode=print`)).expect(200);
    expect(print.headers["content-type"]).toContain("application/pdf");
    expect((print.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    // Kaki halaman tidak boleh menambah halaman kosong.
    const pages = (pdf: Buffer) => pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g)?.length ?? 0;
    expect(pages(print.body as Buffer)).toBeLessThanOrEqual(3);
    const esign = (await binary(a.get(`/contracts/${contractId}/pdf?mode=esign`)).expect(200)).body as Buffer;
    expect(esign.toString("latin1")).toContain("/FT /Sig");
    expect(esign.toString("latin1")).toContain("TTD_Karyawan");
    await a.get(`/contracts/${contractId}/pdf?mode=signed`).expect(400);
  });

  it("penandatangan perusahaan diatur; minta tanda tangan → karyawan diberi notifikasi", async () => {
    const doc = (
      await a
        .put(`/contracts/${contractId}/document`, {
          signerName: "Siti Rahma",
          signerTitle: "Direktur",
          city: "Bandung",
        })
        .expect(200)
    ).body;
    expect(doc).toMatchObject({ signerName: "Siti Rahma", signerTitle: "Direktur", city: "Bandung" });
    const pending = (await a.post(`/contracts/${contractId}/request-signature`).expect(200)).body;
    expect(pending.signState).toBe("pending");
    expect(pending.verifyCode).toMatch(/^[A-Z0-9]{10}$/);
    verifyCode = pending.verifyCode;
    const notes = (await nina.get("/me/notifications").expect(200)).body;
    expect(JSON.stringify(notes)).toContain("menunggu tanda tangan");
  });

  it("karyawan menandatangani di portal; karyawan lain tidak bisa", async () => {
    const mine = (await nina.get("/me/contracts").expect(200)).body;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: contractId, signState: "pending", canSign: true });
    expect((await nina.get(`/me/contracts/${contractId}`).expect(200)).body.body).toContain("Nina Kontrak");
    await binary(nina.get(`/me/contracts/${contractId}/pdf`)).expect(200);
    await other.post(`/me/contracts/${contractId}/sign`, { image: SIGNATURE, agree: true }).expect(404);
    await nina.post(`/me/contracts/${contractId}/sign`, { image: SIGNATURE }).expect(400);
    await nina.post(`/me/contracts/${contractId}/sign`, { image: SIGNATURE, agree: true }).expect(200);
    await nina.post(`/me/contracts/${contractId}/sign`, { image: SIGNATURE, agree: true }).expect(400);
    expect((await a.get(`/contracts/${contractId}/document`).expect(200)).body.signState).toBe("partial");
  });

  it("HR menandatangani pihak perusahaan → kontrak bertanda tangan, syarat kontrak terkunci", async () => {
    const signed = (
      await a
        .post(`/contracts/${contractId}/sign`, { role: "company", image: SIGNATURE, agree: true })
        .expect(200)
    ).body;
    expect(signed).toMatchObject({ signState: "signed", signMethod: "digital", verifyCode });
    expect(signed.signatures.map((s: { role: string }) => s.role).sort()).toEqual(["company", "employee"]);
    const pdf = (await binary(a.get(`/contracts/${contractId}/pdf?mode=signed`)).expect(200)).body as Buffer;
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    // Isi kontrak + halaman jejak audit, tanpa halaman kosong.
    expect(pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g)?.length ?? 0).toBeLessThanOrEqual(4);
    const c = (await a.get(`/contracts/${contractId}`).expect(200)).body;
    await a
      .put(`/contracts/${contractId}`, {
        employeeId,
        contractType: "pkwt",
        dateStart: c.dateStart,
        dateEnd: c.dateEnd,
        wage: "7000000",
      })
      .expect(400);
    await a.put(`/contracts/${contractId}/document`, { body: "Isi baru" }).expect(400);
  });

  it("verifikasi publik tanpa login: data inti saja, nama disamarkan", async () => {
    const res = await request(app.getHttpServer())
      .get(`/public/contracts/verify/${verifyCode.toLowerCase()}`)
      .expect(200);
    expect(res.body).toMatchObject({ employee: "Nina K.", signState: "signed", dateStart: "2026-11-16" });
    expect(res.body.signatures.every((s: { intact: boolean }) => s.intact)).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/6500000|3273015506950002|wage/);
    await request(app.getHttpServer()).get("/public/contracts/verify/ZZZZZZZZZZ").expect(404);
  });

  it("batalkan tanda tangan → syarat bisa diubah & isi mengikuti data baru; unggah hasil tanda tangan basah", async () => {
    const reset = (await a.delete(`/contracts/${contractId}/signatures`).expect(200)).body;
    expect(reset).toMatchObject({ signState: "unsigned", signatures: [] });
    const c = (await a.get(`/contracts/${contractId}`).expect(200)).body;
    await a
      .put(`/contracts/${contractId}`, {
        employeeId,
        contractType: "pkwt",
        dateStart: c.dateStart,
        dateEnd: c.dateEnd,
        wage: "7000000",
      })
      .expect(200);
    expect((await a.get(`/contracts/${contractId}/document`).expect(200)).body.body).toContain(
      "tujuh juta rupiah",
    );
    await a
      .post(`/contracts/${contractId}/signed-file`, {
        method: "manual",
        name: "kontrak.pdf",
        type: "application/pdf",
        data: Buffer.from("bukan pdf").toString("base64"),
      })
      .expect(400);
    const scan = Buffer.from("%PDF-1.4\n% scan kontrak bertanda tangan basah\n%%EOF\n");
    const up = (
      await a
        .post(`/contracts/${contractId}/signed-file`, {
          method: "manual",
          name: "kontrak-ttd.pdf",
          type: "application/pdf",
          data: scan.toString("base64"),
        })
        .expect(200)
    ).body;
    expect(up).toMatchObject({
      signState: "signed",
      signMethod: "manual",
      signedFile: { name: "kontrak-ttd.pdf" },
    });
    const file = (await binary(a.get(`/contracts/${contractId}/signed-file`)).expect(200)).body as Buffer;
    expect(file.equals(scan)).toBe(true);
    await binary(nina.get(`/me/contracts/${contractId}/signed-file`)).expect(200);
    await a
      .post(`/contracts/${contractId}/sign`, { role: "company", image: SIGNATURE, agree: true })
      .expect(400);
  });

  it("CRUD template: satu bawaan per jenis, template terpakai tidak bisa dihapus, pratinjau PDF", async () => {
    const created = (
      await a
        .post("/contract-templates", {
          name: "PKWT gudang",
          contractType: "pkwt",
          title: "PERJANJIAN KERJA GUDANG",
          body: "Pasal 1\n\n{nama} bekerja sebagai {jabatan} dengan upah {gaji}.",
          isDefault: true,
        })
        .expect(201)
    ).body;
    const list = (await a.get("/contract-templates").expect(200)).body.items as {
      id: string;
      isDefault: boolean;
      contracts: number;
    }[];
    expect(list.find((t) => t.id === pkwt.id)).toMatchObject({ isDefault: false, contracts: 1 });
    await a.delete(`/contract-templates/${pkwt.id}`).expect(400);
    const preview = await binary(
      a.post("/contract-templates/preview", { title: created.title, body: created.body, employeeId }),
    ).expect(200);
    expect((preview.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    await binary(a.post("/contract-templates/preview", { title: "X", body: "{nama}" })).expect(200);
    await a.delete(`/contract-templates/${created.id}`).expect(204);
    await nina.post("/contract-templates", { name: "X", title: "X", body: "X" }).expect(403);
  });
});
