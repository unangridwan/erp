import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, hasDb, signup } from "./helpers.js";

/**
 * Jenis kontrak = master data (SDM › Konfigurasi › Jenis Kontrak): bawaan PKWT/PKWTT/harian/magang/mitra, bisa
 * ditambah/diubah; aturan tanggal berakhir & batas masa kontrak dibaca dari master saat kontrak disimpan.
 */
describe.skipIf(!hasDb)("Jenis kontrak", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  type Type = { id: string; code: string; name: string; isSystem: boolean; usage: number; active: boolean };
  const types = async () => (await a.get("/contract-types").expect(200)).body as Type[];

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "jeniskontrak");
  });
  afterAll(() => app?.close());

  const employee = (name: string, contract: object) =>
    a.post("/employees", { name, contract: { dateStart: "2026-11-16", wage: 3000000, ...contract } });

  it("jenis bawaan tersedia; PKWT/PKWTT tidak bisa dihapus atau dinonaktifkan", async () => {
    const list = await types();
    expect(list.map((t) => t.code)).toEqual(["pkwt", "pkwtt", "harian", "magang", "mitra"]);
    const pkwt = list.find((t) => t.code === "pkwt")!;
    expect(pkwt.isSystem).toBe(true);
    await a.delete(`/contract-types/${pkwt.id}`).expect(400);
    const off = await a
      .put(`/contract-types/${pkwt.id}`, {
        code: "pkwt",
        name: "PKWT",
        fixedTerm: true,
        maxMonths: 60,
        active: false,
      })
      .expect(400);
    expect(off.body.errors?.[0]?.path).toBe("active");
  });

  it("CRUD jenis baru; kode unik & tidak bisa diganti", async () => {
    const created = (
      await a
        .post("/contract-types", {
          code: "Borongan",
          name: "Borongan",
          description: "Upah per satuan hasil",
          legalBasis: "PP 36/2021",
          fixedTerm: true,
          maxMonths: 6,
        })
        .expect(201)
    ).body as Type & { fixedTerm: boolean };
    expect(created.code).toBe("borongan");
    expect(
      (await a.post("/contract-types", { code: "borongan", name: "Lain" }).expect(400)).body.errors[0].path,
    ).toBe("code");
    const rename = await a
      .put(`/contract-types/${created.id}`, { code: "borongan2", name: "Borongan" })
      .expect(400);
    expect(rename.body.errors[0].path).toBe("code");
    const updated = (
      await a
        .put(`/contract-types/${created.id}`, {
          code: "borongan",
          name: "Borongan / hasil kerja",
          fixedTerm: false,
        })
        .expect(200)
    ).body;
    expect(updated).toMatchObject({ name: "Borongan / hasil kerja", fixedTerm: false, maxMonths: null });
    await a.delete(`/contract-types/${created.id}`).expect(204);
  });

  it("aturan jenis dipakai saat kontrak dibuat", async () => {
    // Magang: waktu tertentu, maks 12 bulan.
    const noEnd = await employee("Magang Tanpa Akhir", { contractType: "magang" }).expect(400);
    expect(noEnd.body.errors?.[0]?.path).toBe("contract.dateEnd");
    const tooLong = await employee("Magang Lama", { contractType: "magang", dateEnd: "2027-12-31" }).expect(
      400,
    );
    expect(tooLong.body.errors?.[0]?.message).toMatch(/paling lama 12 bulan/);
    await employee("Magang OK", { contractType: "magang", dateEnd: "2027-11-15" }).expect(201);
    // Harian lepas & mitra: tanpa tanggal berakhir boleh.
    await employee("Harian", { contractType: "harian", wageType: "daily", wage: 150000 }).expect(201);
    await employee("Mitra", { contractType: "mitra" }).expect(201);
    const unknown = await employee("Asing", { contractType: "tidakada" }).expect(400);
    expect(unknown.body.errors?.[0]?.path).toBe("contract.contractType");
  });

  it("jenis terpakai tidak bisa dihapus; nonaktif tidak bisa dipilih lagi", async () => {
    const mitra = (await types()).find((t) => t.code === "mitra")!;
    expect(mitra.usage).toBeGreaterThan(0);
    await a.delete(`/contract-types/${mitra.id}`).expect(400);
    await a.put(`/contract-types/${mitra.id}`, { code: "mitra", name: "Mitra", active: false }).expect(200);
    const inactive = await employee("Mitra Baru", { contractType: "mitra" }).expect(400);
    expect(inactive.body.errors?.[0]?.message).toMatch(/nonaktif/);
  });

  it("dokumen kontrak memakai nama & judul dari master", async () => {
    const harian = (await types()).find((t) => t.code === "harian")!;
    await a
      .put(`/contract-types/${harian.id}`, {
        code: "harian",
        name: "Pekerja Harian Lepas",
        documentTitle: "PERJANJIAN KERJA HARIAN LEPAS (PHL)",
      })
      .expect(200);
    const emp = (
      await employee("Harian Dok", { contractType: "harian", wageType: "daily", wage: 150000 }).expect(201)
    ).body as { id: string };
    const contracts = (await a.get(`/contracts?employeeId=${emp.id}`).expect(200)).body.items as {
      id: string;
    }[];
    const doc = (await a.get(`/contracts/${contracts[0]!.id}/document`).expect(200)).body as {
      title: string;
      body: string;
    };
    expect(doc.title).toBe("PERJANJIAN KERJA HARIAN LEPAS (PHL)");
    expect(doc.body).toContain("Pekerja Harian Lepas");
  });
});
