import { describe, expect, it } from "vitest";
import {
  contractMonths,
  contractVars,
  DEFAULT_CONTRACT_TEMPLATES,
  hariTanggal,
  renderContractTemplate,
  terbilang,
} from "./contract-doc.js";

describe("dokumen kontrak", () => {
  it("terbilang rupiah", () => {
    expect(terbilang(0)).toBe("nol rupiah");
    expect(terbilang(11)).toBe("sebelas rupiah");
    expect(terbilang(115)).toBe("seratus lima belas rupiah");
    expect(terbilang(1_000)).toBe("seribu rupiah");
    expect(terbilang(6_500_000)).toBe("enam juta lima ratus ribu rupiah");
    expect(terbilang(1_250_750)).toBe("satu juta dua ratus lima puluh ribu tujuh ratus lima puluh rupiah");
    expect(terbilang(2_000_000_000)).toBe("dua miliar rupiah");
  });

  it("masa kontrak & tanggal", () => {
    expect(contractMonths("2026-01-01", "2026-12-31")).toBe(12);
    expect(contractMonths("2026-11-16", "2027-05-15")).toBe(6);
    expect(contractMonths("2026-11-16", "2027-05-10")).toBe(5);
    expect(hariTanggal("2026-11-16")).toBe("Senin, 16 November 2026");
  });

  it("template bawaan terisi seluruhnya dari data karyawan", () => {
    const vars = contractVars({
      contract: {
        name: "KTR/2026/0001",
        contractType: "pkwt",
        dateStart: "2026-11-16",
        dateEnd: "2027-11-15",
        wage: "6500000",
        wageType: "monthly",
      },
      allowances: [
        { name: "Tunjangan transport", amount: "500000", fixed: true },
        { name: "Uang makan", amount: "25000", fixed: false },
      ],
      employee: {
        name: "Nina Baru",
        employeeNumber: "EMP/2026/0001",
        nik: "3201010101010001",
        birthPlace: "Bandung",
        birthDate: "1998-04-02",
        gender: "female",
        address: "Jl. Merdeka 1",
        job: "Programmer",
        department: "IT",
        grade: null,
        workLocation: null,
      },
      company: { name: "PT Maju", address: "Jl. Sudirman 5, Jakarta", npwp: null, city: "Jakarta" },
      signer: { name: "Andi Direktur", title: "Direktur", city: null },
    });
    expect(vars).toMatchObject({
      masa_kontrak: "12 (dua belas) bulan",
      gaji: "Rp 6.500.000",
      gaji_terbilang: "enam juta lima ratus ribu rupiah",
      tunjangan: "Tunjangan transport Rp 500.000",
      total_upah: "Rp 7.000.000",
      tanggal_lahir: "2 April 1998",
      golongan: "………………",
      kota: "Jakarta",
    });
    for (const t of DEFAULT_CONTRACT_TEMPLATES) {
      const out = renderContractTemplate(t.body, vars);
      expect(out).not.toMatch(/\{[a-z_]+\}/);
      expect(out).toContain("Nina Baru");
    }
  });
});
