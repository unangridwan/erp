/**
 * Membangkitkan seluruh data simulasi grup PT Didin Putra Agro sebagai tabel (lembar Excel).
 * Deterministik: seed tetap → hasil identik setiap dijalankan.
 */
import { ID_NATIONAL_HOLIDAYS } from "@erp/shared";
import {
  BANKS,
  BOMS,
  BREAKDOWNS,
  EQUIPMENT,
  FLEET_SERVICE_TYPES,
  SUPPORT_TOPICS,
  BUSINESS_UNITS,
  CITIES,
  COMPANIES,
  FIRST_FEMALE,
  FIRST_MALE,
  fxRate,
  GRADES,
  HISTORICAL_HOLIDAYS,
  LAST,
  MAJORS,
  PARTNERS,
  PRODUCTS,
  STREETS,
  UNIVERSITIES,
  type CompanyDef,
  type ProductDef,
} from "./catalog.js";
import { addDays, eachDay, monthEnd, pad, Rng, roundTo, weekday } from "./rng.js";

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;
export type Model = Record<string, Row[]>;

/** Saldo awal 1 Jan 2021; transaksi Januari 2021 – Oktober 2026 (November 2026 berjalan). */
export const OPENING_DATE = "2021-01-01";
export const TX_FROM = "2021-01-01";
export const TX_TO = "2026-10-31";
export const YEARS = [2021, 2022, 2023, 2024, 2025, 2026] as const;
/** Tahun yang sudah ditutup buku (tahun berjalan 2026 belum). */
export const CLOSED_YEARS = [2021, 2022, 2023, 2024, 2025] as const;
export const PERIODS: string[] = YEARS.flatMap((y) =>
  Array.from({ length: y === 2026 ? 10 : 12 }, (_, i) => `${y}-${pad(i + 1, 2)}`),
);
/** Absensi harian semua karyawan sejak tanggal ini; sebelumnya hanya pekerja harian (upahnya dihitung dari absensi). */
export const FULL_ATTENDANCE_FROM = "2025-01-01";
/**
 * Kepadatan transaksi harian per tahun (2026 = 1): makin padat mendekati tahun berjalan — volume usaha tumbuh dan
 * data lama cukup untuk tren tanpa memperlambat pemuatan.
 */
