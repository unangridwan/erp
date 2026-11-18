#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-explicit-any -- respons API berupa JSON tanpa tipe. */
/**
 * `pnpm demo:load` — muat data simulasi PT Didin Putra Agro ke ERP lewat API (aturan bisnis, jurnal & hak akses
 * tetap berlaku). Tiap tahap aman dijalankan ulang: data yang sudah ada (berdasarkan kode/nama/referensi) dilewati.
 *
 *   pnpm demo:load [-- --api http://localhost:3001 --slug didin-putra-agro --email admin@… --password … --file … --only tahap,tahap]
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Api, ApiError } from "./api.js";
import {
  buildModel,
  DEMO_PASSWORD,
  EMAIL_DOMAIN,
  monthEnd,
  OPENING_DATE,
  PERIODS,
  TX_TO,
  YEARS,
  type Model,
  type Row,
} from "./model.js";
import { num, readWorkbook, SHEETS, str, yes } from "./sheets.js";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith("--"))
    args.set(a.slice(2), process.argv[i + 1]?.startsWith("--") ? "true" : (process.argv[++i] ?? "true"));
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
/** Alamat API: --api, env, lalu NEXT_PUBLIC_API_URL/API_ORIGIN di .env root (sama dengan web), bawaan :3001. */
function envFileApi() {
  try {
    const text = readFileSync(join(root, ".env"), "utf8");
    for (const key of ["NEXT_PUBLIC_API_URL", "API_ORIGIN"]) {
      const m = text.match(new RegExp(`^${key}=(.+)$`, "m"));
      if (m?.[1]?.trim()) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* tanpa .env */
  }
  return undefined;
}
const API = (args.get("api") ?? process.env.API_URL ?? envFileApi() ?? "http://localhost:3001").replace(
  /\/+$/,
  "",
);
const SLUG = args.get("slug") ?? "didin-putra-agro";
const EMAIL = args.get("email") ?? `admin@${EMAIL_DOMAIN}`;
const PASSWORD = args.get("password") ?? DEMO_PASSWORD;
const FILE = args.get("file") ?? join(root, "demo/didin-putra-agro/Data-Simulasi-PT-Didin-Putra-Agro.xlsx");
const ONLY = args.get("only")?.split(",");

const api = new Api(API);
/** Surat keterangan dokter contoh (PDF satu halaman) untuk cuti sakit. */
const DOCTOR_NOTE = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 58>>stream\nBT /F1 12 Tf 20 150 Td (Surat keterangan sakit - contoh) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
).toString("base64");
const failures: string[] = [];
const started = Date.now();
const log = (msg: string) =>
  console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s] ${msg}`);
async function attempt<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    failures.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}
const csv = (columns: [string, string][], rows: Row[]) =>
  [
    columns.map(([, h]) => quote(h)).join(","),
    ...rows.map((r) =>
      columns.map(([k]) => quote(r[k] === true ? "ya" : r[k] === false ? "tidak" : str(r[k]))).join(","),
    ),
  ].join("\n");
const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const hrColumns = (sheet: string, extra: [string, string][] = []): [string, string][] => [
  ...SHEETS.find((s) => s.name === sheet)!
    .columns.filter(([k]) => k !== "company")
    .map(([k, h]) => [k, h] as [string, string]),
  ...extra,
];
const chunk = <T>(xs: T[], n: number) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// ---- Konteks hasil muat (ID per kode/nama) ----
const company: Record<string, string> = {};
const ctx: Record<
  string,
  {
    accounts: Map<string, string>;
    partners: Map<string, string>;
    products: Map<string, string>;
    employees: Map<string, string>;
    journals: Record<string, string>;
    warehouse: { id: string; locationId: string };
    taxes: { sale?: string; purchase?: string };
  }
> = {};

async function main() {
  const model: Model = existsSync(FILE) ? await readWorkbook(FILE) : buildModel();
  log(`Sumber data: ${existsSync(FILE) ? FILE : "model bawaan (workbook tidak ditemukan)"}`);
  const rows = (sheet: string, code?: string) =>
    (model[sheet] ?? []).filter((r) => !code || str(r.company) === code);
  const stage = async (name: string, fn: () => Promise<void>) => {
    if (ONLY && !ONLY.includes(name)) return;
    const before = failures.length;
    log(`▶ ${name}`);
    await fn();
    log(`✓ ${name}${failures.length > before ? ` (${failures.length - before} gagal)` : ""}`);
  };

  // ---- 0. Tunggu API hidup (mis. `pnpm dev` baru dijalankan) ----
  log(`Menghubungi API ${API} …`);
  let up = false;
  for (let i = 0; i < 30 && !up; i++) {
    up = await fetch(`${API}/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (!up) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!up) {
    console.error(
      `\nAPI tidak bisa dihubungi di ${API}.\n` +
        "Jalankan API dulu di terminal lain dan biarkan tetap berjalan:  pnpm dev\n" +
        "Tunggu sampai muncul tulisan API siap (port 3001), lalu ulangi:  pnpm demo:load\n" +
        "Bila API memakai alamat lain:  pnpm demo:load --api http://localhost:PORT\n",
    );
    process.exit(1);
  }

  // ---- 1. Login / daftar ----
  try {
    await api.login(EMAIL, PASSWORD, SLUG);
    log(`Login ke tenant ${SLUG}`);
  } catch (e) {
    if (!(e instanceof ApiError) || (e.status !== 401 && e.status !== 404 && e.status !== 400)) throw e;
    const holding = rows("Perusahaan").find((r) => !str(r.parent))!;
    const s = await api.post(
      "/auth/signup",
      {
        tenantSlug: SLUG,
        companyName: str(holding.name),
        name: "Admin Grup",
        email: EMAIL,
        password: PASSWORD,
      },
      null,
    );
    api.setSession(s);
    log(`Tenant baru ${SLUG} dibuat`);
  }

  await stage("perusahaan", async () => {
    const existing = await api.list("/companies");
    const holding = rows("Perusahaan").find((r) => !str(r.parent))!;
    const profile = (r: Row) => ({
      name: str(r.name),
      npwp: str(r.npwp),
      pkp: yes(r.pkp),
      street: str(r.street),
      city: str(r.city),
      province: str(r.province),
      postalCode: str(r.postalCode),
      phone: str(r.phone),
      email: str(r.email),
    });
    let hq =
      existing.find((c) => c.code === str(holding.code)) ??
      existing.find((c) => c.code === "HQ") ??
      existing[0];
    hq = await api.patch(`/companies/${hq.id}`, {
      code: str(holding.code),
      entityType: "holding",
      ...profile(holding),
    });
    company[str(holding.code)] = hq.id;
    for (const r of rows("Perusahaan").filter((x) => str(x.parent))) {
      const found = existing.find((c) => c.code === str(r.code));
      const body = {
        code: str(r.code),
        parentId: company[str(r.parent)],
        entityType: str(r.entityType) || "subsidiary",
        ...profile(r),
      };
      company[str(r.code)] = (
        found ? await api.patch(`/companies/${found.id}`, body) : await api.post("/companies", body)
      ).id;
    }
    const owns = await api.list("/ownerships");
    for (const r of rows("Perusahaan").filter((x) => str(x.parent))) {
      if (owns.some((o) => o.childCompanyId === company[str(r.code)])) continue;
      await attempt(`kepemilikan ${r.code}`, () =>
        api.post("/ownerships", {
          parentCompanyId: company[str(r.parent)],
          childCompanyId: company[str(r.code)],
          pct: num(r.ownershipPct) || 100,
          method: "full",
          validFrom: "2020-01-01",
          consideration: String(num(r.capital)),
          acquiredNetAssets: String(num(r.capital)),
        }),
      );
    }
  });
  if (!Object.keys(company).length) for (const c of await api.list("/companies")) company[c.code] = c.id;
  const codes = rows("Perusahaan").map((r) => str(r.code));

  // Konteks per perusahaan (dibaca ulang setiap tahap agar aman dijalankan sebagian).
  const refresh = async (code: string) => {
    const id = company[code]!;
    const [accounts, partners, products, employees, journals, warehouses, taxes] = await Promise.all([
      api.list("/accounts", id),
      api.list("/partners", id),
      api.list("/products", id),
      api.list("/employees?active=all", id),
      api.list("/journals", id),
      api.list("/warehouses", id),
      api.list("/taxes", id),
    ]);
    ctx[code] = {
      accounts: new Map(accounts.map((a) => [a.code, a.id])),
      partners: new Map(
        partners.filter((p) => !p.companyId || p.companyId === id).map((p) => [p.name, p.id]),
      ),
      products: new Map(products.filter((p) => !p.companyId || p.companyId === id).map((p) => [p.sku, p.id])),
      employees: new Map(employees.map((e) => [e.employeeNumber, e.id])),
      journals: Object.fromEntries(journals.map((j) => [j.code, j.id])),
      warehouse: { id: warehouses[0]?.id, locationId: warehouses[0]?.lotStockId },
      taxes: {
        sale: taxes.find((t) => t.typeTaxUse === "sale" && /PPN/.test(t.name) && !/mewah/i.test(t.name))?.id,
        purchase: taxes.find(
          (t) => t.typeTaxUse === "purchase" && /PPN/.test(t.name) && !/mewah/i.test(t.name),
        )?.id,
      },
    };
    return ctx[code]!;
  };

  await stage("master", async () => {
    const hq = company[codes[0]!]!;
    const branches = await api.list("/branches");
    for (const r of rows("Cabang"))
      if (!branches.some((b) => b.code === str(r.code) && b.companyId === company[str(r.company)]))
        await attempt(`cabang ${r.code}`, () =>
          api.post("/branches", { companyId: company[str(r.company)], code: str(r.code), name: str(r.name) }),
        );
    const units = await api.list("/business-units");
    for (const r of rows("Unit Bisnis"))
      if (!units.some((u) => u.code === str(r.code)))
        await attempt(`unit ${r.code}`, () =>
          api.post("/business-units", { code: str(r.code), name: str(r.name) }),
        );
    const rates = await api.list("/currency-rates");
    for (const r of rows("Kurs"))
      if (!rates.some((x) => x.currencyCode === str(r.currencyCode) && x.rateDate === str(r.rateDate)))
        await attempt(`kurs ${r.currencyCode} ${r.rateDate}`, () =>
          api.post("/currency-rates", {
            currencyCode: str(r.currencyCode),
            rateDate: str(r.rateDate),
            rate: num(r.rate),
          }),
        );
    const grades = await api.list("/salary-grades");
    for (const r of rows("Golongan Upah"))
      if (!grades.some((g) => g.code === str(r.code)))
        await attempt(`golongan ${r.code}`, () =>
          api.post("/salary-grades", {
            code: str(r.code),
            name: str(r.name),
            baseWage: String(num(r.baseWage)),
            minWage: String(num(r.minWage)),
            maxWage: String(num(r.maxWage)),
            sequence: num(r.sequence),
          }),
        );
    const gradeId = new Map((await api.list("/salary-grades")).map((g) => [g.code, g.id]));
    const jobs = await api.list("/job-positions");
    for (const r of rows("Jabatan"))
      if (!jobs.some((j) => j.name === str(r.name)))
        await attempt(`jabatan ${r.name}`, () =>
          api.post("/job-positions", { name: str(r.name), gradeId: gradeId.get(str(r.grade)) }),
        );
    await attempt("hari libur nasional 2026", () =>
      api.post("/work-calendar/holidays/import-national", { year: 2026, collective: true }),
    );
    // Libur 2021–2025 (belum ada di daftar bawaan aplikasi) ditambahkan satu per satu.
    const holidays = new Set<string>();
    for (const year of YEARS.filter((y) => y < 2026))
      for (const h of (await api.get<any>(`/work-calendar/holidays?year=${year}`)).items ?? [])
        holidays.add(h.date);
    for (const r of rows("Libur Nasional"))
      if (!holidays.has(str(r.date)))
        await attempt(`libur ${r.date}`, () =>
          api.post("/public-holidays", {
            date: str(r.date),
            name: str(r.name),
            kind: str(r.kind) || "national",
          }),
        );
    const uoms = new Map((await api.list("/uoms")).map((u) => [u.name, u.id]));
    const terms = new Map((await api.list("/payment-terms")).map((t) => [t.name, t.id]));
    const cats = await api.list("/product-categories");
    for (const r of rows("Kategori Produk"))
      if (!cats.some((c) => c.name === str(r.name))) {
        const c = await attempt(`kategori ${r.name}`, () =>
          api.post("/product-categories", { name: str(r.name) }),
        );
        if (c) cats.push(c);
      }
    const catId = new Map(cats.map((c) => [c.name, c.id]));
    for (const code of codes) {
      const id = company[code]!;
      const c = await refresh(code);
      for (const r of rows("Akun Tambahan", code))
        if (!c.accounts.has(str(r.code)))
          await attempt(`akun ${code} ${r.code}`, () =>
            api.post(
              "/accounts",
              { code: str(r.code), name: str(r.name), accountType: str(r.accountType) },
              id,
            ),
          );
      for (const r of rows("Partner", code))
        if (!c.partners.has(str(r.name)))
          await attempt(`partner ${r.name}`, () =>
            api.post(
              "/partners",
              {
                companyId: id,
                name: str(r.name),
                kind: str(r.kind) || "company",
                isCustomer: yes(r.isCustomer),
                isSupplier: yes(r.isSupplier),
                npwp: str(r.npwp) || null,
                email: str(r.email) || null,
                phone: str(r.phone) || null,
                street: str(r.street) || null,
                city: str(r.city) || null,
                province: str(r.province) || null,
                countryCode: str(r.countryCode) || "IDN",
                taxDocumentType: str(r.taxDocumentType) || "TIN",
                taxTrxCode: str(r.taxTrxCode) || "04",
                paymentTermId: terms.get(str(r.paymentTerm)) ?? null,
              },
              id,
            ),
          );
      for (const r of rows("Produk", code))
        if (!c.products.has(str(r.sku)))
          await attempt(`produk ${r.sku}`, () =>
            api.post(
              "/products",
              {
                companyId: id,
                sku: str(r.sku),
                name: str(r.name),
                productType: str(r.productType) || "storable",
                categoryId: catId.get(str(r.category)) ?? null,
                uomId: uoms.get(str(r.uom)) ?? uoms.get("Pcs"),
                salePrice: String(num(r.salePrice)),
                cost: String(num(r.cost)),
                costMethod: str(r.costMethod) || "average",
              },
              id,
            ),
          );
      const fresh = await refresh(code);
      const usd = rows("Produk", code).filter((r) => num(r.exportPriceUsd) > 0);
      if (usd.length) {
        const pls = await api.list("/pricelists", id);
        if (!pls.some((p) => p.name === "Ekspor USD"))
          await attempt(`daftar harga USD ${code}`, () =>
            api.post(
              "/pricelists",
              {
                companyId: id,
                name: "Ekspor USD",
                currencyCode: "USD",
                items: usd.map((r) => ({
                  productId: fresh.products.get(str(r.sku)),
                  compute: "fixed",
                  fixedPrice: String(num(r.exportPriceUsd)),
                })),
              },
              id,
            ),
          );
      }
      void hq;
    }
  });

  await stage("sdm", async () => {
    const leaveTypes = new Map((await api.list("/leave-types")).map((t) => [t.name, t.id]));
    void leaveTypes;
    for (const code of codes) {
      const id = company[code]!;
      api.company = id;
      const c = await refresh(code);
      const depts = await api.list("/departments");
      for (const r of rows("Departemen", code))
        if (!depts.some((d) => d.name === str(r.name)))
          await attempt(`departemen ${r.name}`, () => api.post("/departments", { name: str(r.name) }));
      const schedules = await api.list("/work-schedules");
      for (const r of rows("Jadwal Kerja", code))
        if (!schedules.some((s) => s.name === str(r.name)))
          await attempt(`jadwal ${r.name}`, () =>
            api.post("/work-schedules", {
              name: str(r.name),
              startTime: str(r.startTime),
              endTime: str(r.endTime),
              workDays: [1, 2, 3, 4, 5],
            }),
          );
      const cats = await api.list("/expense-categories");
      for (const r of rows("Kategori Klaim", code))
        if (!cats.some((x) => x.name === str(r.name)))
          await attempt(`kategori klaim ${r.name}`, () =>
            api.post("/expense-categories", {
              name: str(r.name),
              accountId: c.accounts.get(str(r.accountCode)),
              annualLimit: String(num(r.annualLimit)),
            }),
          );
      const importHr = async (key: string, sheet: string, data: Row[], extra: [string, string][] = []) => {
        for (const part of chunk(data, 2000)) {
          const res = await attempt(`impor ${key} ${code}`, () =>
            api.post(`/data-transfer/${key}/import`, { csv: csv(hrColumns(sheet, extra), part) }),
          );
          if (res && (res as any).errors?.length)
            failures.push(`impor ${key} ${code}: ${JSON.stringify((res as any).errors.slice(0, 3))}`);
        }
      };
      const newEmployees = rows("Karyawan", code).filter((r) => !c.employees.has(str(r.employeeNumber)));
      // Atasan diimpor lebih dulu agar kolom "No. Karyawan Atasan" bisa dirujuk.
      const ordered = [
        ...newEmployees.filter((r) => !str(r.managerNumber)),
        ...newEmployees.filter((r) => str(r.managerNumber)),
      ];
      if (ordered.length)
        await importHr(
          "employees",
          "Karyawan",
          ordered.map((r) => ({ ...r, managerNumber: "" })),
        );
      const after = await refresh(code);
      // Atasan & kepala departemen diisi setelah semua karyawan ada.
      for (const r of newEmployees.filter((x) => str(x.managerNumber)))
        await attempt(`atasan ${r.employeeNumber}`, () =>
          api.patch(`/employees/${after.employees.get(str(r.employeeNumber))}`, {
            managerId: after.employees.get(str(r.managerNumber)),
          }),
        );
      for (const d of await api.list("/departments")) {
        const head = rows("Departemen", code).find((r) => str(r.name) === d.name);
        const managerId = head && after.employees.get(str(head.managerNumber));
        if (managerId && d.managerId !== managerId)
          await attempt(`kepala ${d.name}`, () => api.patch(`/departments/${d.id}`, { managerId }));
      }
      if (newEmployees.length) {
        const numbers = new Set(newEmployees.map((r) => str(r.employeeNumber)));
        await importHr(
          "contracts",
          "Kontrak",
          rows("Kontrak", code)
            .filter((r) => numbers.has(str(r.employeeNumber)))
            .map((r) => ({ ...r, start: true })),
          [["start", "Mulai Berlaku"]],
        );
        await importHr(
          "family",
          "Keluarga",
          rows("Keluarga", code).filter((r) => numbers.has(str(r.employeeNumber))),
        );
        await importHr(
          "education",
          "Pendidikan",
          rows("Pendidikan", code).filter((r) => numbers.has(str(r.employeeNumber))),
        );
        await importHr(
          "leave-allocations",
          "Alokasi Cuti",
          rows("Alokasi Cuti", code).filter((r) => numbers.has(str(r.employeeNumber))),
        );
      }
      // Kenaikan upah tahunan lewat SK Penyesuaian upah (satu jalur perubahan upah), lalu karyawan yang keluar.
      const mine = await refresh(code);
      const applied = new Set(
        (await api.list("/employee-movements"))
          .filter((m) => m.kind === "wage_adjustment")
          .map((m) => `${m.employeeId}|${m.effectiveDate}`),
      );
      let raised = 0;
      for (const r of rows("Penyesuaian Upah", code)) {
        const employeeId = mine.employees.get(str(r.employeeNumber));
        if (!employeeId || applied.has(`${employeeId}|${str(r.effectiveDate)}`)) continue;
        await attempt(`upah ${r.employeeNumber} ${r.effectiveDate}`, async () => {
          const mv = await api.post("/employee-movements", {
            employeeId,
            kind: "wage_adjustment",
            effectiveDate: str(r.effectiveDate),
            newWage: String(num(r.newWage)),
            reason: str(r.reason),
          });
          await api.post(`/employee-movements/${mv.id}/apply`);
          raised++;
        });
      }
      log(`  ${code}: ${after.employees.size} karyawan, ${raised} SK kenaikan upah`);
    }
    api.company = null;
  });

  await stage("pengguna", async () => {
    const templates = await api.get<any>("/roles/templates").catch(() => []);
    const roles = await api.list("/roles");
    const roleFor = async (key: string) => {
      const map: Record<string, string[]> = {
        admin: ["admin"],
        dir: ["user"],
        fin: ["accountant", "cashier"],
        hr: ["hr_manager", "payroll"],
        sales: ["sales_manager"],
      };
      const ids: string[] = [];
      for (const codeName of map[key] ?? ["user"]) {
        let role = roles.find((r) => r.code === codeName);
        const tpl = (Array.isArray(templates) ? templates : (templates.items ?? [])).find(
          (t: any) => t.code === codeName,
        );
        if (!role && tpl) {
          role = await attempt(`peran ${codeName}`, () =>
            api.post("/roles", {
              code: tpl.code,
              name: Array.isArray(tpl.name) ? tpl.name[0] : tpl.name,
              permissions: tpl.permissions,
            }),
          );
          if (role) roles.push(role);
        }
        if (role) ids.push(role.id);
      }
      return ids;
    };
    const users = await api.list("/users");
    for (const r of rows("Pengguna")) {
      if (users.some((u) => u.email === str(r.email))) continue;
      const companyIds = str(r.company) === "*" ? Object.values(company) : [company[str(r.company)]!];
      await attempt(`pengguna ${r.email}`, async () =>
        api.post("/users", {
          name: str(r.name),
          email: str(r.email),
          password: str(r.password) || DEMO_PASSWORD,
          roleIds: await roleFor(str(r.role)),
          companyIds,
        }),
      );
    }
  });

  await stage("saldo-awal", async () => {
    for (const code of codes) {
      const id = company[code]!;
      api.company = id;
      const c = await refresh(code);
      const stock = rows("Produk", code).filter(
        (r) => num(r.openingStock) > 0 && str(r.productType) !== "service",
      );
      // Saldo awal hanya sekali; bila sudah ada (409) stok awal juga dilewati agar stok berjalan tidak tertimpa.
      const posted = await api
        .post("/onboarding/opening-balance", {
          date: OPENING_DATE,
          lines: rows("Saldo Awal", code).map((r) => ({
            accountCode: str(r.accountCode),
            partnerId: str(r.partner) ? c.partners.get(str(r.partner)) : null,
            debit: String(num(r.debit)),
            credit: String(num(r.credit)),
            name: str(r.name),
          })),
        })
        .then(() => true)
        .catch((e) => {
          if (e instanceof ApiError && e.status === 409) return false;
          failures.push(`saldo awal ${code}: ${e.message}`);
          return false;
        });
      if (posted && stock.length)
        await attempt(`stok awal ${code}`, () =>
          api.post("/stock/adjustments", {
            locationId: c.warehouse.locationId,
            date: OPENING_DATE,
            reason: "Stok awal 1 Jan 2021",
            lines: stock.map((r) => ({
              productId: c.products.get(str(r.sku)),
              countedQty: String(num(r.openingStock)),
              unitCost: String(num(r.cost)),
            })),
          }),
        );
      const assets = await api.list("/assets");
      for (const r of rows("Aset Tetap", code)) {
        if (assets.some((a) => a.name === str(r.name))) continue;
        const a = await attempt(`aset ${r.name}`, () =>
          api.post("/assets", {
            name: str(r.name),
            acquisitionDate: str(r.acquisitionDate),
            firstDepreciationDate: str(r.firstDepreciationDate),
            cost: String(num(r.cost)),
            salvageValue: String(num(r.salvageValue)),
            usefulLifeMonths: num(r.usefulLifeMonths),
            assetAccountId: c.accounts.get(str(r.assetAccount)),
            depreciationAccountId: c.accounts.get(str(r.depreciationAccount)),
            expenseAccountId: c.accounts.get(str(r.expenseAccount)),
          }),
        );
        if (a) await attempt(`konfirmasi aset ${r.name}`, () => api.post(`/assets/${a.id}/confirm`));
      }
      for (const b of [...new Set(rows("Anggaran", code).map((r) => str(r.budget)))]) {
        const existing = await api.list("/budgets");
        if (existing.some((x) => x.name === b)) continue;
        const year = num(rows("Anggaran", code).find((r) => str(r.budget) === b)!.year) || 2026;
        await attempt(`anggaran ${b}`, () =>
          api.post("/budgets", {
            name: b,
            dateFrom: `${year}-01-01`,
            dateTo: `${year}-12-31`,
            lines: rows("Anggaran", code)
              .filter((r) => str(r.budget) === b)
              .map((r) => ({ accountId: c.accounts.get(str(r.accountCode)), amount: String(num(r.amount)) })),
          }),
        );
      }
    }
    api.company = null;
  });

  await stage("transaksi", async () => {
    // Pesanan yang sudah ada: dilewati bila tuntas, dilanjutkan bila terpotong (mis. pemuatan berhenti di tengah).
    const existing = new Map<string, { id: string; state: string; billed: string }>();
    for (const code of codes) {
      for (const o of await api.list("/sale-orders", company[code]))
        if (o.clientOrderRef)
          existing.set(o.clientOrderRef, { id: o.id, state: o.state, billed: o.invoiceStatus });
      for (const o of await api.list("/purchase-orders", company[code]))
        if (o.partnerRef) existing.set(o.partnerRef, { id: o.id, state: o.state, billed: o.billStatus });
      await refresh(code);
    }
    const pricelists: Record<string, Map<string, string>> = {};
    for (const code of codes)
      pricelists[code] = new Map((await api.list("/pricelists", company[code])).map((p) => [p.name, p.id]));
    const lines = (sheet: string) => {
      const m = new Map<string, Row[]>();
      for (const r of rows(sheet))
        m.set(`${r.company}|${r.orderNo}`, [...(m.get(`${r.company}|${r.orderNo}`) ?? []), r]);
      return m;
    };
    const soLines = lines("Penjualan - Baris");
    const poLines = lines("Pembelian - Baris");
    const events = [
      ...rows("Penjualan").map((r) => ({ kind: "SO" as const, r })),
      ...rows("Pembelian").map((r) => ({ kind: "PO" as const, r })),
    ].sort(
      (a, b) =>
        str(a.r.dateOrder).localeCompare(str(b.r.dateOrder)) ||
        (a.kind === b.kind ? 0 : a.kind === "PO" ? -1 : 1),
    );
    let n = 0;
    // Tiap perusahaan dimuat paralel; di dalam satu perusahaan berurutan menurut tanggal (stok & valuasi benar).
    await Promise.all(
      codes.map(async (code) => {
        const a = api.as(company[code]!);
        const c = ctx[code]!;
        for (const { kind, r } of events.filter((e) => str(e.r.company) === code)) {
          const ref = str(r.orderNo);
          const found = existing.get(ref);
          const unfinished =
            found &&
            (["draft", "sent", "to_approve"].includes(found.state) ||
              (str(r.invoiceDate) && found.billed !== "invoiced"));
          if (found && !unfinished) continue;
          const partnerId = c.partners.get(str(r.partner));
          if (!partnerId) {
            failures.push(`${ref}: partner ${r.partner} tidak ditemukan`);
            continue;
          }
          await attempt(ref, async () => {
            const items = (kind === "SO" ? soLines : poLines).get(`${code}|${ref}`) ?? [];
            const orderLines = items.map((l) => ({
              productId: c.products.get(str(l.sku)),
              quantity: String(num(l.quantity)),
            }));
            let order: any;
            const path = kind === "SO" ? "sale-orders" : "purchase-orders";
            if (found) {
              order = await a.get(`/${path}/${found.id}`);
              if (order.state === "draft" || order.state === "sent")
                order = await a.post(`/${path}/${order.id}/confirm`);
              if (order.state === "to_approve") order = await a.post(`/${path}/${order.id}/approve`);
            } else if (kind === "SO") {
              order = await a.post("/sale-orders", {
                partnerId,
                dateOrder: str(r.dateOrder),
                clientOrderRef: ref,
                pricelistId: str(r.pricelist) ? pricelists[code]!.get(str(r.pricelist)) : null,
                warehouseId: c.warehouse.id,
                lines: orderLines,
              });
              order = await a.post(`/sale-orders/${order.id}/confirm`);
            } else {
              order = await a.post("/purchase-orders", {
                partnerId,
                partnerRef: ref,
                dateOrder: str(r.dateOrder),
                warehouseId: c.warehouse.id,
                lines: orderLines,
              });
              order = await a.post(`/purchase-orders/${order.id}/confirm`);
              if (order.state === "to_approve") order = await a.post(`/purchase-orders/${order.id}/approve`);
            }
            if (str(r.deliveryDate))
              for (const p of order.pickings ?? [])
                if (p.state !== "done" && p.state !== "cancel")
                  await a.post(`/pickings/${p.id}/validate`, { date: str(r.deliveryDate) });
            if (!str(r.invoiceDate)) return;
            const prior = (order.invoices ?? order.bills ?? []).find((m: any) => m.state !== "cancel");
            const moveId: string =
              prior?.id ??
              (kind === "SO"
                ? await a.post(`/sale-orders/${order.id}/invoice`, {
                    method: "regular",
                    date: str(r.invoiceDate),
                  })
                : await a.post(`/purchase-orders/${order.id}/bill`, { date: str(r.invoiceDate) })
              ).moveId;
            if (!prior || prior.state === "draft") await a.post(`/moves/${moveId}/post`);
            if (!str(r.paymentDate)) return;
            const move = await a.get(`/moves/${moveId}`);
            if (move.paymentState === "paid" || move.paymentState === "in_payment") return;
            await a.post("/payments", {
              paymentType: kind === "SO" ? "inbound" : "outbound",
              partnerId,
              journalId: c.journals.BNK1,
              amount: move.amountTotal,
              currencyCode: move.currencyCode,
              date: str(r.paymentDate),
              memo: ref,
              moveIds: [moveId],
            });
          });
          if (++n % 250 === 0) log(`  ${n} pesanan`);
        }
      }),
    );
    // Sisi pembeli transaksi antar-perusahaan.
    for (const r of rows("Tagihan Antar-Perusahaan")) {
      const code = str(r.company);
      const c = ctx[code]!;
      api.company = company[code]!;
      const partnerId = c.partners.get(str(r.vendor));
      const existing = await api.list(`/moves?moveType=in_invoice&q=${encodeURIComponent(str(r.ref))}`);
      if (existing.some((m) => m.ref === str(r.ref))) continue;
      await attempt(`tagihan IC ${r.ref}`, async () => {
        const move = await api.post("/moves", {
          moveType: "in_invoice",
          partnerId,
          date: str(r.date),
          ref: str(r.ref),
          lines: [
            {
              accountId: c.accounts.get(str(r.accountCode)),
              name: str(r.description).slice(0, 500),
              quantity: "1",
              priceUnit: String(num(r.amount)),
              taxIds: c.taxes.purchase ? [c.taxes.purchase] : [],
            },
          ],
        });
        await api.post(`/moves/${move.id}/post`);
        if (str(r.paymentDate)) {
          const full = await api.get(`/moves/${move.id}`);
          await api.post("/payments", {
            paymentType: "outbound",
            partnerId,
            journalId: c.journals.BNK1,
            amount: full.amountTotal,
            date: str(r.paymentDate),
            memo: str(r.ref),
            moveIds: [move.id],
          });
        }
      });
    }
    // Penyusutan aset tiap akhir bulan Jan 2021 – Okt 2026.
    await Promise.all(
      codes.map(async (code) => {
        for (const period of PERIODS)
          await attempt(`penyusutan ${code} ${period}`, () =>
            api.post("/assets/depreciate", { date: monthEnd(period) }, company[code]),
          );
      }),
    );
    api.company = null;
  });

  await stage("kehadiran", async () => {
    const leaveTypes = new Map((await api.list("/leave-types")).map((t) => [t.name, t.id]));
    // Tiap perusahaan dimuat paralel (data karyawan tidak saling bergantung antar-perusahaan).
    await Promise.all(
      codes.map(async (code) => {
        const a = api.as(company[code]!);
        const c = await refresh(code);
        for (const year of YEARS) {
          const data = rows("Absensi", code).filter((r) => str(r.date).startsWith(String(year)));
          for (const part of chunk(data, 3000))
            await attempt(`absensi ${code} ${year}`, () =>
              a.post("/data-transfer/attendance/import", { csv: csv(hrColumns("Absensi"), part) }),
            );
        }
        const leaves = await a.list("/leaves");
        let n = 0;
        for (const r of rows("Pengajuan Cuti", code)) {
          const employeeId = c.employees.get(str(r.employeeNumber));
          const prior = leaves.find((l) => l.employeeId === employeeId && l.dateFrom === str(r.dateFrom));
          // Sudah ada: lanjutkan persetujuan bila belum diputuskan (mis. pemuatan sebelumnya terhenti).
          if (prior && (prior.state !== "confirm" || str(r.state) !== "Disetujui")) continue;
          await attempt(`cuti ${r.employeeNumber} ${r.dateFrom}`, async () => {
            const attachment = /sakit/i.test(str(r.leaveType))
              ? { name: "surat-keterangan-dokter.pdf", type: "application/pdf", data: DOCTOR_NOTE }
              : null;
            let leave =
              prior ??
              (await a.post("/leaves", {
                employeeId,
                leaveTypeId: leaveTypes.get(str(r.leaveType)),
                dateFrom: str(r.dateFrom),
                dateTo: str(r.dateTo),
                reason: str(r.reason),
                attachment,
              }));
            for (let i = 0; i < 4 && leave.state !== "approved" && str(r.state) === "Disetujui"; i++)
              leave = await a.post(`/leaves/${leave.id}/approve`, {});
          });
          if (++n % 500 === 0) log(`  ${code}: ${n} cuti`);
        }
        for (const part of chunk(rows("Lembur", code), 3000))
          await attempt(`lembur ${code}`, () =>
            a.post("/data-transfer/overtimes/import", { csv: csv(hrColumns("Lembur"), part) }),
          );
        for (const o of (await a.list("/overtimes")).filter((x) => x.state === "confirm"))
          await attempt(`setujui lembur ${o.id}`, async () => {
            for (let i = 0; i < 4; i++) {
              const r = await a.post(`/approvals/overtime/${o.id}/approve`, {});
              if ((r.state ?? r.overtime?.state) !== "confirm") break;
            }
          });
        const cats = new Map((await a.list("/expense-categories")).map((x) => [x.name, x.id]));
        const claims = await a.list("/expense-claims");
        for (const r of rows("Klaim Biaya", code)) {
          const employeeId = c.employees.get(str(r.employeeNumber));
          const prior = claims.find((x) => x.employeeId === employeeId && x.date === str(r.date));
          if (prior && prior.state !== "draft" && prior.state !== "confirm") continue;
          await attempt(`klaim ${r.employeeNumber} ${r.date}`, async () => {
            let claim =
              prior ??
              (await a.post("/expense-claims", {
                employeeId,
                date: str(r.date),
                description: str(r.description),
                payMethod: str(r.payMethod) || "payslip",
                lines: [
                  {
                    categoryId: cats.get(str(r.category)),
                    date: str(r.date),
                    amount: String(num(r.amount)),
                    note: str(r.description),
                  },
                ],
              }));
            if (claim.state === "draft") claim = await a.post(`/expense-claims/${claim.id}/submit`);
            for (let i = 0; i < 4 && claim.state !== "approved"; i++)
              claim = await a.post(`/expense-claims/${claim.id}/approve`, {});
          });
        }
        const loans = await a.list("/employee-loans");
        for (const r of rows("Pinjaman Karyawan", code)) {
          const employeeId = c.employees.get(str(r.employeeNumber));
          if (
            loans.some(
              (l) =>
                l.employeeId === employeeId && l.name === str(r.name) && l.startPeriod === str(r.startPeriod),
            )
          )
            continue;
          await attempt(`pinjaman ${r.employeeNumber} ${r.startPeriod}`, async () => {
            const loan = await a.post("/employee-loans", {
              employeeId,
              name: str(r.name),
              principal: String(num(r.principal)),
              installment: String(num(r.installment)),
              startPeriod: str(r.startPeriod),
            });
            await a.post(`/employee-loans/${loan.id}/disburse`, {
              journalId: c.journals.BNK1,
              date: str(r.disburseDate),
            });
          });
        }
        for (const year of YEARS) {
          const budget = rows("Anggaran Tenaga Kerja", code).filter((r) => num(r.year) === year);
          if (budget.length)
            await attempt(`anggaran tenaga kerja ${code} ${year}`, () =>
              a.post(`/manpower-budgets/import?year=${year}`, {
                csv: csv(
                  [
                    ["department", "Departemen"],
                    ["month", "Bulan"],
                    ["headcount", "Headcount"],
                    ["cost", "Biaya"],
                  ],
                  budget,
                ),
              }),
            );
        }
        log(`  ${code}: kehadiran, cuti, lembur, klaim & pinjaman selesai`);
      }),
    );
  });

  // Karyawan keluar diproses setelah cuti & klaimnya disetujui (pengajuan karyawan yang sudah keluar tidak bisa
  // diputuskan) dan sebelum payroll (gaji bulan terakhir dihitung prorata sampai tanggal keluar).
  await stage("karyawan-keluar", async () => {
    for (const code of codes) {
      const a = api.as(company[code]!);
      const c = await refresh(code);
      let n = 0;
      for (const r of rows("Karyawan Keluar", code)) {
        const employeeId = c.employees.get(str(r.employeeNumber));
        if (!employeeId) continue;
        const running = (await a.list(`/contracts?employeeId=${employeeId}`)).find(
          (x) => x.state === "running",
        );
        if (!running) continue;
        await attempt(`keluar ${r.employeeNumber}`, () =>
          a.post(`/contracts/${running.id}/close`, {
            dateEnd: str(r.resignDate),
            exit: true,
            resignReason: str(r.reason) || "resign",
            resignNote: str(r.note) || null,
            startChecklist: false,
          }),
        );
        n++;
      }
      log(`  ${code}: ${n} karyawan keluar`);
    }
  });

  await stage("payroll", async () => {
    await Promise.all(
      codes.map(async (code) => {
        const a = api.as(company[code]!);
        const c = await refresh(code);
        const runs = await a.list("/payroll-runs");
        for (const r of rows("Payroll", code)) {
          if (
            runs.some(
              (x) =>
                String(x.periodStart ?? x.period ?? "").startsWith(str(r.period)) && x.kind !== "correction",
            )
          )
            continue;
          await attempt(`payroll ${code} ${r.period}`, async () => {
            const run = await a.post("/payroll-runs", {
              period: str(r.period),
              paymentDate: str(r.paymentDate),
              name: str(r.name),
            });
            await a.post(`/payroll-runs/${run.id}/compute`);
            if (yes(r.post)) await a.post(`/payroll-runs/${run.id}/post`);
            if (yes(r.pay))
              await a.post(`/payroll-runs/${run.id}/pay`, {
                journalId: c.journals.BNK1,
                date: str(r.paymentDate),
              });
          });
          if (str(r.period).endsWith("-12")) log(`  ${code}: payroll s.d. ${r.period}`);
        }
        log(`  ${code}: payroll selesai`);
      }),
    );
  });

  await stage("crm-rekrutmen-armada", async () => {
    const stages = new Map((await api.list("/crm-stages")).map((s) => [s.name, s.id]));
    const models = new Map<string, string>();
    const makers = await api.list("/fleet-manufacturers").catch(() => [] as any[]);
    const fleetModels = await api.list("/fleet-models").catch(() => [] as any[]);
    for (const r of rows("Armada - Model")) {
      let maker = makers.find((x) => x.name === str(r.manufacturer));
      if (!maker) {
        maker = await attempt(`merek ${r.manufacturer}`, () =>
          api.post("/fleet-manufacturers", { name: str(r.manufacturer) }),
        );
        if (maker) makers.push(maker);
      }
      let model_ = fleetModels.find((x) => x.name === str(r.model));
      if (!model_ && maker)
        model_ = await attempt(`model ${r.model}`, () =>
          api.post("/fleet-models", {
            manufacturerId: maker.id,
            name: str(r.model),
            category: str(r.category),
          }),
        );
      if (model_) models.set(str(r.model), model_.id);
    }
    for (const code of codes) {
      const id = company[code]!;
      api.company = id;
      const c = await refresh(code);
      const leads = await api.list("/leads");
      for (const r of rows("Prospek CRM", code))
        if (!leads.some((l) => l.name === str(r.name)))
          await attempt(`lead ${r.name}`, async () => {
            const won = str(r.stage) === "Menang";
            const lost = str(r.stage) === "Kalah";
            const lead = await api.post("/leads", {
              leadType: "opportunity",
              name: str(r.name),
              partnerName: str(r.partnerName),
              contactName: str(r.contactName),
              email: str(r.email) || null,
              phone: str(r.phone),
              stageId: stages.get(won ? "Negosiasi" : lost ? "Proposal" : str(r.stage)),
              userId: null,
              expectedRevenue: String(num(r.expectedRevenue)),
              expectedClose: str(r.expectedClose),
              source: str(r.source) || null,
            });
            if (won) await api.post(`/leads/${lead.id}/won`, {});
            if (lost)
              await api.post(`/leads/${lead.id}/lost`, { lostNote: "Pelanggan memilih penawaran lain" });
          });
      const openings = await api.list("/job-openings");
      const jobs = new Map((await api.list("/job-positions")).map((j) => [j.name, j.id]));
      const depts = new Map((await api.list("/departments")).map((d) => [d.name, d.id]));
      for (const r of rows("Lowongan", code))
        if (!openings.some((o) => o.name === str(r.name))) {
          const o = await attempt(`lowongan ${r.name}`, () =>
            api.post("/job-openings", {
              name: str(r.name),
              jobId: jobs.get(str(r.job)),
              departmentId: depts.get(str(r.department)),
              quota: num(r.quota) || 1,
              dateOpen: str(r.dateOpen),
              targetDate: str(r.targetDate),
              wageMin: String(num(r.wageMin)),
              wageMax: String(num(r.wageMax)),
            }),
          );
          if (o) openings.push(o);
        }
      const applicants = await api.list("/applicants");
      for (const r of rows("Pelamar", code)) {
        const opening = openings.find((o) => o.name === str(r.opening));
        if (!opening || applicants.some((a) => a.name === str(r.name) && a.openingId === opening.id))
          continue;
        await attempt(`pelamar ${r.name}`, async () => {
          const a = await api.post("/applicants", {
            openingId: opening.id,
            name: str(r.name),
            email: str(r.email) || null,
            phone: str(r.phone),
            source: str(r.source) || "other",
            expectedWage: String(num(r.expectedWage)),
            consent: yes(r.consent),
            consentSource: "form",
          });
          for (const stage_ of ["screening", "interview", "offer"]) {
            if (stage_ === "screening" && str(r.stage) === "new") break;
            await api.post(`/applicants/${a.id}/stage`, { stage: stage_ });
            if (stage_ === str(r.stage)) break;
          }
        });
      }
      const vehicles = await api.list("/fleet-vehicles");
      for (const r of rows("Armada - Kendaraan", code))
        if (!vehicles.some((v) => v.licensePlate === str(r.licensePlate)))
          await attempt(`kendaraan ${r.licensePlate}`, () =>
            api.post("/fleet-vehicles", {
              licensePlate: str(r.licensePlate),
              modelId: models.get(str(r.model)),
              modelYear: num(r.modelYear),
              color: str(r.color),
              driverEmployeeId: c.employees.get(str(r.driver)) ?? null,
              purchaseValue: String(num(r.purchaseValue)),
              stnkExpiry: str(r.stnkExpiry),
              taxDueDate: str(r.taxDueDate),
              registrationDate: `${num(r.modelYear)}-03-01`,
            }),
          );
    }
    api.company = null;
  });

  await stage("konsolidasi", async () => {
    const root = company[codes[0]!]!;
    api.company = root;
    await attempt("bootstrap konsolidasi", () => api.post("/consolidation/bootstrap"));
    const runs = await api.list("/consolidation/runs");
    // Satu run per tahun (2026 s.d. Oktober), sebelum tutup buku agar laba rugi tahunan tetap terlihat.
    for (const year of YEARS) {
      const dateTo = year === 2026 ? TX_TO : `${year}-12-31`;
      if (runs.some((r) => r.dateTo === dateTo)) continue;
      const run = await attempt(`run konsolidasi ${year}`, () =>
        api.post("/consolidation/runs", {
          name: year === 2026 ? "Konsolidasi Jan–Okt 2026" : `Konsolidasi ${year}`,
          rootCompanyId: root,
          dateFrom: `${year}-01-01`,
          dateTo,
          rates: [],
        }),
      );
      if (run)
        await attempt(`hitung konsolidasi ${year}`, () =>
          api.post(`/consolidation/runs/${run.id}/compute`, {}),
        );
    }
    api.company = null;
  });

  await stage("tutup-buku", async () => {
    for (const r of rows("Tutup Buku")) {
      const id = company[str(r.company)]!;
      await api.post("/accounting/close-year", { fiscalYear: num(r.fiscalYear) }, id).catch((e) => {
        // Sudah ditutup (409) dilewati agar aman dijalankan ulang.
        if (!(e instanceof ApiError && e.status === 409))
          failures.push(`tutup buku ${r.company} ${r.fiscalYear}: ${e.message}`);
      });
    }
    log(`  tutup buku ${rows("Tutup Buku").length} perusahaan-tahun`);
  });

  log(`Selesai: ${api.calls} panggilan API, ${failures.length} gagal.`);
  if (failures.length) {
    console.log("\nYang gagal (maks. 60 pertama):");
    for (const f of failures.slice(0, 60)) console.log(` - ${f}`);
    process.exitCode = 1;
  }
  console.log(`\nLogin: tenant "${SLUG}", ${EMAIL} / ${PASSWORD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
