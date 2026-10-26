import type { INestApplication } from "@nestjs/common";
import { eq, schema } from "@erp/db";
import type request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { createApp, hasDb, signup } from "./helpers.js";

const binary = (req: request.Test) =>
  req.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on("data", (c: Buffer) => chunks.push(c));
    r.on("end", () => cb(null, Buffer.concat(chunks)));
  });
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** FPK → lowongan, alasan tolak, penawaran kerja, laporan rekrutmen, offboarding, exit interview, Full & Final. */
describe.skipIf(!hasDb)("Rekrutmen hulu & offboarding", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let tenantId: string;
  const cat: Record<string, string> = {};
  let opening: string;
  let applicant: string;
  let reasons: { id: string; name: string }[];

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "rof");
    tenantId = (await a.get("/auth/me")).body.tenantId;
    for (const c of (await a.get("/approval-categories?active=1").expect(200)).body) cat[c.code] = c.id;
    reasons = (await a.get("/refuse-reasons").expect(200)).body;
  });
  afterAll(() => app?.close());

  const approve = (id: string) =>
    app
      .get(TenantDb)
      .runAs(tenantId, (tx) =>
        tx
          .update(schema.approvalRequests)
          .set({ state: "approved" })
          .where(eq(schema.approvalRequests.id, id)),
      );

  it("FPK yang disetujui menjadi lowongan (sekali); bukan FPK / belum disetujui ditolak", async () => {
    const dept = (await a.post("/departments", { name: "Toko" }).expect(201)).body.id;
    const fpk = (
      await a
        .post("/approval-requests", {
          categoryId: cat.FPK,
          subject: "Kasir toko cabang Bogor",
          quantity: "2",
          date: "2026-12-01",
          description: "Pembukaan cabang baru",
        })
        .expect(201)
    ).body;
    await a.post(`/job-openings/from-fpk/${fpk.id}`).expect(400); // belum disetujui
    const other = (await a.post("/approval-requests", { categoryId: cat.UMUM, subject: "Lain" }).expect(201))
      .body;
    await approve(other.id);
    await a.post(`/job-openings/from-fpk/${other.id}`).expect(400);
    await approve(fpk.id);
    const job = (await a.post(`/job-openings/from-fpk/${fpk.id}`).expect(201)).body;
    expect(job).toMatchObject({ name: "Kasir toko cabang Bogor", quota: 2, approvalRequestId: fpk.id });
    expect(job.targetDate).toBe("2026-12-01");
    await a.post(`/job-openings/from-fpk/${fpk.id}`).expect(400);
    opening = job.id;
    await a
      .patch(`/job-openings/${opening}`, { departmentId: dept, wageMin: "5000000", wageMax: "6000000" })
      .expect(200);
    const links = (await a.get("/job-openings-fpk").expect(200)).body;
    expect(links).toEqual([expect.objectContaining({ openingId: opening, requestId: fpk.id })]);
  });

  it("menolak pelamar wajib memilih alasan dari master; tahap terakhir dicatat", async () => {
    const rudi = (
      await a.post("/applicants", { openingId: opening, name: "Rudi", source: "walkin" }).expect(201)
    ).body.id;
    await a.post(`/applicants/${rudi}/stage`, { stage: "interview" }).expect(200);
    await a.post(`/applicants/${rudi}/stage`, { stage: "refused", refuseReason: "x" }).expect(400);
    const reason = reasons.find((r) => r.name === "Tidak lolos wawancara")!.id;
    const refused = (
      await a.post(`/applicants/${rudi}/stage`, { stage: "refused", refuseReasonId: reason }).expect(200)
    ).body;
    expect(refused).toMatchObject({ stage: "refused", refuseReasonId: reason, refusedStage: "interview" });
    // Alasan yang sudah dipakai hanya dinonaktifkan.
    await a.delete(`/refuse-reasons/${reason}`).expect(204);
    expect(
      (await a.get("/refuse-reasons").expect(200)).body.find((r: { id: string }) => r.id === reason),
    ).toMatchObject({
      active: false,
    });
  });

  it("penawaran kerja dari template → kirim → diterima → hire memakai nilai penawaran", async () => {
    applicant = (
      await a.post("/applicants", { openingId: opening, name: "Sinta Dewi", source: "referral" }).expect(201)
    ).body.id;
    const templates = (await a.get("/offer-templates").expect(200)).body;
    expect(templates).toHaveLength(1);
    await a
      .post(`/applicants/${applicant}/offers`, {
        templateId: templates[0].id,
        wage: "5500000",
        contractType: "pkwt",
        startDate: inDays(10),
        validUntil: inDays(5),
      })
      .expect(400); // PKWT tanpa tanggal berakhir
    const offer = (
      await a
        .post(`/applicants/${applicant}/offers`, {
          templateId: templates[0].id,
          wage: "5500000",
          benefits: "Uang makan Rp 25.000/hari",
          contractType: "pkwt",
          contractEnd: inDays(375),
          startDate: inDays(10),
          validUntil: inDays(5),
        })
        .expect(201)
    ).body;
    expect(offer.number).toMatch(/^OFR/);
    expect(offer.body).toContain("Sinta Dewi");
    expect(offer.body).toContain("Rp 5.500.000");
    expect(offer.body).toContain("Uang makan");
    expect(offer.body).not.toMatch(/\{[a-z_]+\}/);
    expect((await a.get(`/applicants/${applicant}`).expect(200)).body.stage).toBe("offer");
    // Satu penawaran aktif per pelamar.
    await a
      .post(`/applicants/${applicant}/offers`, {
        body: "x",
        wage: "1",
        startDate: inDays(1),
        validUntil: inDays(1),
      })
      .expect(400);
    await a.post(`/job-offers/${offer.id}/accept`).expect(400); // belum dikirim
    await a.post(`/job-offers/${offer.id}/send`).expect(200);
    const pdf = await binary(a.get(`/job-offers/${offer.id}/pdf`)).expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    expect(
      (await a.post(`/job-offers/${offer.id}/accept`, { note: "Siap bergabung" }).expect(200)).body,
    ).toMatchObject({
      state: "accepted",
      responseNote: "Siap bergabung",
    });

    const hired = (await a.post(`/applicants/${applicant}/hire`, {}).expect(200)).body;
    const contract = (await a.get(`/contracts/${hired.contractId}`).expect(200)).body;
    expect(contract).toMatchObject({
      wage: "5500000.00",
      contractType: "pkwt",
      dateStart: inDays(10),
      dateEnd: inDays(375),
    });
    expect((await a.get(`/applicants/${applicant}`).expect(200)).body.hiredAt).toBeTruthy();
  });

  it("penawaran ditolak pelamar → pelamar ditolak; penawaran lewat masa berlaku kedaluwarsa", async () => {
    const budi = (
      await a.post("/applicants", { openingId: opening, name: "Budi", source: "jobportal" }).expect(201)
    ).body.id;
    const offer = (
      await a
        .post(`/applicants/${budi}/offers`, {
          body: "Penawaran Budi",
          wage: "5000000",
          startDate: inDays(20),
          validUntil: inDays(3),
        })
        .expect(201)
    ).body;
    await a.post(`/job-offers/${offer.id}/send`).expect(200);
    await a.post(`/job-offers/${offer.id}/decline`, { note: "Gaji kurang" }).expect(200);
    expect((await a.get(`/applicants/${budi}`).expect(200)).body).toMatchObject({
      stage: "refused",
      refusedStage: "offer",
      refuseReasonId: reasons.find((r) => r.name === "Menolak penawaran")!.id,
    });

    const eka = (await a.post("/applicants", { openingId: opening, name: "Eka" }).expect(201)).body.id;
    const late = (
      await a
        .post(`/applicants/${eka}/offers`, {
          body: "Penawaran Eka",
          wage: "5000000",
          startDate: inDays(20),
          validUntil: inDays(2),
        })
        .expect(201)
    ).body;
    await app.get(TenantDb).runAs(tenantId, (tx) =>
      tx
        .update(schema.jobOffers)
        .set({ validUntil: inDays(-1) })
        .where(eq(schema.jobOffers.id, late.id)),
    );
    expect((await a.get(`/applicants/${eka}/offers`).expect(200)).body[0].state).toBe("expired");
    await a.post(`/job-offers/${late.id}/send`).expect(400);
  });

  it("laporan rekrutmen: time-to-hire, funnel, sumber, alasan tolak", async () => {
    const r = (await a.get("/recruitment/reports").expect(200)).body;
    const job = r.openings.find((o: { id: string }) => o.id === opening);
    expect(job).toMatchObject({ quota: 2, hired: 1, filled: false, applicants: 4 });
    expect(r.avgTimeToHire).toBe(0);
    expect(
      Object.fromEntries(r.funnel.map((f: { stage: string; count: number }) => [f.stage, f.count])),
    ).toMatchObject({
      new: 4,
      interview: 4,
      offer: 3,
      hired: 1,
    });
    expect(r.refuseReasons.map((x: { key: string }) => x.key)).toEqual(
      expect.arrayContaining(["Tidak lolos wawancara", "Menolak penawaran"]),
    );
  });

  it("offboarding: tanggal & alasan keluar, checklist, exit interview, Full & Final Statement", async () => {
    const emp = (await a.post("/employees", { name: "Hadi Pratama", joinDate: "2023-01-02" }).expect(201))
      .body.id;
    const c = (
      await a.post("/contracts", { employeeId: emp, wage: "8000000", dateStart: "2023-01-02" }).expect(201)
    ).body;
    await a.post(`/contracts/${c.id}/start`).expect(200);
    const bank = (await a.get("/journals").expect(200)).body.items.find(
      (j: { code: string }) => j.code === "BNK1",
    ).id;
    const loan = (
      await a
        .post("/employee-loans", {
          employeeId: emp,
          name: "Kasbon",
          principal: "2000000",
          installment: "500000",
          startPeriod: "2027-01",
        })
        .expect(201)
    ).body;
    await a.post(`/employee-loans/${loan.id}/disburse`, { journalId: bank, date: "2026-10-01" }).expect(200);
    await a.post("/payroll-runs", { period: "2026-10", paymentDate: "2026-10-28" }).expect(201);

    await a
      .post(`/employees/${emp}/offboard`, { resignDate: "2022-01-01", resignReason: "resign" })
      .expect(400);
    const off = (
      await a
        .post(`/employees/${emp}/offboard`, {
          resignDate: "2026-10-31",
          resignReason: "resign",
          resignNote: "Pindah kota",
        })
        .expect(200)
    ).body;
    expect(off.checklistId).toBeTruthy();
    expect((await a.get(`/employees/${emp}`).expect(200)).body).toMatchObject({
      resignDate: "2026-10-31",
      resignReason: "resign",
      resignNote: "Pindah kota",
    });

    expect((await a.get(`/employees/${emp}/exit-interview`).expect(200)).body).toEqual({});
    await a.put(`/employees/${emp}/exit-interview`, { date: "2026-10-30", mainReason: "x" }).expect(400);
    const ei = (
      await a
        .put(`/employees/${emp}/exit-interview`, {
          date: "2026-10-30",
          mainReason: "relocation",
          scores: { compensation: 4, manager: 5 },
          wouldRejoin: true,
          wouldRecommend: true,
          comment: "Ikut pasangan pindah",
        })
        .expect(200)
    ).body;
    expect(ei).toMatchObject({ mainReason: "relocation", scores: { compensation: 4, manager: 5 } });
    // Simpan ulang memperbarui (satu exit interview per karyawan).
    await a
      .put(`/employees/${emp}/exit-interview`, {
        date: "2026-10-30",
        mainReason: "relocation",
        scores: { workload: 3 },
      })
      .expect(200);

    const s = (await a.get(`/employees/${emp}/final-settlement`).expect(200)).body;
    expect(s.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "salary",
          direction: "pay",
          label: expect.stringContaining("belum diposting"),
        }),
        expect.objectContaining({ kind: "loan", direction: "deduct", amount: "2000000" }),
      ]),
    );
    const salary = s.items.find((i: { kind: string }) => i.kind === "salary");
    expect(Number(s.net)).toBe(Number(salary.amount) - 2_000_000);
    expect(s.openTasks.length).toBeGreaterThan(0);
    const pdf = await binary(a.get(`/employees/${emp}/final-settlement/pdf`)).expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");

    const report = (await a.get("/hr/reports/exit-reasons?from=2026-01-01&to=2026-12-31").expect(200)).body;
    expect(report).toMatchObject({ leavers: 1, reasons: [{ key: "resign", count: 1 }] });
    expect(report.interviews).toMatchObject({ count: 1, reasons: [{ key: "relocation", count: 1 }] });
  });
});