export const DENSITY: Record<number, number> = {
  2021: 0.32,
  2022: 0.4,
  2023: 0.5,
  2024: 0.64,
  2025: 0.82,
  2026: 1,
};
export const yearOf = (date: string) => Number(date.slice(0, 4));
const MONTH_NAMES = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
export const periodLabel = (period: string) =>
  `${MONTH_NAMES[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
export const DEMO_PASSWORD = "DemoAgro2026!";
export const EMAIL_DOMAIN = "didinputraagro.co.id";

const SUBS = COMPANIES.filter((c) => !c.holding);
const HOLDING = COMPANIES.find((c) => c.holding)!;

const HOLIDAYS = new Set([
  ...(ID_NATIONAL_HOLIDAYS[2026] ?? []).map((h) => h.date),
  ...Object.values(HISTORICAL_HOLIDAYS).flatMap((list) => list.map(([d]) => d)),
]);
const isWorkday = (date: string) => weekday(date) >= 1 && weekday(date) <= 5 && !HOLIDAYS.has(date);
const WORKDAYS = eachDay(TX_FROM, TX_TO).filter(isWorkday);

/** Idul Fitri tiap tahun (THR dibayar sebelumnya) & tahun hijriahnya. */
const IDUL_FITRI: Record<number, string> = {
  2021: "2021-05-13",
  2022: "2022-05-02",
  2023: "2023-04-22",
  2024: "2024-04-10",
  2025: "2025-03-31",
  2026: "2026-03-21",
};
const HIJRI: Record<number, number> = {
  2021: 1442,
  2022: 1443,
  2023: 1444,
  2024: 1445,
  2025: 1446,
  2026: 1447,
};

/** Pelatihan contoh: nama, penyelenggara, biaya per peserta, masa berlaku sertifikat (bulan). */
const TRAININGS: [string, string, number, number | null][] = [
  ["K3 Umum & Keselamatan Kerja", "Lembaga K3 Nusantara", 1_500_000, 36],
  ["Good Manufacturing Practice (CPOTB)", "Konsultan Mutu Pangan & Obat", 2_750_000, 24],
  ["Kepemimpinan Supervisor", "Akademi Manajemen Indonesia", 3_500_000, null],
  ["Excel & Analisis Data untuk Bisnis", "Pusat Pelatihan Digital", 1_200_000, null],
  ["Teknik Penjualan B2B", "Sales Excellence Institute", 2_200_000, null],
  ["Perpajakan Brevet A/B", "Ikatan Konsultan Pajak", 4_500_000, null],
  ["Budidaya Tanaman Berkelanjutan", "Balai Pelatihan Pertanian", 1_800_000, null],
  ["Operator Forklift Bersertifikat", "Disnaker Kota", 2_500_000, 60],
];

/** Sasaran departemen contoh: judul, metrik, target, satuan. */
const GOALS: [string, "percent" | "number" | "currency", number, string][] = [
  ["Kepuasan pelanggan", "percent", 90, "%"],
  ["Ketepatan pengiriman", "percent", 95, "%"],
  ["Penurunan biaya operasional", "percent", 10, "%"],
  ["Jumlah pelanggan baru", "number", 25, "pelanggan"],
  ["Pelatihan karyawan selesai", "number", 40, "jam"],
  ["Nilai penjualan baru", "currency", 2_000_000_000, "Rp"],
];

/** Plafon klaim per karyawan per tahun. */
const CLAIM_LIMITS: Record<string, number> = {
  "Perjalanan Dinas": 24_000_000,
  "Transportasi & Parkir": 6_000_000,
  "Jamuan Klien": 12_000_000,
  "Kacamata & Kesehatan": 2_500_000,
};
const TERMS: Record<string, number> = { Tunai: 0, "Net 14 hari": 14, "Net 30 hari": 30, "Net 60 hari": 60 };

function npwp16(rng: Rng) {
  return `0${rng.digits(15)}`;
}

function nik(rng: Rng, region: string, birthDate: string, female: boolean) {
  const [y, m, d] = birthDate.split("-") as [string, string, string];
  const day = Number(d) + (female ? 40 : 0);
  return `${region}${rng.digits(2)}${pad(day, 2)}${m}${y.slice(2)}${rng.digits(4)}`;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");

export function buildModel(seed = 20260101): Model {
  const rng = new Rng(seed);
  const m: Model = {};
  const add = (sheet: string, row: Row) => (m[sheet] ??= []).push(row);

  // ---- Perusahaan, cabang, unit bisnis, kurs ----
  for (const c of COMPANIES)
    add("Perusahaan", {
      code: c.code,
      name: c.name,
      parent: c.holding ? "" : HOLDING.code,
      entityType: c.holding ? "holding" : "subsidiary",
      npwp: c.npwp,
      pkp: true,
      street: c.street,
      city: c.city,
      province: c.province,
      postalCode: c.postalCode,
      phone: c.phone,
      email: c.email,
      ownershipPct: c.holding ? null : 100,
      capital: c.capital,
    });
  for (const c of COMPANIES)
    for (const b of c.branches) add("Cabang", { company: c.code, code: b.code, name: b.name, city: b.city });
  for (const u of BUSINESS_UNITS) add("Unit Bisnis", { code: u.code, name: u.name });
  for (const cur of ["USD", "EUR"])
    for (const period of [...PERIODS, "2026-11"])
      add("Kurs", { currencyCode: cur, rateDate: `${period}-01`, rate: fxRate(cur, period) });
  for (const [year, list] of Object.entries(HISTORICAL_HOLIDAYS))
    for (const [date, name, collective] of list)
      add("Libur Nasional", { year: Number(year), date, name, kind: collective ? "collective" : "national" });

  // ---- Akun tambahan (di luar bagan akun bawaan) ----
  const extraAccounts = [
    { code: "1-2050", name: "Tanah", accountType: "asset_fixed" },
    { code: "1-2400", name: "Mesin & Peralatan Pertanian", accountType: "asset_fixed" },
    { code: "1-2490", name: "Akumulasi Penyusutan Mesin & Peralatan", accountType: "asset_fixed" },
    { code: "6-8000", name: "Beban Perjalanan Dinas", accountType: "expense" },
    { code: "6-8100", name: "Beban Transportasi & Parkir", accountType: "expense" },
    { code: "6-8200", name: "Beban Jamuan & Representasi", accountType: "expense" },
    { code: "6-8300", name: "Beban Riset & Pengembangan", accountType: "expense" },
  ];
  for (const c of COMPANIES) for (const a of extraAccounts) add("Akun Tambahan", { company: c.code, ...a });

  // ---- Golongan, jadwal, jenis cuti bawaan, kategori klaim ----
  for (const [i, g] of GRADES.entries())
    add("Golongan Upah", {
      code: g.code,
      name: g.name,
      baseWage: g.base,
      minWage: g.min,
      maxWage: g.max,
      sequence: i + 1,
    });
  for (const c of COMPANIES) {
    add("Jadwal Kerja", {
      company: c.code,
      name: "Kantor 08:00–17:00 (Sen–Jum)",
      startTime: "08:00",
      endTime: "17:00",
      graceMinutes: 15,
    });
    add("Jadwal Kerja", {
      company: c.code,
      name: "Lapangan 07:00–16:00 (Sen–Jum)",
      startTime: "07:00",
      endTime: "16:00",
      graceMinutes: 10,
    });
  }
  for (const c of COMPANIES)
    for (const [name, account] of [
      ["Perjalanan Dinas", "6-8000"],
      ["Transportasi & Parkir", "6-8100"],
      ["Jamuan Klien", "6-8200"],
      ["Kacamata & Kesehatan", "6-1000"],
    ] as const)
      add("Kategori Klaim", {
        company: c.code,
        name,
        accountCode: account,
        annualLimit: CLAIM_LIMITS[name]!,
      });

  // ---- Produk & kategori ----
  const products: Record<string, ProductDef[]> = PRODUCTS;
  for (const c of COMPANIES) {
    for (const cat of [...new Set(products[c.code]!.map((p) => p.category))])
      add("Kategori Produk", { company: c.code, name: cat, parent: "" });
    for (const p of products[c.code]!)
      add("Produk", {
        company: c.code,
        sku: p.sku,
        name: p.name,
        category: p.category,
        productType: p.type ?? "storable",
        uom: p.uom,
        salePrice: p.price,
        cost: p.cost,
        costMethod: p.costMethod ?? "average",
        exportPriceUsd: p.usd ?? null,
        openingStock: p.type === "service" ? null : (p.stock ?? 0),
      });
  }

  // ---- Partner ----
  type Partner = {
    company: string;
    name: string;
    customer: boolean;
    supplier: boolean;
    foreign: string | null;
    term: string;
  };
  const partners: Partner[] = [];
  for (const c of COMPANIES) {
    const def = PARTNERS[c.code]!;
    const foreignNames = new Set(
      [...(def.foreignCustomers ?? []), ...(def.foreignSuppliers ?? [])].map(([n]) => n),
    );
    for (const name of def.customers)
      partners.push({
        company: c.code,
        name,
        customer: true,
        supplier: false,
        foreign: null,
        term: rng.pick(["Net 14 hari", "Net 30 hari", "Net 30 hari", "Net 60 hari", "Tunai"]),
      });
    for (const [name, country] of def.foreignCustomers ?? [])
      partners.push({
        company: c.code,
        name,
        customer: true,
        supplier: false,
        foreign: country,
        term: "Net 60 hari",
      });
    for (const name of def.suppliers)
      if (!foreignNames.has(name))
        partners.push({
          company: c.code,
          name,
          customer: false,
          supplier: true,
          foreign: null,
          term: rng.pick(["Net 30 hari", "Net 30 hari", "Net 14 hari", "Tunai"]),
        });
    for (const [name, country] of def.foreignSuppliers ?? [])
      partners.push({
        company: c.code,
        name,
        customer: false,
        supplier: true,
        foreign: country,
        term: "Net 60 hari",
      });
  }
  for (const p of partners) {
    const [city, province] = p.foreign ? ["", ""] : rng.pick(CITIES);
    add("Partner", {
      company: p.company,
      name: p.name,
      kind: "company",
      isCustomer: p.customer,
      isSupplier: p.supplier,
      npwp: p.foreign ? "" : npwp16(rng),
      email: `${slug(p.name).split(".").slice(0, 3).join(".")}@contoh.co.id`,
      phone: p.foreign ? `+${rng.int(1, 99)} ${rng.digits(9)}` : `0${rng.int(21, 99)}-${rng.digits(7)}`,
      street: p.foreign ? "International Trade Center" : `${rng.pick(STREETS)} No. ${rng.int(1, 250)}`,
      city: city || "",
      province: province || "",
      countryCode: p.foreign ?? "IDN",
      taxDocumentType: p.foreign ? "Other ID" : "TIN",
      taxTrxCode: p.foreign ? "07" : "04",
      paymentTerm: p.term,
    });
  }

  // ---- Struktur organisasi & karyawan ----
  type Emp = {
    company: CompanyDef;
    number: string;
    name: string;
    female: boolean;
    department: string;
    job: string;
    grade: string;
    wage: number;
    daily: boolean;
    joinDate: string;
    contractType: "pkwtt" | "pkwt" | "harian";
    managerNumber: string;
    schedule: string;
    birthDate: string;
    married: boolean;
    children: number;
    branch: string;
    sales: boolean;
    field: boolean;
    /** Mantan karyawan: tanggal & alasan keluar (kontrak diakhiri dengan status keluar). */
    resignDate?: string;
    resignReason?: "resign" | "end_contract";
  };
  const employees: Emp[] = [];
  /** Karyawan bekerja pada tanggal ini (sudah masuk & belum keluar). */
  const activeOn = (e: Emp, date: string) => e.joinDate <= date && (!e.resignDate || date <= e.resignDate);
  /** Upah tahun `year`: upah 2026 dideflasi ±6,5% per tahun. */
  const wageIn = (e: Emp, year: number) =>
    year >= 2026 ? e.wage : roundTo(e.wage / 1.065 ** (2026 - year), e.daily ? 1000 : 50_000);
  for (const c of COMPANIES) {
    for (const d of c.departments) add("Departemen", { company: c.code, name: d, managerNumber: "" });
    let seq = 0;
    const deptHead = new Map<string, string>();
    let director = "";
    // Jabatan umum dipenuhi dulu, sisanya diisi staf operasional hingga headcount.
    const slots: { job: string; department: string; grade: string; daily?: boolean }[] = [];
    const toSlot = (j: CompanyDef["jobs"][number]) => ({
      job: j.name,
      department: j.department,
      grade: j.grade,
      daily: j.daily,
    });
    for (const j of c.jobs) for (let i = 0; i < j.count; i++) slots.push(toSlot(j));
    const filler = c.jobs.filter((j) => j.grade <= "B2" && !j.name.startsWith("Direktur"));
    while (slots.length < c.headcount) slots.push(toSlot(rng.pick(filler)));
    const hire = (s: (typeof slots)[number], leaver?: { joinDate: string; resignDate: string }) => {
      seq++;
      const female = rng.chance(
        s.department.includes("Keuangan") || s.department.includes("SDM") ? 0.6 : 0.35,
      );
      const first = rng.pick(female ? FIRST_FEMALE : FIRST_MALE);
      const name = `${first} ${rng.pick(LAST)}${rng.chance(0.15) ? ` ${rng.pick(LAST)}` : ""}`;
      const senior = s.grade >= "D1";
      const age = senior ? rng.int(38, 56) : s.grade >= "C1" ? rng.int(28, 45) : rng.int(20, 40);
      const birthDate = `${1999 + 27 - age}-${pad(rng.int(1, 12), 2)}-${pad(rng.int(1, 28), 2)}`;
      const joinYear = Math.min(2025, Math.max(2010, 2026 - rng.int(0, Math.max(1, age - 21))));
      // Mantan karyawan masuk paling cepat usia 19 tahun.
      const adultFrom = `${Number(birthDate.slice(0, 4)) + 19}${birthDate.slice(4)}`;
      const joinDate = leaver
        ? [leaver.joinDate, adultFrom].sort()[1]!
        : seq <= 2
          ? "2018-01-02"
          : `${joinYear}-${pad(rng.int(1, 12), 2)}-${pad(rng.int(1, 28), 2)}`;
      const g = GRADES.find((x) => x.code === s.grade)!;
      // Gaji pokok: standar golongan untuk sebagian besar, sisanya disesuaikan dalam skala.
      const wage = s.daily
        ? roundTo(g.base / 25, 1000)
        : rng.chance(0.6)
          ? g.base
          : roundTo(rng.int(g.min, g.max), 50_000);
      const number = `${c.code}-${pad(seq, 4)}`;
      if (s.job === "Direktur Utama") director = number;
      if (!leaver && /^(Manajer|Kepala|Direktur)/.test(s.job) && !deptHead.has(s.department))
        deptHead.set(s.department, number);
      const married = age > 26 && rng.chance(0.7);
      const field =
        /Pekerja|Petani|Buruh|Operator|Teknisi|Supervisor Kebun|Supervisor Budidaya|Staf Gudang|Pilot/.test(
          s.job,
        );
      employees.push({
        company: c,
        number,
        name,
        female,
        department: s.department,
        job: s.job,
        grade: s.grade,
        wage,
        daily: Boolean(s.daily),
        joinDate,
        // PKWT paling lama 5 tahun: hanya karyawan yang masuk sejak 2022 (kontrak s.d. akhir 2026).
        contractType: s.daily
          ? "harian"
          : !leaver && joinDate >= "2022-01-01" && rng.chance(senior ? 0.05 : 0.3)
            ? "pkwt"
            : "pkwtt",
        managerNumber: "",
        schedule: field ? "Lapangan 07:00–16:00 (Sen–Jum)" : "Kantor 08:00–17:00 (Sen–Jum)",
        birthDate,
        married,
        children: married ? rng.int(0, 3) : 0,
        branch: field && c.branches.length > 1 ? rng.pick(c.branches).code : c.branches[0]!.code,
        sales: /Sales|Account Manager|Export Sales/.test(s.job),
        field,
        ...(leaver
          ? {
              resignDate:
                [leaver.resignDate, addDays(joinDate, 400)].sort()[1]! > "2026-09-30"
                  ? "2026-09-30"
                  : [leaver.resignDate, addDays(joinDate, 400)].sort()[1]!,
              resignReason: rng.chance(0.8) ? ("resign" as const) : ("end_contract" as const),
            }
          : {}),
      });
    };
    for (const s of slots.slice(0, c.headcount)) hire(s);
    // Mantan karyawan: bekerja sebagian periode 2021–2026 lalu keluar (turnover ±3% per tahun).
    for (let k = 0; k < Math.round(c.headcount * 0.16); k++) {
      const resignDate = `${rng.int(2021, 2026)}-${pad(rng.int(1, 12), 2)}-${pad(rng.int(1, 28), 2)}`;
      if (resignDate > "2026-09-30") continue;
      const joinDate = addDays(resignDate, -rng.int(300, 2500));
      hire(toSlot(rng.pick(filler)), {
        joinDate: joinDate < "2014-01-02" ? "2014-01-02" : joinDate,
        resignDate,
      });
    }
    for (const e of employees.filter((x) => x.company === c)) {
      const head = deptHead.get(e.department);
      e.managerNumber = e.number === director ? "" : head && head !== e.number ? head : director;
    }
    for (const row of m["Departemen"]!.filter((r) => r.company === c.code))
      row.managerNumber = deptHead.get(String(row.name)) ?? director;
  }
  const jobsSeen = new Set<string>();
  for (const e of employees)
    if (!jobsSeen.has(e.job)) {
      jobsSeen.add(e.job);
      add("Jabatan", { name: e.job, grade: e.grade });
    }

  for (const e of employees) {
    const [city, , region] = rng.pick(CITIES);
    const ptkp = `${e.married ? "K" : "TK"}/${Math.min(3, e.children)}`;
    const bank = rng.pick(BANKS);
    add("Karyawan", {
      company: e.company.code,
      employeeNumber: e.number,
      name: e.name,
      department: e.department,
      job: e.job,
      grade: e.grade,
      managerNumber: e.managerNumber,
      branch: e.branch,
      schedule: e.schedule,
      workEmail: e.daily ? "" : `${slug(e.name)}.${e.number.slice(-4)}@${EMAIL_DOMAIN}`,
      workPhone: e.daily ? "" : `0${rng.int(21, 274)}-${rng.digits(7)}`,
      joinDate: e.joinDate,
      nik: nik(rng, region, e.birthDate, e.female),
      kkNo: `${region}${rng.digits(12)}`,
      npwp: e.daily && rng.chance(0.6) ? "" : nik(rng, region, e.birthDate, e.female),
      ptkpStatus: ptkp,
      bpjsKesNo: `000${rng.digits(10)}`,
      bpjsKesEnrolled: true,
      bpjsTkNo: `${rng.digits(11)}`,
      bpjsTkEnrolled: true,
      bpjsJpEnrolled: !e.daily,
      overtimeEligible: e.grade < "C1",
      birthPlace: city,
      birthDate: e.birthDate,
      gender: e.female ? "Perempuan" : "Laki-laki",
      religion: rng.weighted([
        ["Islam", 80],
        ["Kristen Protestan", 9],
        ["Katolik", 6],
        ["Hindu", 3],
        ["Buddha", 2],
      ] as const),
      maritalStatus: e.married ? "Kawin" : "Belum kawin",
      bloodType: rng.pick(["A", "B", "AB", "O"]),
      address: `${rng.pick(STREETS)} No. ${rng.int(1, 200)}, ${city}`,
      personalPhone: `08${rng.int(11, 99)}${rng.digits(8)}`,
      personalEmail: `${slug(e.name)}${rng.int(10, 99)}@gmail.com`,
      emergencyContact: `${rng.pick(e.female ? FIRST_MALE : FIRST_FEMALE)} ${e.name.split(" ").at(-1)}`,
      emergencyPhone: `08${rng.int(11, 99)}${rng.digits(8)}`,
      bankName: bank,
      bankAccount: rng.digits(bank === "BRI" ? 15 : 10),
      bankAccountName: e.name,
    });
    const allowances: Row = {};
    if (!e.daily) {
      if (e.grade >= "C1")
        allowances.TJAB = e.grade >= "E1" ? 10_000_000 : e.grade >= "D1" ? 5_000_000 : 1_500_000;
      if (e.married) allowances.TKEL = 500_000;
      allowances.TRANS = e.field ? 600_000 : 750_000;
    }
    // Upah naik ±6,5% tiap Januari: kontrak pertama memakai upah tahun masuk (paling cepat 2021), kenaikan
    // tahun berikutnya lewat SK Penyesuaian upah.
    const firstYear = Math.max(2021, yearOf(e.joinDate));
    const lastYear = e.resignDate ? yearOf(e.resignDate) : 2026;
    add("Kontrak", {
      company: e.company.code,
      employeeNumber: e.number,
      contractType: e.contractType,
      wageType: e.daily ? "Harian" : "Bulanan",
      dateStart: e.joinDate,
      dateEnd: e.contractType === "pkwt" ? "2026-12-31" : "",
      wage: wageIn(e, firstYear),
      note: e.contractType === "pkwt" ? "PKWT s.d. 31 Desember 2026" : "",
      TJAB: allowances.TJAB ?? null,
      TKEL: allowances.TKEL ?? null,
      TRANS: allowances.TRANS ?? null,
    });
    for (let y = firstYear + 1; y <= lastYear; y++)
      if (!e.resignDate || e.resignDate > `${y}-01-01`)
        add("Penyesuaian Upah", {
          company: e.company.code,
          employeeNumber: e.number,
          effectiveDate: `${y}-01-01`,
          newWage: wageIn(e, y),
          reason: `Kenaikan upah tahunan ${y}`,
        });
    if (e.resignDate)
      add("Karyawan Keluar", {
        company: e.company.code,
        employeeNumber: e.number,
        resignDate: e.resignDate,
        reason: e.resignReason ?? "resign",
        note: e.resignReason === "end_contract" ? "Kontrak tidak diperpanjang" : "Mengundurkan diri",
      });
    if (e.married) {
      add("Keluarga", {
        company: e.company.code,
        employeeNumber: e.number,
        relation: e.female ? "Suami" : "Istri",
        name: `${rng.pick(e.female ? FIRST_MALE : FIRST_FEMALE)} ${rng.pick(LAST)}`,
        gender: e.female ? "Laki-laki" : "Perempuan",
        birthDate: `${Number(e.birthDate.slice(0, 4)) + rng.int(-3, 3)}-${pad(rng.int(1, 12), 2)}-${pad(rng.int(1, 28), 2)}`,
        dependent: !e.female,
        bpjsCovered: true,
      });
      for (let k = 0; k < e.children; k++)
        add("Keluarga", {
          company: e.company.code,
          employeeNumber: e.number,
          relation: "Anak",
          name: `${rng.pick(rng.chance(0.5) ? FIRST_MALE : FIRST_FEMALE)} ${e.name.split(" ").at(-1)}`,
          gender: rng.chance(0.5) ? "Laki-laki" : "Perempuan",
          birthDate: `${2026 - rng.int(1, 18)}-${pad(rng.int(1, 12), 2)}-${pad(rng.int(1, 28), 2)}`,
          dependent: true,
          bpjsCovered: true,
        });
    }
    const level = e.daily
      ? "SMA"
      : e.grade >= "C1"
        ? rng.pick(["S1", "S1", "S2"])
        : e.grade >= "B1"
          ? rng.pick(["S1", "D3"])
          : rng.pick(["SMA/SMK", "D3"]);
    const yearEnd =
      Number(e.birthDate.slice(0, 4)) +
      (level.startsWith("S") ? (level === "S2" ? 25 : 22) : level === "D3" ? 21 : 18);
    add("Pendidikan", {
      company: e.company.code,
      employeeNumber: e.number,
      level,
      institution:
        level.startsWith("S") || level === "D3"
          ? rng.pick(UNIVERSITIES)
          : `SMA Negeri ${rng.int(1, 12)} ${rng.pick(CITIES)[0]}`,
      major: level.startsWith("S") || level === "D3" ? rng.pick(MAJORS.default!) : "IPA",
      yearStart: yearEnd - (level === "S2" ? 2 : level === "S1" ? 4 : 3),
      yearEnd,
      gpa: level.startsWith("S") || level === "D3" ? (rng.int(290, 395) / 100).toFixed(2) : "",
    });
    for (let y = firstYear; y <= lastYear; y++)
      add("Alokasi Cuti", {
        company: e.company.code,
        employeeNumber: e.number,
        leaveType: "Cuti tahunan",
        days: 12,
        dateFrom: `${y}-01-01`,
        dateTo: `${y}-12-31`,
        note: `Hak cuti tahunan ${y}`,
      });
  }

  // ---- Cuti, absensi, lembur ----
  const leaveDays = new Map<string, Set<string>>();
  for (const e of employees) {
    const taken = new Set<string>();
    for (const year of YEARS) {
      const days_ = WORKDAYS.filter((d) => d.startsWith(String(year)) && activeOn(e, d));
      if (!days_.length) continue;
      // Tahun lama lebih sedikit pengajuan (data bertingkat); 2025–2026 1–4 pengajuan setahun.
      const n = rng.weighted(
        year >= 2025
          ? ([
              [1, 30],
              [2, 35],
              [3, 25],
              [4, 10],
            ] as const)
          : ([
              [0, 30],
              [1, 45],
              [2, 25],
            ] as const),
      );
      for (let i = 0; i < n; i++) {
        const start = rng.pick(days_);
        const sick = rng.chance(0.3);
        const len = sick ? rng.int(1, 2) : rng.int(1, 3);
        const days = days_.filter((d) => d >= start).slice(0, len);
        if (days.some((d) => taken.has(d))) continue;
        days.forEach((d) => taken.add(d));
        add("Pengajuan Cuti", {
          company: e.company.code,
          employeeNumber: e.number,
          leaveType: sick ? "Sakit (dengan surat dokter)" : "Cuti tahunan",
          dateFrom: days[0]!,
          dateTo: days.at(-1)!,
          reason: sick
            ? rng.pick(["Demam & flu", "Sakit gigi", "Gangguan pencernaan", "Kontrol ke dokter"])
            : rng.pick([
                "Acara keluarga",
                "Mudik",
                "Keperluan pribadi",
                "Pernikahan saudara",
                "Liburan keluarga",
              ]),
          state: "Disetujui",
        });
      }
    }
    leaveDays.set(e.number, taken);
  }
  for (const e of employees) {
    const taken = leaveDays.get(e.number)!;
    const office = e.schedule.startsWith("Kantor");
    const [startH, endH] = office ? [8, 17] : [7, 16];
    for (const d of WORKDAYS) {
      // Absensi lengkap sejak 2025; tahun sebelumnya hanya pekerja harian (upahnya per hari hadir).
      if (!activeOn(e, d) || (d < FULL_ATTENDANCE_FROM && !e.daily)) continue;
      if (taken.has(d) || rng.chance(0.008)) continue;
      const late = rng.chance(0.07);
      const inMin = late ? rng.int(16, 70) : rng.int(-35, 10);
      const ot =
        e.grade < "C1" && (e.field || e.department.includes("Gudang")) && rng.chance(0.09)
          ? rng.int(1, 3)
          : 0;
      const outMin = ot ? ot * 60 + rng.int(0, 20) : rng.int(0, 75);
      const t = (h: number, min: number) => {
        const total = h * 60 + min;
        return `${pad(Math.floor(total / 60), 2)}:${pad(((total % 60) + 60) % 60, 2)}`;
      };
      add("Absensi", {
        company: e.company.code,
        employeeNumber: e.number,
        date: d,
        checkIn: t(startH, inMin),
        checkOut: d === WORKDAYS.at(-1) && rng.chance(0.03) ? "" : t(endH, outMin),
      });
      if (ot)
        add("Lembur", {
          company: e.company.code,
          employeeNumber: e.number,
          date: d,
          hours: ot,
          dayType: "Hari kerja",
          description: rng.pick([
            "Bongkar muat kiriman",
            "Penyelesaian pesanan",
            "Panen & pascapanen",
            "Stock opname",
            "Servis darurat pelanggan",
            "Pengemasan pesanan ekspor",
          ]),
        });
    }
  }

  // ---- Klaim biaya & pinjaman karyawan ----
  const claimUsed = new Map<string, number>();
  for (const e of employees.filter((x) => (x.sales || x.grade >= "C1") && !x.daily))
    for (const period of PERIODS) {
      if (!rng.chance(0.55 * DENSITY[yearOf(period)]!)) continue;
      const pool = WORKDAYS.filter((d) => d.startsWith(period) && activeOn(e, d));
      if (!pool.length) continue;
      const date = rng.pick(pool);
      const cat = e.sales
        ? rng.pick(["Perjalanan Dinas", "Transportasi & Parkir", "Jamuan Klien"])
        : rng.pick(["Transportasi & Parkir", "Kacamata & Kesehatan", "Perjalanan Dinas"]);
      const wanted =
        cat === "Perjalanan Dinas"
          ? roundTo(rng.int(800_000, 4_500_000), 5000)
          : cat === "Jamuan Klien"
            ? roundTo(rng.int(350_000, 1_800_000), 5000)
            : roundTo(rng.int(75_000, 650_000), 5000);
      // Plafon tahunan per kategori: klaim dipotong ke sisa plafon, dilewati bila sisanya terlalu kecil.
      const usedKey = `${e.number}|${cat}|${yearOf(date)}`;
      const left = CLAIM_LIMITS[cat]! - (claimUsed.get(usedKey) ?? 0);
      const amount = Math.min(wanted, Math.floor(left / 5000) * 5000);
      if (amount < 50_000) continue;
      claimUsed.set(usedKey, (claimUsed.get(usedKey) ?? 0) + amount);
      add("Klaim Biaya", {
        company: e.company.code,
        employeeNumber: e.number,
        date,
        category: cat,
        amount,
        description:
          cat === "Perjalanan Dinas"
            ? `Kunjungan pelanggan ke ${rng.pick(CITIES)[0]}`
            : cat === "Jamuan Klien"
              ? "Makan siang dengan calon pelanggan"
              : cat === "Transportasi & Parkir"
                ? "Tol, parkir & BBM kunjungan"
                : "Penggantian kacamata",
        payMethod: "payslip",
      });
    }
  for (const c of COMPANIES)
    for (const year of YEARS)
      for (const e of rng.sample(
        employees.filter(
          (x) =>
            x.company === c &&
            !x.daily &&
            x.grade <= "B2" &&
            activeOn(x, `${year}-02-01`) &&
            (!x.resignDate || x.resignDate > `${year + 1}-12-31`),
        ),
        year >= 2025 ? 3 : 2,
      )) {
        const start = `${year}-${pad(rng.int(2, year === 2026 ? 8 : 9), 2)}`;
        const principal = roundTo(rng.int(3_000_000, 15_000_000), 500_000);
        add("Pinjaman Karyawan", {
          company: c.code,
          employeeNumber: e.number,
          name: rng.pick([
            "Pinjaman renovasi rumah",
            "Pinjaman biaya pendidikan anak",
            "Pinjaman kesehatan keluarga",
            "Kasbon kendaraan",
          ]),
          principal,
          installment: roundTo(principal / rng.pick([6, 10, 12]), 50_000),
          startPeriod: start,
          disburseDate: addDays(`${start}-01`, -4),
        });
      }

  // ---- Penjualan & pembelian dengan simulasi stok ----
  const stock = new Map<string, number>();
  for (const c of COMPANIES)
    for (const p of products[c.code]!) if (p.type !== "service") stock.set(p.sku, p.stock ?? 0);
  type Order = {
    kind: "SO" | "PO";
    company: string;
    no: string;
    partner: string;
    date: string;
    lines: { sku: string; qty: number }[];
    pricelist?: string;
    ic?: string;
  };
  const orders: Order[] = [];
  const counters: Record<string, number> = {};
  const nextNo = (kind: string, company: string) =>
    `${kind}-${company}-${pad((counters[kind + company] = (counters[kind + company] ?? 0) + 1), 4)}`;
  const qtyFor = (p: ProductDef, export_ = false) => {
    if (p.type === "service")
      return p.price >= 10_000_000 ? 1 : rng.int(1, p.name.includes("per ha") ? 40 : 5);
    if (p.uom === "kg")
      return export_
        ? roundTo(rng.int(5000, 18000), 500)
        : roundTo(rng.int(p.price > 50_000 ? 50 : 500, p.price > 50_000 ? 600 : 6000), 50);
    if (p.price >= 100_000_000) return 1;
    if (p.price >= 10_000_000) return rng.int(1, 3);
    if (p.price >= 1_000_000) return rng.int(2, 15);
    return roundTo(rng.int(20, 300), 10);
  };
  const MADE = new Set(Object.values(BOMS).flatMap((list) => list.map((b) => b.sku)));
  /** Bahan untuk produksi dibeli ulang lebih banyak (dipakai produksi & sebagian dijual). */
  const BOM_INPUTS = new Set(
    Object.values(BOMS).flatMap((list) => list.flatMap((b) => b.lines.map(([sku]) => sku))),
  );
  const SO_PER_MONTH: Record<string, number> = { BUI: 110, AGT: 55, PTN: 55, YHN: 115 };
  const sellFor = (c: CompanyDef, period: string) => {
    const custs = partners.filter((p) => p.company === c.code && p.customer);
    const catalog = products[c.code]!;
    {
      const days = WORKDAYS.filter((d) => d.startsWith(period));
      // Volume tumbuh per tahun (DENSITY) dengan musim: ramai menjelang tanam (Okt–Des) & panen (Mar–Mei).
      const month = Number(period.slice(5, 7));
      const season = [10, 11, 12, 3, 4, 5].includes(month) ? 1.12 : [1, 2, 7].includes(month) ? 0.88 : 1;
      const count = Math.max(4, Math.round(SO_PER_MONTH[c.code]! * DENSITY[yearOf(period)]! * season));
      for (let i = 0; i < count; i++) {
        const cust = rng.pick(custs);
        const date = rng.pick(days);
        const exportOrder = Boolean(cust.foreign);
        const pool = exportOrder
          ? catalog.filter((p) => p.usd)
          : catalog.filter((p) => !p.material && (!p.usd || rng.chance(0.3)));
        const lines: Order["lines"] = [];
        for (const p of rng.sample(pool, rng.int(1, exportOrder ? 2 : 5))) {
          let qty = qtyFor(p, exportOrder);
          if (p.type !== "service") {
            const have = stock.get(p.sku)!;
            if (have < qty) qty = Math.floor(have * 0.5);
            if (qty <= 0) continue;
            stock.set(p.sku, have - qty);
          }
          lines.push({ sku: p.sku, qty });
        }
        if (lines.length)
          orders.push({
            kind: "SO",
            company: c.code,
            no: nextNo("SO", c.code),
            partner: cust.name,
            date,
            lines,
            pricelist: exportOrder ? "Ekspor USD" : "",
          });
      }
    }
  };
  const restockFor = (c: CompanyDef, period: string) => {
    const catalog = products[c.code]!;
    const days = WORKDAYS.filter((d) => d.startsWith(period));
    // Pembelian ulang di awal & pertengahan bulan untuk barang yang menipis.
    const sups = partners.filter((p) => p.company === c.code && p.supplier);
    for (const day of [days[1]!, days[Math.floor(days.length / 2)]!]) {
      // Barang produksi sendiri diisi lewat order produksi, bukan dibeli dari pemasok.
      const low = catalog.filter(
        (p) => p.type !== "service" && !MADE.has(p.sku) && stock.get(p.sku)! < (p.stock ?? 0) * 0.8,
      );
      for (let k = 0; k < low.length; k += 4) {
        const chunk = low.slice(k, k + 4);
        const sup = rng.pick(sups.filter((s) => !s.foreign || c.code === "PTN" || c.code === "AGT"));
        orders.push({
          kind: "PO",
          company: c.code,
          no: nextNo("PO", c.code),
          partner: sup.name,
          date: day,
          lines: chunk.map((p) => ({
            sku: p.sku,
            qty: Math.max(1, Math.round((p.stock ?? 10) * (p.material || BOM_INPUTS.has(p.sku) ? 3 : 1.5))),
          })),
        });
        for (const p of chunk)
          stock.set(
            p.sku,
            stock.get(p.sku)! +
              Math.max(1, Math.round((p.stock ?? 10) * (p.material || BOM_INPUTS.has(p.sku) ? 3 : 1.5))),
          );
      }
    }
  };
  // Transaksi antar-perusahaan: jasa manajemen holding tiap bulan; jasa & barang antar-anak usaha bulanan sejak 2025,
  // triwulanan sebelumnya.
  const icFor = (period: string) => {
    const date = WORKDAYS.find((d) => d.startsWith(period) && d >= `${period}-05`)!;
    const monthly = period >= "2025-01" || ["03", "06", "09", "12"].includes(period.slice(5));
    for (const sub of SUBS) {
      orders.push({
        kind: "SO",
        company: HOLDING.code,
        no: nextNo("SO", HOLDING.code),
        partner: sub.name,
        date,
        lines: [
          { sku: "DPA-JS-001", qty: 1 },
          ...(sub.code === "PTN" ? [] : [{ sku: "DPA-JS-003", qty: 1 }]),
        ],
        ic: sub.code,
      });
    }
    if (!monthly) return;
    for (const buyer of ["BUI", "YHN", "PTN"]) {
      orders.push({
        kind: "SO",
        company: "AGT",
        no: nextNo("SO", "AGT"),
        partner: COMPANIES.find((x) => x.code === buyer)!.name,
        date: addDays(date, 1),
        lines: [
          { sku: "AGT-JS-003", qty: 1 },
          { sku: "AGT-JS-004", qty: 1 },
        ],
        ic: buyer,
      });
    }
    // Antar-perusahaan hanya sebanyak stok yang ada (sisanya menunggu pembelian ulang).
    const icLines = (skus: string[], qty: number) =>
      skus
        .map((sku) => ({ sku, qty: Math.min(qty, roundTo(stock.get(sku)! * 0.5, 50)) }))
        .filter((l) => l.qty > 0);
    const benih = icLines(["BUI-JG-005", "BUI-PL-001", "BUI-PL-002"], 300);
    for (const l of benih) stock.set(l.sku, stock.get(l.sku)! - l.qty);
    if (benih.length)
      orders.push({
        kind: "SO",
        company: "BUI",
        no: nextNo("SO", "BUI"),
        partner: "PT Perdagangan Tani",
        date: addDays(date, 2),
        lines: benih,
        ic: "PTN",
      });
    const herbs = icLines(["PTN-EX-013", "PTN-EX-014"], 1500);
    for (const l of herbs) stock.set(l.sku, stock.get(l.sku)! - l.qty);
    if (herbs.length)
      orders.push({
        kind: "SO",
        company: "PTN",
        no: nextNo("SO", "PTN"),
        partner: "PT Yuyun Herbal Nusantara",
        date: addDays(date, 3),
        lines: herbs,
        ic: "YHN",
      });
  };
  // Order produksi: barang jadi yang menipis diproduksi dari bahan yang tersedia (dua kali sebulan sejak 2025,
  // sebulan sekali sebelumnya). Bahan yang terpakai ikut menipis lalu dibeli ulang oleh restockFor.
  const moCounter: Record<string, number> = {};
  const produceFor = (c: CompanyDef, period: string) => {
    const boms = BOMS[c.code];
    if (!boms) return;
    const days = WORKDAYS.filter((d) => d.startsWith(period));
    const runs = period >= "2025-01" ? [0.3, 0.7] : [0.45];
    for (const f of runs) {
      const date = days[Math.floor(days.length * f)]!;
      for (const b of boms) {
        const base = products[c.code]!.find((p) => p.sku === b.sku)!.stock ?? 0;
        if (stock.get(b.sku)! >= base * 0.9) continue;
        let qty = Math.max(100, roundTo((base * 1.1) / runs.length, 100));
        for (const [sku, per] of b.lines) qty = Math.min(qty, Math.floor(stock.get(sku)! / per) * 100);
        if (qty < 100) continue;
        for (const [sku, per] of b.lines) stock.set(sku, stock.get(sku)! - (per * qty) / 100);
        stock.set(b.sku, stock.get(b.sku)! + qty);
        moCounter[c.code] = (moCounter[c.code] ?? 0) + 1;
        add("Produksi", {
          company: c.code,
          orderNo: `MO-${c.code}-${pad(moCounter[c.code]!, 4)}`,
          sku: b.sku,
          quantity: qty,
          date,
        });
      }
    }
  };

  // Simulasi stok per bulan berurutan: penjualan ke pelanggan, lalu antar-perusahaan, lalu pembelian ulang
  // (barang beli ulang baru tiba setelah transaksi awal bulan), sehingga stok tidak pernah kurang saat dikirim.
  for (const period of PERIODS) {
    for (const c of SUBS) sellFor(c, period);
    icFor(period);
    for (const c of SUBS) produceFor(c, period);
    for (const c of SUBS) restockFor(c, period);
  }
  for (const s of stock.entries()) if (s[1] < 0) throw new Error(`Stok minus ${s[0]}: ${s[1]}`);
  orders.sort((a, b) => (a.date === b.date ? a.no.localeCompare(b.no) : a.date.localeCompare(b.date)));
  const termOf = (company: string, name: string) =>
    partners.find((p) => p.company === company && p.name === name)?.term ?? "Net 30 hari";
  for (const o of orders) {
    const sheet = o.kind === "SO" ? "Penjualan" : "Pembelian";
    // Antar-perusahaan: tanggal faktur & bayar sama dengan tagihan sisi pembeli agar saldo IC cocok.
    const ship = o.ic ? addDays(o.date, 3) : addDays(o.date, rng.int(1, 3));
    const invoice = o.ic ? ship : addDays(ship, o.kind === "SO" ? 0 : rng.int(0, 2));
    const termDays = TERMS[termOf(o.company, o.partner)] ?? 30;
    const payDate = o.ic ? addDays(o.date, 25) : addDays(invoice, Math.max(0, termDays + rng.int(-5, 10)));
    const paid = payDate <= TX_TO && (Boolean(o.ic) || rng.chance(0.88));
    add(sheet, {
      company: o.company,
      orderNo: o.no,
      partner: o.partner,
      dateOrder: o.date,
      pricelist: o.pricelist ?? "",
      intercompany: o.ic ?? "",
      deliveryDate: ship <= TX_TO ? ship : "",
      invoiceDate: ship <= TX_TO ? invoice : "",
      paymentDate: paid && ship <= TX_TO ? payDate : "",
    });
    for (const l of o.lines)
      add(`${sheet} - Baris`, { company: o.company, orderNo: o.no, sku: l.sku, quantity: l.qty });
  }
  // Pembelian sisi pembeli untuk transaksi antar-perusahaan (tagihan dari anggota grup).
  for (const o of orders.filter((x) => x.ic)) {
    const seller = COMPANIES.find((x) => x.code === o.company)!;
    add("Tagihan Antar-Perusahaan", {
      company: o.ic!,
      vendor: seller.name,
      ref: o.no,
      date: addDays(o.date, 3),
      description: o.lines
        .map((l) => `${products[o.company]!.find((p) => p.sku === l.sku)!.name} × ${l.qty}`)
        .join("; "),
      amount: o.lines.reduce(
        (s, l) => s + products[o.company]!.find((p) => p.sku === l.sku)!.price * l.qty,
        0,
      ),
      accountCode: o.company === "DPA" ? "6-7000" : o.company === "AGT" ? "6-5000" : "5-1000",
      paymentDate: addDays(o.date, 25) <= TX_TO ? addDays(o.date, 25) : "",
    });
  }

  // ---- Saldo awal 1 Jan 2021 ----
  const assetDefs: Record<string, [string, string, string, number, number][]> = {
    DPA: [
      ["Bangunan Kantor Agro Tower Lt. 18", "1-2300", "1-2390", 18_000_000_000, 240],
      ["Peralatan Kantor & Server Grup", "1-2100", "1-2190", 1_450_000_000, 48],
      ["Kendaraan Direksi (3 unit)", "1-2200", "1-2290", 2_100_000_000, 60],
    ],
    BUI: [
      ["Tanah Kebun Benih Karawang 12 ha", "1-2050", "", 9_600_000_000, 0],
      ["Gudang & Pabrik Pengolahan Benih", "1-2300", "1-2390", 7_500_000_000, 240],
      ["Mesin Sortir & Pengering Benih", "1-2400", "1-2490", 3_200_000_000, 96],
      ["Laboratorium Uji Benih", "1-2100", "1-2190", 850_000_000, 60],
      ["Truk Engkel & Pickup Distribusi", "1-2200", "1-2290", 1_350_000_000, 60],
    ],
    AGT: [
      ["Workshop & Kantor Gedebage", "1-2300", "1-2390", 6_800_000_000, 240],
      ["Server GPU Pelatihan Model AI", "1-2100", "1-2190", 2_400_000_000, 36],
      ["Armada Drone Demo & Jasa", "1-2400", "1-2490", 1_950_000_000, 48],
      ["Mobil Servis Lapangan", "1-2200", "1-2290", 1_100_000_000, 60],
    ],
    PTN: [
      ["Gudang Ekspor Tanjung Priok", "1-2300", "1-2390", 12_500_000_000, 240],
      ["Gudang Komoditas Makassar", "1-2300", "1-2390", 4_200_000_000, 240],
      ["Forklift & Timbangan Truk", "1-2400", "1-2490", 1_650_000_000, 96],
      ["Truk Kontainer 20 ft (2 unit)", "1-2200", "1-2290", 2_300_000_000, 96],
    ],
    YHN: [
      ["Tanah & Kebun Herbal Bogor 6 ha", "1-2050", "", 4_800_000_000, 0],
      ["Pabrik Herbal CPOTB Colomadu", "1-2300", "1-2390", 8_900_000_000, 240],
      ["Mesin Ekstraksi & Pengisian Kapsul", "1-2400", "1-2490", 3_750_000_000, 96],
      ["Mobil Box Distribusi", "1-2200", "1-2290", 780_000_000, 60],
    ],
  };
  for (const c of COMPANIES) {
    for (const [name, account, accum, cost, life] of assetDefs[c.code]!)
      if (life)
        add("Aset Tetap", {
          company: c.code,
          name,
          assetAccount: account,
          depreciationAccount: accum,
          expenseAccount: "6-4000",
          acquisitionDate: OPENING_DATE,
          firstDepreciationDate: "2021-01-31",
          cost,
          usefulLifeMonths: life,
          salvageValue: 0,
        });
    const lines: Row[] = [];
    const line = (accountCode: string, debit: number, credit: number, name: string, partner = "") =>
      lines.push({ company: c.code, accountCode, partner, debit, credit, name });
    line("1-1100", c.cash, 0, "Kas kecil kantor");
    line("1-1200", c.bank, 0, "Rekening giro operasional");
    for (const [name, account, , cost] of assetDefs[c.code]!) line(account, cost, 0, name);
    const custs = partners.filter((p) => p.company === c.code && p.customer && !p.foreign);
    let ar = 0;
    for (const p of rng.sample(custs, Math.min(6, custs.length))) {
      const v = roundTo(rng.int(25_000_000, 380_000_000), 500_000);
      ar += v;
      line("1-1300", v, 0, "Piutang usaha saldo awal", p.name);
    }
    const sups = partners.filter((p) => p.company === c.code && p.supplier && !p.foreign);
    let ap = 0;
    for (const p of rng.sample(sups, Math.min(4, sups.length))) {
      const v = roundTo(rng.int(20_000_000, 260_000_000), 500_000);
      ap += v;
      line("2-1100", 0, v, "Utang usaha saldo awal", p.name);
    }
    const inventory = products[c.code]!.filter((p) => p.type !== "service").reduce(
      (s, p) => s + (p.stock ?? 0) * p.cost,
      0,
    );
    // Stok awal dibukukan oleh penyesuaian stok (Dr Persediaan, Kr Selisih Persediaan); dibalik di sini.
    if (inventory) line("5-1200", inventory, 0, "Pembalik selisih persediaan stok awal");
    let investments = 0;
    if (c.holding)
      for (const s of SUBS) {
        investments += s.capital;
        line("1-3100", s.capital, 0, `Investasi pada ${s.name}`);
      }
    const loan = c.code === "AGT" ? 4_000_000_000 : c.code === "PTN" ? 6_500_000_000 : 0;
    if (loan) line("2-2100", 0, loan, "Kredit investasi bank");
    const assets =
      c.cash + c.bank + ar + inventory + investments + assetDefs[c.code]!.reduce((s, a) => s + a[3], 0);
    line("3-1000", 0, c.capital, "Modal disetor");
    line("3-2000", 0, assets - ap - loan - c.capital, "Saldo laba ditahan s.d. 2020");
    for (const l of lines) add("Saldo Awal", l);
  }

  // ---- Anggaran tahunan 2021–2026 (tumbuh mengikuti volume usaha) ----
  for (const c of COMPANIES)
    for (const year of YEARS) {
      const growth = c.holding ? 0.7 + 0.06 * (year - 2021) : DENSITY[year]! * 1.05;
      const revenue =
        (c.holding
          ? 2_900_000_000
          : products[c.code]!.reduce((sum, p) => sum + p.price * (p.stock ?? 5), 0) * 1.4) * growth;
      for (const [code, share] of [
        ["4-1000", 1],
        ["5-1000", -0.62],
        ["6-1000", -0.14],
        ["6-5000", -0.03],
        ["6-6000", -0.025],
        ["6-8000", -0.008],
        ["6-4000", -0.02],
      ] as const)
        add("Anggaran", {
          company: c.code,
          budget: `Anggaran ${c.code} ${year}`,
          year,
          accountCode: c.holding && code === "4-1000" ? "4-1100" : code,
          amount: roundTo(revenue * Math.abs(share), 1_000_000),
        });
    }
  for (const c of COMPANIES)
    for (const year of YEARS)
      for (const dept of c.departments)
        for (let month = 1; month <= 12; month++) {
          const day = `${year}-${pad(month, 2)}-15`;
          const staff = employees.filter((e) => e.company === c && e.department === dept && activeOn(e, day));
          const cost = staff.reduce(
            (sum, e) => sum + (e.daily ? wageIn(e, year) * 22 : wageIn(e, year)) * 1.18,
            0,
          );
          add("Anggaran Tenaga Kerja", {
            company: c.code,
            year,
            department: dept,
            month,
            headcount: staff.length + (month >= 9 && dept.includes("Penjualan") ? 1 : 0),
            cost: roundTo(cost * (month >= 9 ? 1.04 : 1), 100_000),
          });
        }

  // ---- CRM, rekrutmen, armada, pengguna ----
  const stages = ["Baru", "Kualifikasi", "Proposal", "Negosiasi", "Menang"];
  for (const c of SUBS) {
    const sellers = employees.filter((e) => e.company === c && e.sales);
    for (const year of YEARS)
      for (let i = 0; i < (year === 2026 ? 35 : Math.round(30 * DENSITY[year]! + 6)); i++) {
        // Peluang tahun lalu sudah selesai (menang/kalah); tahun berjalan masih di berbagai tahap.
        const closed = year < 2026 || rng.chance(0.2);
        const prospect = `${rng.pick(["PT", "CV", "UD", "Koperasi", "Gapoktan"])} ${rng.pick(["Agro", "Tani", "Bumi", "Hijau", "Lestari", "Makmur", "Subur", "Nusa"])} ${rng.pick(["Sejahtera", "Mandiri", "Jaya", "Abadi", "Prima", "Sentosa"])} ${rng.pick(CITIES)[0]}`;
        add("Prospek CRM", {
          company: c.code,
          name: `Peluang ${rng.pick(products[c.code]!).name.split(" — ")[0]} — ${prospect}`,
          partnerName: prospect,
          contactName: `${rng.pick(FIRST_MALE)} ${rng.pick(LAST)}`,
          email: `${slug(prospect).replace(/\./g, "").slice(0, 20)}@contoh.co.id`,
          phone: `08${rng.int(11, 99)}${rng.digits(8)}`,
          stage: closed
            ? rng.chance(0.42)
              ? "Menang"
              : "Kalah"
            : rng.weighted(stages.slice(0, 4).map((s, k) => [s, 5 - k * 0.8] as const)),
          expectedRevenue: roundTo(
            rng.int(15_000_000, 900_000_000) * (0.6 + 0.4 * DENSITY[year]!),
            5_000_000,
          ),
          expectedClose:
            year < 2026
              ? `${year}-${pad(rng.int(1, 12), 2)}-${pad(rng.int(1, 28), 2)}`
              : addDays(TX_TO, rng.int(-40, 75)),
          salesperson: (() => {
            const pool = sellers.filter((e) => activeOn(e, `${year}-06-30`));
            return pool.length ? rng.pick(pool).number : "";
          })(),
          source: rng.pick(["referral", "website", "event", "cold_call", "ads"]),
        });
      }
  }
  for (const c of COMPANIES)
    for (const year of YEARS)
      for (const job of rng.sample(
        c.jobs.filter((j) => j.grade >= "B1" && j.grade <= "C2"),
        year >= 2025 ? 2 : 1,
      )) {
        const g = GRADES.find((x) => x.code === job.grade)!;
        const opening = `${job.name} — ${c.branches[0]!.city} ${year}`;
        const open = year === 2026 ? "2026-08-03" : `${year}-${pad(rng.int(1, 9), 2)}-0${rng.int(1, 9)}`;
        add("Lowongan", {
          company: c.code,
          name: opening,
          job: job.name,
          department: job.department,
          quota: rng.int(1, 3),
          dateOpen: open,
          targetDate: year === 2026 ? "2026-11-30" : addDays(open, 90),
          wageMin: g.min,
          wageMax: g.max,
        });
        for (let k = 0; k < rng.int(6, 12); k++) {
          const female = rng.chance(0.45);
          const name = `${rng.pick(female ? FIRST_FEMALE : FIRST_MALE)} ${rng.pick(LAST)}`;
          add("Pelamar", {
            company: c.code,
            opening,
            name,
            email: `${slug(name)}${rng.int(1, 99)}@gmail.com`,
            phone: `08${rng.int(11, 99)}${rng.digits(8)}`,
            source: rng.pick(["jobportal", "referral", "website", "walkin"]),
            expectedWage: roundTo(rng.int(g.min, g.max), 250_000),
            // Lowongan tahun lalu sudah diproses: pelamar sampai tahap akhir.
            stage: rng.weighted(
              year < 2026
                ? ([
                    ["screening", 3],
                    ["interview", 3],
                    ["offer", 2],
                  ] as const)
                : ([
                    ["new", 4],
                    ["screening", 3],
                    ["interview", 2],
                    ["offer", 1],
                  ] as const),
            ),
            consent: true,
          });
        }
      }
  const fleetModels = [
    ["Mitsubishi", "L300 Pickup", "truck"],
    ["Toyota", "Hilux Double Cabin", "car"],
    ["Isuzu", "Elf NMR 71", "truck"],
    ["Daihatsu", "Gran Max Blind Van", "car"],
    ["Toyota", "Innova Zenix", "car"],
    ["Honda", "Vario 160", "motorcycle"],
  ] as const;
  for (const [brand, model, cat] of fleetModels)
    add("Armada - Model", { manufacturer: brand, model, category: cat });
  const plates: Record<string, string> = { DPA: "B", BUI: "T", AGT: "D", PTN: "B", YHN: "AD" };
  for (const c of COMPANIES) {
    const drivers = employees.filter(
      (e) => e.company === c && (e.job === "Pengemudi" || e.field) && !e.daily && !e.resignDate,
    );
    for (let i = 0; i < (c.holding ? 3 : rng.int(5, 8)); i++) {
      const [brand, model] = c.holding ? (["Toyota", "Innova Zenix"] as const) : rng.pick(fleetModels);
      const year = rng.int(2019, 2025);
      add("Armada - Kendaraan", {
        company: c.code,
        licensePlate:
          `${plates[c.code]} ${rng.int(1000, 9899)} ${rng.pick(["AB", "CD", "KL", "MN", "PQ", "XY", "ZZ"])}${rng.pick(["", "A", "B"])}`.trim(),
        manufacturer: brand,
        model,
        modelYear: year,
        color: rng.pick(["Putih", "Hitam", "Silver", "Abu-abu"]),
        driver: drivers.length ? rng.pick(drivers).number : "",
        purchaseValue: brand === "Honda" ? 28_000_000 : roundTo(rng.int(220_000_000, 520_000_000), 1_000_000),
        stnkExpiry: `${2027 + rng.int(0, 3)}-${pad(rng.int(1, 12), 2)}-${pad(rng.int(1, 28), 2)}`,
        taxDueDate: `2026-${pad(rng.int(11, 12), 2)}-${pad(rng.int(1, 28), 2)}`,
        branch: rng.pick(c.branches).code,
      });
    }
  }
  // ---- Armada: servis berkala, perbaikan & odometer sejak kendaraan terdaftar ----
  for (const vr of m["Armada - Kendaraan"]!) {
    const v = {
      company: String(vr.company),
      licensePlate: String(vr.licensePlate),
      model: String(vr.model),
      modelYear: Number(vr.modelYear),
    };
    const registered = `${v.modelYear}-03-01`;
    const from = registered > TX_FROM ? registered : TX_FROM;
    let km =
      registered >= TX_FROM
        ? rng.int(10, 300)
        : (2021 - Number(v.modelYear)) * 20_000 + rng.int(1_000, 9_000);
    const perMonth = v.model === "Vario 160" ? rng.int(600, 1_200) : rng.int(1_500, 3_200);
    let nextService = addDays(from, rng.int(30, 170));
    for (const period of PERIODS.filter((p) => `${p}-28` >= from)) {
      const prevKm = km;
      km += Math.round(perMonth * (0.85 + rng.next() * 0.3));
      // Odometer saat servis (pertengahan bulan) di antara pembacaan bulan lalu & akhir bulan ini.
      const midKm = prevKm + Math.round((km - prevKm) * 0.5);
      const day = WORKDAYS.find((d) => d.startsWith(period) && d >= `${period}-25`) ?? monthEnd(period);
      // Odometer bulanan sejak 2025, triwulanan sebelumnya.
      if (period >= "2025-01" || ["03", "06", "09", "12"].includes(period.slice(5)))
        add("Armada - Odometer", { company: v.company, licensePlate: v.licensePlate, date: day, value: km });
      const serviceDay = WORKDAYS.find((d) => d.startsWith(period) && d >= `${period}-10`);
      if (serviceDay && serviceDay >= nextService) {
        const [type, , cost] = FLEET_SERVICE_TYPES[0]!;
        add("Armada - Servis", {
          company: v.company,
          licensePlate: v.licensePlate,
          serviceType: type,
          date: serviceDay,
          odometer: midKm,
          cost: roundTo(cost * (1 + (yearOf(period) - 2021) * 0.04) * (0.9 + rng.next() * 0.2), 5000),
          description: "Ganti oli, filter & pemeriksaan umum",
        });
        nextService = addDays(serviceDay, rng.int(160, 200));
      } else if (serviceDay && rng.chance(0.03)) {
        const [type, , cost] = rng.pick(FLEET_SERVICE_TYPES.slice(1));
        add("Armada - Servis", {
          company: v.company,
          licensePlate: v.licensePlate,
          serviceType: type,
          date: serviceDay,
          odometer: midKm,
          cost: roundTo(cost * (0.85 + rng.next() * 0.3), 5000),
          description: type,
        });
      }
    }
  }

  // ---- Maintenance: perawatan preventif sesuai rencana & kerusakan korektif ----
  const workdayOnOrAfter = (date: string) => WORKDAYS.find((d) => d >= date);
  for (const c of COMPANIES)
    for (const eq of EQUIPMENT[c.code] ?? []) {
      for (
        let due = addDays(TX_FROM, rng.int(3, eq.plan.intervalDays));
        due <= TX_TO;
        due = addDays(due, eq.plan.intervalDays)
      ) {
        const day = workdayOnOrAfter(due);
        if (!day || day > TX_TO) break;
        add("Maintenance", {
          company: c.code,
          equipment: eq.code,
          kind: "preventive",
          title: eq.plan.name,
          priority: "normal",
          scheduledDate: day,
          finishedAt: `${day}T${pad(rng.int(9, 15), 2)}:${pad(rng.int(0, 59), 2)}:00+07:00`,
          hours: eq.plan.hours,
          cost: 0,
          resolution: "Perawatan selesai sesuai checklist",
        });
      }
      for (const period of PERIODS) {
        if (!rng.chance(eq.criticality === "high" ? 0.1 : 0.07)) continue;
        const day = rng.pick(WORKDAYS.filter((d) => d.startsWith(period)));
        const [title, hours, cost] = rng.pick(BREAKDOWNS);
        add("Maintenance", {
          company: c.code,
          equipment: eq.code,
          kind: "corrective",
          title,
          priority: eq.criticality === "high" ? "high" : "normal",
          scheduledDate: day,
          breakdownAt: `${day}T${pad(rng.int(7, 11), 2)}:${pad(rng.int(0, 59), 2)}:00+07:00`,
          finishedAt: `${day}T${pad(rng.int(13, 17), 2)}:${pad(rng.int(0, 59), 2)}:00+07:00`,
          hours,
          cost: roundTo(cost * (0.8 + rng.next() * 0.5), 5000),
          resolution: `Perbaikan: ${title.toLowerCase()} — komponen diganti, mesin normal kembali`,
        });
      }
    }

  // ---- Layanan pelanggan: tiket per bulan (makin ramai mendekati 2026) ----
  for (const c of SUBS) {
    const topics = SUPPORT_TOPICS[c.code] ?? [];
    const custs = partners.filter((p) => p.company === c.code && p.customer && !p.foreign);
    if (!topics.length || !custs.length) continue;
    for (const period of PERIODS) {
      const n = Math.round(rng.int(4, 9) * DENSITY[yearOf(period)]!);
      for (let i = 0; i < n; i++) {
        const day = rng.pick(WORKDAYS.filter((d) => d.startsWith(period)));
        const [category, subject, reply] = rng.pick(topics);
        const at = (date: string, h: number, min: number) =>
          new Date(`${date}T${pad(h, 2)}:${pad(min, 2)}:00+07:00`);
        const received = at(day, rng.int(8, 16), rng.int(0, 59));
        const replied = new Date(received.getTime() + rng.int(1, 20) * 3_600_000);
        const resolved = new Date(replied.getTime() + rng.int(0, 72) * 3_600_000);
        // Tiket akhir Oktober 2026 sebagian masih terbuka.
        const open = period === "2026-10" && rng.chance(0.4);
        add("Tiket Layanan", {
          company: c.code,
          partner: rng.pick(custs).name,
          category,
          subject,
          channel: rng.weighted([
            ["phone", 4],
            ["email", 4],
            ["chat", 3],
            ["portal", 1],
          ] as const),
          priority: rng.weighted([
            ["low", 2],
            ["normal", 6],
            ["high", 2],
            ["urgent", 1],
          ] as const),
          receivedAt: received.toISOString(),
          reply,
          repliedAt: replied.toISOString(),
          resolvedAt: open ? "" : resolved.toISOString(),
        });
      }
    }
  }

  const userRoles = [
    ["direktur", "Direktur", "dir"],
    ["keuangan", "Keuangan", "fin"],
    ["sdm", "SDM", "hr"],
    ["penjualan", "Penjualan", "sales"],
  ] as const;
  for (const c of COMPANIES)
    for (const [key, label, role] of userRoles) {
      if (c.holding && key === "penjualan") continue;
      add("Pengguna", {
        company: c.code,
        name: `${label} ${c.code}`,
        email: `${key}.${c.code.toLowerCase()}@${EMAIL_DOMAIN}`,
        password: DEMO_PASSWORD,
        role,
      });
    }
  // Kepala departemen (termasuk direktur sebagai atasan para manajer) punya akun sendiri yang tertaut ke data
  // karyawannya, agar pengingat serah terima, peringatan dini, dan eskalasi ke atasan punya penerima.
  const headRole = (d: string) =>
    d === "Direksi"
      ? "dir"
      : /Keuangan/.test(d)
        ? "fin"
        : /SDM/.test(d)
          ? "hr"
          : /Penjualan/.test(d)
            ? "sales"
            : /Gudang/.test(d)
              ? "wh"
              : /Mutu/.test(d)
                ? "qc"
                : "ops";
  const linked = new Set<string>();
  for (const row of m["Departemen"]!) {
    const head = employees.find((e) => e.number === row.managerNumber);
    if (!head || linked.has(head.number)) continue;
    linked.add(head.number);
    add("Pengguna", {
      company: String(row.company),
      name: head.name,
      email: `kepala.${slug(String(row.name))}.${String(row.company).toLowerCase()}@${EMAIL_DOMAIN}`,
      password: DEMO_PASSWORD,
      role: headRole(String(row.name)),
      employeeNumber: head.number,
    });
  }
  add("Pengguna", {
    company: "*",
    name: "Admin Grup",
    email: `admin@${EMAIL_DOMAIN}`,
    password: DEMO_PASSWORD,
    role: "admin",
  });

  // ---- Payroll run ----
  for (const c of COMPANIES)
    for (const period of PERIODS)
      add("Payroll", {
        company: c.code,
        period,
        paymentDate: `${period}-25`,
        name: `Gaji ${periodLabel(period)}`,
        post: true,
        pay: true,
      });

  // ---- THR keagamaan: dibayar di payroll terakhir sebelum Idul Fitri ----
  for (const [year, date] of Object.entries(IDUL_FITRI)) {
    // Payroll dibayar tanggal 25: hari raya ≤ tanggal 25 → THR ikut payroll bulan sebelumnya.
    const month = Number(date.slice(5, 7)) - (Number(date.slice(8, 10)) <= 25 ? 1 : 0);
    const period = `${year}-${pad(month, 2)}`;
    if (!PERIODS.includes(period)) continue;
    for (const c of COMPANIES)
      add("THR", {
        company: c.code,
        period,
        holidayDate: date,
        holiday: `Idul Fitri ${HIJRI[Number(year)]} H`,
      });
  }

  // ---- Rekening koran bulanan: biaya administrasi, bunga jasa giro & pajak bunga ----
  for (const c of COMPANIES)
    for (const period of PERIODS) {
      const end = monthEnd(period);
      const fee = rng.pick([15_000, 25_000, 30_000, 50_000]);
      const interest = roundTo(
        (c.bank / 1000) * (0.8 + rng.next() * 0.5) * (0.7 + DENSITY[yearOf(period)]! * 0.6),
        100,
      );
      add("Rekening Koran", {
        company: c.code,
        period,
        date: end,
        description: "Biaya administrasi rekening",
        amount: -fee,
        kind: "fee",
      });
      add("Rekening Koran", {
        company: c.code,
        period,
        date: end,
        description: "Bunga jasa giro",
        amount: interest,
        kind: "interest",
      });
      add("Rekening Koran", {
        company: c.code,
        period,
        date: end,
        description: "Pajak bunga jasa giro (20%)",
        amount: -roundTo(interest * 0.2, 1),
        kind: "tax",
      });
    }

  // ---- Penilaian kinerja tahunan 2021–2025 (karyawan yang masih bekerja) ----
  for (const year of CLOSED_YEARS)
    for (const e of employees) {
      if (e.resignDate || e.daily || e.joinDate > `${year}-09-30`) continue;
      const score = rng.weighted([
        [2.5, 1],
        [3, 4],
        [3.5, 6],
        [4, 5],
        [4.5, 2],
      ] as const);
      add("Penilaian Kinerja", {
        company: e.company.code,
        year,
        employeeNumber: e.number,
        score,
        rating: score >= 4.5 ? "A" : score >= 4 ? "B" : score >= 3 ? "C" : "D",
        raisePercent: score >= 4.5 ? 8 : score >= 4 ? 6 : score >= 3 ? 4 : 2,
      });
    }

  // ---- Pelatihan & sasaran tahunan ----
  for (const c of COMPANIES)
    for (const year of YEARS)
      for (const [name, provider, cost, months] of rng.sample(TRAININGS, year >= 2025 ? 4 : 2)) {
        const start = WORKDAYS.find(
          (d) => d >= `${year}-${pad(rng.int(2, year === 2026 ? 9 : 11), 2)}-${pad(rng.int(1, 20), 2)}`,
        )!;
        const people = rng
          .sample(
            employees.filter((e) => e.company === c && !e.daily && !e.resignDate && e.joinDate < start),
            rng.int(5, 14),
          )
          .map((e) => e.number);
        if (!people.length) continue;
        add("Pelatihan", {
          company: c.code,
          name: `${name} ${year}`,
          provider,
          dateStart: start,
          dateEnd: addDays(start, rng.int(0, 2)),
          cost: roundTo(cost * people.length * (0.9 + (year - 2021) * 0.04), 50_000),
          certificateMonths: months,
          participants: people.join(" "),
          done: start < "2026-10-15",
        });
      }
  for (const c of COMPANIES)
    for (const year of YEARS)
      for (const dept of rng.sample(c.departments, Math.min(3, c.departments.length))) {
        const [title, metric, target, unit] = rng.pick(GOALS);
        const achieved =
          year < 2026
            ? Math.round(target * (0.75 + rng.next() * 0.4))
            : Math.round(target * (0.3 + rng.next() * 0.5));
        add("Sasaran", {
          company: c.code,
          year,
          department: dept,
          title: `${title} ${year}`,
          metric,
          target,
          achieved,
          unit,
        });
      }

  // ---- Aktivitas CRM pada peluang (telepon, rapat, email) ----
  for (const lead of m["Prospek CRM"] ?? []) {
    const close = String(lead.expectedClose);
    for (let i = 0; i < rng.int(1, 3); i++) {
      const type = rng.pick(["call", "meeting", "email"] as const);
      const due = addDays(close, -rng.int(5, 60));
      add("Aktivitas CRM", {
        company: String(lead.company),
        lead: String(lead.name),
        activityType: type,
        summary:
          type === "call"
            ? "Telepon tindak lanjut kebutuhan"
            : type === "meeting"
              ? "Rapat presentasi & demo produk"
              : "Kirim penawaran & brosur",
        dueDate: due > "2026-11-30" ? "2026-11-30" : due,
        done: due < "2026-11-01",
      });
    }
  }

  // ---- Tutup buku tahunan 2021–2025 (jurnal penutup laba rugi ke laba ditahan) ----
  for (const c of COMPANIES)
    for (const year of CLOSED_YEARS) add("Tutup Buku", { company: c.code, fiscalYear: year });

  return m;
}

export { monthEnd };
