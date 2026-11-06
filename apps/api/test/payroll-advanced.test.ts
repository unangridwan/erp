import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Mailer } from "../src/common/mailer.js";
import { createApp, hasDb, signup } from "./helpers.js";

interface Input {
  code: string;
  amount: string;
  source: string;
  description: string | null;
  detail: { lines?: { period: string; diff: string }[] } | null;
}

describe.skipIf(!hasDb)("Payroll lanjutan: skala upah, THR, rapel, transfer bank, BPJS, email slip", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  const comp: Record<string, string> = {};
  let dept: string;
  let job: string;
  let andi: string;
  let budi: string;
  let andiContract: string;
  let marchRun: string;

  const contract = async (employeeId: string, wage: string, dateStart: string, allowances: object[] = []) => {
    const c = (await a.post("/contracts", { employeeId, wage, dateStart, allowances }).expect(201)).body;
    await a.post(`/contracts/${c.id}/start`).expect(200);
    return c.id as string;
  };
  const run = async (period: string, post = true) => {
    const r = (await a.post("/payroll-runs", { period, paymentDate: `${period}-25` }).expect(201)).body;
    if (post) await a.post(`/payroll-runs/${r.id}/post`).expect(200);
    return r;
  };
  const slipOf = (r: { payslips: { id: string; employeeId: string }[] }, employeeId: string) =>
    r.payslips.find((p) => p.employeeId === employeeId)!.id;
  const inputs = async (slipId: string) =>
    ((await a.get(`/payslips/${slipId}`).expect(200)).body.inputs as Input[]).sort((x, y) =>
      x.code.localeCompare(y.code),
    );

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "payadv");
    for (const c of (await a.get("/salary-components").expect(200)).body.items) comp[c.code] = c.id;
  });
  afterAll(() => app?.close());

  it("pengaturan bawaan memakai komponen THR & RAPEL", async () => {
    const s = (await a.get("/payroll/settings").expect(200)).body;
    expect(s).toMatchObject({
      thrComponentId: comp.THR,
      retroComponentId: comp.RAPEL,
      transferSourceAccount: null,
    });
  });

  it("struktur & skala upah: golongan di jabatan, peringatan kontrak, laporan", async () => {
    await a
      .post("/salary-grades", {
        code: "g2",
        name: "Golongan II",
        baseWage: "5500000",
        minWage: "6000000",
        maxWage: "5000000",
      })
      .expect(400);
    const grade = (
      await a
        .post("/salary-grades", {
          code: "g2",
          name: "Golongan II",
          baseWage: "6000000",
          minWage: "5000000",
          maxWage: "8000000",
          sequence: 2,
        })
        .expect(201)
    ).body;
    expect(grade.code).toBe("G2");
    await a.patch(`/salary-grades/${grade.id}`, { maxWage: "4000000" }).expect(400);
    job = (await a.post("/job-positions", { name: "Staf Keuangan", gradeId: grade.id }).expect(201)).body.id;
    dept = (await a.post("/departments", { name: "Keuangan" }).expect(201)).body.id;

    andi = (
      await a
        .post("/employees", {
          name: "Andi Saputra",
          departmentId: dept,
          jobId: job,
          joinDate: "2025-06-01",
          birthDate: "1990-05-17",
          workEmail: "andi@example.com",
          bankName: "Bank Central Asia",
          bankAccount: "111-222-3333",
        })
        .expect(201)
    ).body.id;
    budi = (
      await a
        .post("/employees", {
          name: "Budi Hartono",
          departmentId: dept,
          jobId: job,
          joinDate: "2026-01-05",
          bankName: "Mandiri",
          bankAccount: "1300099998888",
        })
        .expect(201)
    ).body.id;
    andiContract = await contract(andi, "6000000", "2025-06-01", [
      { componentId: comp.TJAB, amount: "1000000" },
    ]);
    const budiContract = await contract(budi, "4000000", "2026-01-05");
    expect((await a.get(`/contracts/${andiContract}`).expect(200)).body.grade).toMatchObject({
      code: "G2",
      position: "within",
    });
    expect((await a.get(`/contracts/${budiContract}`).expect(200)).body.grade.position).toBe("below");

    const report = (await a.get("/hr/wage-scale").expect(200)).body;
    expect(report.grades).toEqual([
      expect.objectContaining({
        code: "G2",
        employees: 2,
        lowest: "4000000",
        highest: "6000000",
        outOfRange: 1,
      }),
    ]);
  });

  it("rapel kenaikan upah berlaku mundur dari payroll terposting", async () => {
    await run("2026-01");
    await run("2026-02");
    // Kenaikan upah berlaku 1 Februari, baru diinput setelah payroll Februari diposting.
    await a.post(`/contracts/${andiContract}/close`, { dateEnd: "2026-01-31" }).expect(200);
    await contract(andi, "7000000", "2026-02-01", [{ componentId: comp.TJAB, amount: "1000000" }]);

    const march = await run("2026-03", false);
    marchRun = march.id;
    const retro = (await a.post(`/payroll-runs/${march.id}/retro`).expect(200)).body;
    expect(retro).toMatchObject({ total: "1000000" });
    expect(retro.items).toEqual([
      expect.objectContaining({
        employeeId: andi,
        lines: [
          expect.objectContaining({ period: "2026-02", paid: "7000000", due: "8000000", diff: "1000000" }),
        ],
      }),
    ]);
    // Idempoten; input manual tidak menghapus input rapel.
    await a.post(`/payroll-runs/${march.id}/retro`).expect(200);
    const slip = slipOf(march, andi);
    await a
      .put(`/payslips/${slip}/inputs`, { inputs: [{ componentId: comp.BONUS, amount: "500000" }] })
      .expect(200);
    expect((await inputs(slip)).map((i) => [i.code, i.amount, i.source])).toEqual([
      ["BONUS", "500000.00", "manual"],
      ["RAPEL", "1000000.00", "retro"],
    ]);
    const lines = (await a.get(`/payslips/${slip}`).expect(200)).body.lines;
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "RAPEL",
          amount: "1000000.00",
          name: "Rapel kenaikan upah — 2026-02",
          category: "allowance",
        }),
      ]),
    );
  });

  it("THR otomatis: penuh/prorata masa kerja, masuk slip & PPh 21", async () => {
    await a.post(`/payroll-runs/${marchRun}/thr`, { holidayDate: "bukan" }).expect(400);
    const thr = (
      await a
        .post(`/payroll-runs/${marchRun}/thr`, { holidayDate: "2026-03-20", holiday: "Idul Fitri 1447 H" })
        .expect(200)
    ).body;
    const by = (id: string) => thr.items.find((i: { employeeId: string }) => i.employeeId === id);
    // Andi: 9 bulan × (7 jt + 1 jt)/12; Budi: 2 bulan × 4 jt/12.
    expect(by(andi)).toMatchObject({ serviceMonths: 9, basis: "prorata", amount: "6000000" });
    expect(by(budi)).toMatchObject({ serviceMonths: 2, amount: "666667" });
    expect(thr.total).toBe("6666667");

    const run = (await a.get(`/payroll-runs/${marchRun}`).expect(200)).body;
    const slip = slipOf(run, andi);
    const thrInput = (await inputs(slip)).find((i) => i.source === "thr")!;
    expect(thrInput).toMatchObject({
      code: "THR",
      amount: "6000000.00",
      description: "Idul Fitri 1447 H — masa kerja 9 bulan",
    });
    // Bruto 8 jt + bonus 0,5 jt + rapel 1 jt + THR 6 jt (+ premi BPJS perusahaan) → PPh 21 TER lebih besar.
    const andiSlip = run.payslips.find((p: { employeeId: string }) => p.employeeId === andi);
    expect(Number(andiSlip.gross)).toBeGreaterThan(15_500_000);
    expect(andiSlip.bpjsWage).toBe("8000000.00");
    await a.post(`/payroll-runs/${marchRun}/post`).expect(200);
    await a.post(`/payroll-runs/${marchRun}/thr`, { holidayDate: "2026-03-20" }).expect(400);

    // Rapel tidak dibayar dua kali pada payroll berikutnya.
    const april = await run_("2026-04");
    expect((await a.post(`/payroll-runs/${april}/retro`).expect(200)).body).toMatchObject({
      total: "0",
      items: [],
    });
  });
  const run_ = async (period: string) => (await run(period, false)).id as string;

  it("file transfer gaji per bank dan ringkasannya", async () => {
    await a.get(`/payroll-runs/${marchRun}/bank-transfer?format=bca`).expect(400); // rekening sumber belum diatur
    await a.get(`/payroll-runs/${marchRun}/bank-transfer?format=btn`).expect(400);
    const s = (await a.get("/payroll/settings").expect(200)).body;
    await a
      .put("/payroll/settings", {
        jkkRate: s.jkkRate,
        kesWageCap: s.kesWageCap,
        jpWageCap: s.jpWageCap,
        salaryExpenseAccountId: s.salaryExpenseAccountId,
        bpjsKesExpenseAccountId: s.bpjsKesExpenseAccountId,
        bpjsTkExpenseAccountId: s.bpjsTkExpenseAccountId,
        salaryPayableAccountId: s.salaryPayableAccountId,
        pph21PayableAccountId: s.pph21PayableAccountId,
        bpjsKesPayableAccountId: s.bpjsKesPayableAccountId,
        bpjsTkPayableAccountId: s.bpjsTkPayableAccountId,
        journalId: s.journalId,
        thrComponentId: comp.PINJ, // potongan, bukan tunjangan
      })
      .expect(400);
    await a
      .put("/payroll/settings", {
        jkkRate: s.jkkRate,
        kesWageCap: s.kesWageCap,
        jpWageCap: s.jpWageCap,
        salaryExpenseAccountId: s.salaryExpenseAccountId,
        bpjsKesExpenseAccountId: s.bpjsKesExpenseAccountId,
        bpjsTkExpenseAccountId: s.bpjsTkExpenseAccountId,
        salaryPayableAccountId: s.salaryPayableAccountId,
        pph21PayableAccountId: s.pph21PayableAccountId,
        bpjsKesPayableAccountId: s.bpjsKesPayableAccountId,
        bpjsTkPayableAccountId: s.bpjsTkPayableAccountId,
        journalId: s.journalId,
        transferSourceAccount: "777-000-1234",
        transferCompanyCode: "PTUJI",
      })
      .expect(200);

    const json = (await a.get(`/payroll-runs/${marchRun}/bank-transfer`).expect(200)).body;
    expect(json.map((r: { name: string; bank: string }) => [r.name, r.bank])).toEqual([
      ["Andi Saputra", "bca"],
      ["Budi Hartono", "mandiri"],
    ]);
    const bca = await a.get(`/payroll-runs/${marchRun}/bank-transfer?format=bca`).expect(200);
    expect(bca.headers["content-disposition"]).toContain("transfer-gaji-bca-2026-03.txt");
    expect(bca.headers["x-transfer-count"]).toBe("1");
    expect(bca.headers["x-transfer-skipped"]).toBe("1");
    const [header, detail] = bca.text.split("\r\n");
    expect(header).toMatch(/^H,PTUJI,7770001234,20260325,1,\d+,GAJI 2026 03$/);
    expect(detail).toMatch(/^D,1,1112223333,\d+,ANDI SAPUTRA,EMP\/2025\/0001$/);
    const mandiri = await a.get(`/payroll-runs/${marchRun}/bank-transfer?format=mandiri`).expect(200);
    expect(mandiri.text).toContain("1300099998888,BUDI HARTONO,IDR,");

    const summary = (await a.get(`/payroll-runs/${marchRun}/bank-transfer/summary`).expect(200)).body;
    expect(
      summary.banks.filter((b: { count: number }) => b.count).map((b: { bank: string }) => b.bank),
    ).toEqual(["bca", "mandiri"]);
    expect(summary.other.count).toBe(0);
  });

  it("laporan BPJS e-Dabu & SIPP serta biaya tenaga kerja", async () => {
    const edabu = await a.get(`/payroll-runs/${marchRun}/recap?format=edabu`).expect(200);
    expect(edabu.headers["content-disposition"]).toContain("bpjs-kesehatan-edabu.csv");
    expect(edabu.text).toContain("Gaji Pokok + Tunjangan Tetap");
    // Andi: dasar 8 jt → iuran 4% + 1% = 400.000.
    expect(edabu.text).toMatch(/Andi Saputra,,?1990-05-17,2025-06-01,8000000,320000,80000,400000/);
    const sipp = await a.get(`/payroll-runs/${marchRun}/recap?format=sipp`).expect(200);
    expect(sipp.text).toContain("No KPJ");
    expect(sipp.text).toContain("8000000");

    const byDept = (await a.get("/payroll/reports/cost?from=2026-01&to=2026-03").expect(200)).body;
    expect(byDept.items).toEqual([expect.objectContaining({ key: "Keuangan", employees: 2 })]);
    expect(Number(byDept.totals.cost)).toBe(
      Number(byDept.totals.earnings) + Number(byDept.totals.kesEmployer) + Number(byDept.totals.tkEmployer),
    );
    const byMonth = (await a.get("/payroll/reports/cost?from=2026-01&to=2026-03&groupBy=month").expect(200))
      .body;
    expect(byMonth.items.map((i: { key: string }) => i.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
    await a.get("/payroll/reports/cost?from=2026-03&to=2026-01").expect(400);
  });

  it("kirim slip via email: PDF berkata sandi, status per slip", async () => {
    const april = (await a.get("/payroll-runs").expect(200)).body.find(
      (r: { state: string }) => r.state === "draft",
    );
    await a.post(`/payroll-runs/${april.id}/email-payslips`).expect(400); // belum diposting
    const mailer = app.get(Mailer);
    const before = mailer.outbox.length;
    const res = (await a.post(`/payroll-runs/${marchRun}/email-payslips`).expect(200)).body;
    expect(res).toEqual({
      sent: 1,
      failed: 0,
      skipped: [{ name: "Budi Hartono", reason: "Email kerja kosong" }],
    });
    const mail = mailer.outbox.at(-1)!;
    expect(mailer.outbox.length).toBe(before + 1);
    expect(mail).toMatchObject({
      to: "andi@example.com",
      subject: expect.stringContaining("Gaji Maret 2026"),
    });
    expect(mail.text).toContain("DDMMYYYY");
    const pdf = mail.attachments![0]!.content.toString("latin1");
    expect(pdf.startsWith("%PDF-1.7")).toBe(true);
    expect(pdf).toContain("/Encrypt");

    const run = (await a.get(`/payroll-runs/${marchRun}`).expect(200)).body;
    expect(run.payslips.find((p: { employeeId: string }) => p.employeeId === andi).emailedAt).toBeTruthy();
    expect(
      (await a.post(`/payroll-runs/${marchRun}/email-payslips`, { onlyPending: true }).expect(200)).body.sent,
    ).toBe(0);
  });
});
