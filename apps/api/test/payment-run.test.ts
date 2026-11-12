import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
interface Group {
  partnerId: string;
  partnerName: string;
  total: string;
  state: string;
  bankAccount: { accountNumber: string } | null;
}
interface Line {
  id: string;
  moveId: string;
  moveName: string;
  partnerId: string;
  amount: string;
  state: string;
}

describe.skipIf(!hasDb)("Payment run: pembayaran pemasok massal", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let rina: Api;
  const acc: Record<string, string> = {};
  const jr: Record<string, string> = {};
  const vendor: Record<string, string> = {};
  const bill: Record<string, string> = {};
  let runId = "";

  const makeBill = async (partnerId: string, date: string, dueDate: string, amount: number) => {
    const m = (
      await a
        .post("/moves", {
          moveType: "in_invoice",
          partnerId,
          date,
          dueDate,
          lines: [{ name: "Pupuk", priceUnit: amount, accountId: acc["5-1000"] }],
        })
        .expect(201)
    ).body;
    await a.post(`/moves/${m.id}/post`).expect(200);
    return m.id as string;
  };
  const move = async (id: string) => (await a.get(`/moves/${id}`).expect(200)).body;
  const detail = async () => (await a.get(`/payment-runs/${runId}`).expect(200)).body;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "payrun");
    for (const r of (await a.get("/accounts?limit=500").expect(200)).body.items) acc[r.code] = r.id;
    for (const r of (await a.get("/journals").expect(200)).body.items) jr[r.code] = r.id;
    await a
      .patch(`/journals/${jr.BNK1}`, { bankAccountNumber: "123-4567-890", bankCompanyCode: "DPAGRO" })
      .expect(200);
    const me = (await a.get("/auth/me")).body;
    const admin = ((await a.get("/roles").expect(200)).body as { id: string; code: string }[]).find(
      (r) => r.code === "admin",
    )!;
    await a
      .post("/users", {
        name: "Rina Direktur",
        email: "rina@example.com",
        password: "rahasia123",
        roleIds: [admin.id],
        companyIds: [me.activeCompanyId],
      })
      .expect(201);
    rina = client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email: "rina@example.com", password: "rahasia123" })
          .expect(200)
      ).body.token,
    );
    for (const name of ["PT Pupuk Nusantara", "CV Benih Jaya", "UD Tani Makmur"])
      vendor[name.split(" ")[1]!] = (
        await a.post("/partners", { name, isSupplier: true }).expect(201)
      ).body.id;
    // Pupuk: dua tagihan jatuh tempo + satu belum; Benih: satu jatuh tempo; Tani: tanpa rekening.
    bill.p1 = await makeBill(vendor.Pupuk!, "2026-02-01", "2026-03-01", 10_000_000);
    bill.p2 = await makeBill(vendor.Pupuk!, "2026-02-10", "2026-03-10", 4_000_000);
    bill.p3 = await makeBill(vendor.Pupuk!, "2026-03-01", "2026-04-30", 7_000_000);
    bill.b1 = await makeBill(vendor.Benih!, "2026-02-15", "2026-03-15", 5_000_000);
    bill.t1 = await makeBill(vendor.Tani!, "2026-02-20", "2026-03-05", 2_000_000);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("rekening bank pemasok: validasi, rekening pertama jadi utama, satu utama", async () => {
    await a
      .post(`/partners/${vendor.Pupuk}/bank-accounts`, {
        bankCode: "bca",
        bankName: "BCA",
        accountNumber: "12ab",
        accountHolder: "X",
      })
      .expect(400);
    let list = (
      await a
        .post(`/partners/${vendor.Pupuk}/bank-accounts`, {
          bankCode: "bca",
          bankName: "BCA",
          accountNumber: "8880 1234 56",
          accountHolder: "PT Pupuk Nusantara",
        })
        .expect(201)
    ).body;
    expect(list[0]).toMatchObject({ accountNumber: "8880123456", isDefault: true });
    list = (
      await a
        .post(`/partners/${vendor.Pupuk}/bank-accounts`, {
          bankCode: "mandiri",
          bankName: "Mandiri",
          accountNumber: "1370009999",
          accountHolder: "PT Pupuk Nusantara",
        })
        .expect(201)
    ).body;
    expect(list.filter((b: { isDefault: boolean }) => b.isDefault)).toHaveLength(1);
    await a
      .post(`/partners/${vendor.Benih}/bank-accounts`, {
        bankCode: "bri",
        bankName: "BRI",
        accountNumber: "0021000111",
        accountHolder: "CV Benih Jaya",
      })
      .expect(201);
  });

  it("usulan memilih tagihan jatuh tempo saja; bisa diubah selama draft", async () => {
    await a
      .post("/payment-runs", { paymentDate: "2026-03-20", dueUntil: "2026-01-31", journalId: jr.BNK1 })
      .expect(400);
    const run = (
      await a
        .post("/payment-runs", { paymentDate: "2026-03-20", dueUntil: "2026-03-31", journalId: jr.BNK1 })
        .expect(201)
    ).body;
    runId = run.id;
    expect(run.state).toBe("draft");
    expect(run.lines.map((l: Line) => l.moveId).sort()).toEqual([bill.p1, bill.p2, bill.b1, bill.t1].sort());
    expect(run.total).toBe("21000000.00");
    expect(run.warnings.join(" ")).toContain("UD Tani Makmur");
    const pupuk = run.groups.find((g: Group) => g.partnerId === vendor.Pupuk);
    expect(pupuk).toMatchObject({ total: "14000000.00", bankAccount: { accountNumber: "8880123456" } });

    // Tagihan di run aktif tidak masuk run lain.
    await a
      .post("/payment-runs", { paymentDate: "2026-03-20", dueUntil: "2026-03-31", journalId: jr.BNK1 })
      .expect(400);

    const t1 = run.lines.find((l: Line) => l.moveId === bill.t1);
    const p2 = run.lines.find((l: Line) => l.moveId === bill.p2);
    const over = await a
      .put(`/payment-runs/${runId}`, { lines: [{ id: p2.id, amount: "4000001" }] })
      .expect(400);
    expect(JSON.stringify(over.body)).toContain("melebihi");
    const updated = (
      await a
        .put(`/payment-runs/${runId}`, {
          lines: [
            { id: t1.id, included: false },
            { id: p2.id, amount: "1500000" },
          ],
        })
        .expect(200)
    ).body;
    expect(updated.total).toBe("16500000.00");
    expect(updated.groups).toHaveLength(2);
  });

  it("persetujuan: eksekusi sebelum disetujui ditolak; pengaju tidak menyetujui sendiri", async () => {
    await a.post(`/payment-runs/${runId}/execute`).expect(400);
    const submitted = (await a.post(`/payment-runs/${runId}/submit`).expect(200)).body;
    expect(submitted.state).toBe("in_approval");
    await a.put(`/payment-runs/${runId}`, { note: "ubah" }).expect(400);
    const reqId = submitted.approvalRequest.id;
    const req = (await a.get(`/approval-requests/${reqId}`).expect(200)).body;
    expect(req.category.code).toBe("PAYRUN");
    expect(req.amount).toBe("16500000.00");
    await a.post(`/approval-requests/${reqId}/approve`, {}).expect(403);
    await rina.post(`/approval-requests/${reqId}/approve`, { note: "OK" }).expect(200);
    expect((await detail()).state).toBe("approved");
  });

  it("file bank: BCA hanya rekening BCA, sisanya dilewati; CSV memuat semua yang punya rekening", async () => {
    const bca = (await a.get(`/payment-runs/${runId}/bank-file?format=bca&info=1`).expect(200)).body;
    expect(bca).toMatchObject({ count: 1, total: "11500000" });
    expect(bca.skipped.map((s: { name: string }) => s.name)).toEqual(["CV Benih Jaya"]);
    const raw = await a.get(`/payment-runs/${runId}/bank-file?format=bca`).expect(200);
    expect(raw.text).toContain("1234567890");
    expect(raw.text).toContain("8880123456");
    const csv = (await a.get(`/payment-runs/${runId}/bank-file?format=csv&info=1`).expect(200)).body;
    expect(csv.count).toBe(2);
  });

  it("eksekusi: satu pembayaran per pemasok, tagihan penuh lunas & sebagian terpisah; tagihan berubah ditandai gagal", async () => {
    // Tagihan Benih dibayar manual sebagian setelah disetujui → baris gagal, tidak dibayar dua kali.
    await a
      .post("/payments", {
        paymentType: "outbound",
        partnerId: vendor.Benih,
        journalId: jr.BNK1,
        amount: 1_000_000,
        date: "2026-03-18",
        moveIds: [bill.b1],
      })
      .expect(201);
    const done = (await a.post(`/payment-runs/${runId}/execute`).expect(200)).body;
    expect(done.state).toBe("done");
    const lineOf = (moveId: string) => done.lines.find((l: Line) => l.moveId === moveId);
    expect(lineOf(bill.p1).state).toBe("paid");
    expect(lineOf(bill.p2).state).toBe("paid");
    expect(lineOf(bill.b1).state).toBe("failed");
    expect(lineOf(bill.t1).state).toBe("pending"); // tidak diikutkan
    expect((await move(bill.p1)).paymentState).toBe("paid");
    const p2 = await move(bill.p2);
    expect(p2.paymentState).toBe("partial");
    expect(p2.amountResidual).toBe("2500000.00");
    expect(lineOf(bill.p1).paymentId).not.toBe(lineOf(bill.p2).paymentId);
    await a.post(`/payment-runs/${runId}/execute`).expect(400);
  });

  it("transfer gagal per pemasok: pembayaran dibalik, tagihan terbuka lagi dan bisa masuk run berikutnya", async () => {
    await a.post(`/payment-runs/${runId}/fail`, { partnerId: vendor.Benih }).expect(400);
    const after = (
      await a
        .post(`/payment-runs/${runId}/fail`, { partnerId: vendor.Pupuk, reason: "Rekening tidak aktif" })
        .expect(200)
    ).body;
    expect(after.groups.find((g: Group) => g.partnerId === vendor.Pupuk).state).toBe("failed");
    expect((await move(bill.p1)).paymentState).toBe("not_paid");
    expect((await move(bill.p2)).amountResidual).toBe("4000000.00");
    const next = (
      await a
        .post("/payment-runs", { paymentDate: "2026-03-25", dueUntil: "2026-03-31", journalId: jr.BNK1 })
        .expect(201)
    ).body;
    expect(next.lines.map((l: Line) => l.moveId)).toEqual(
      expect.arrayContaining([bill.p1, bill.p2, bill.t1, bill.b1]),
    );
    await a.post(`/payment-runs/${next.id}/cancel`).expect(200);
  });
});
