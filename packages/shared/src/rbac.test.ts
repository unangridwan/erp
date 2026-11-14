import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSION_CODES,
  allowedFor,
  canDelegate,
  canEditSalary,
  canViewPersonal,
  canViewSalary,
  deniedLevels,
  effectivePermissions,
  featureForPath,
  grantedLevels,
  ROLE_TEMPLATES,
} from "./rbac.js";

const A = "company-a";
const B = "company-b";

describe("tingkat akses", () => {
  it("memberi menurunkan aksi turunan; mencabut menutup aksi yang bergantung", () => {
    expect(grantedLevels("read")).toEqual(["read", "export"]);
    expect(grantedLevels("write")).toEqual(["read", "export", "write", "delete"]);
    expect(grantedLevels("manage")).toEqual(["read", "export", "write", "delete", "manage"]);
    expect(deniedLevels("read")).toEqual(["read", "export", "write", "delete", "manage"]);
    expect(deniedLevels("write")).toEqual(["write", "delete", "manage"]);
    expect(deniedLevels("export")).toEqual(["export"]);
  });
});

describe("effectivePermissions", () => {
  it("peran per perusahaan: hanya peran yang berlaku di perusahaan aktif", () => {
    const grants = {
      roles: [
        { permissions: ["accounting.write"], companyId: A },
        { permissions: ["sales.read"], companyId: null },
      ],
      overrides: [],
    };
    const a = effectivePermissions(grants, A);
    const b = effectivePermissions(grants, B);
    expect(a).toContain("accounting.write");
    expect(a).toContain("accounting.payments.delete");
    expect(a).toContain("sales.orders.export");
    expect(b).not.toContain("accounting.read");
    expect(b).toContain("sales.read");
  });

  it("tambah fitur tanpa modul; cabut satu fitur dari modul penuh", () => {
    const p = effectivePermissions(
      {
        roles: [{ permissions: ["hr.manage"], companyId: null }],
        overrides: [
          { permission: "hr.recruitment.write", effect: "deny", companyId: null },
          { permission: "hr.employees.export", effect: "deny", companyId: null },
          { permission: "accounting.reports.read", effect: "grant", companyId: A },
        ],
      },
      A,
    );
    expect(p).toContain("hr.recruitment.read");
    expect(p).not.toContain("hr.recruitment.write");
    expect(p).not.toContain("hr.recruitment.manage");
    expect(p).not.toContain("hr.employees.export");
    expect(p).toContain("hr.employees.manage");
    expect(p).toContain("accounting.reports.read");
    expect(p).not.toContain("accounting.read");
  });

  it("cabut modul menutup semua fitur; admin penuh tidak bisa dicabut", () => {
    const p = effectivePermissions(
      {
        roles: [{ permissions: ["payroll.manage"], companyId: null }],
        overrides: [{ permission: "payroll.write", effect: "deny", companyId: null }],
      },
      A,
    );
    expect(p).toContain("payroll.runs.read");
    expect(p.some((c) => c.startsWith("payroll") && /\.(write|delete|manage)$/.test(c))).toBe(false);
    expect(
      effectivePermissions(
        {
          roles: [{ permissions: ["*"], companyId: null }],
          overrides: [{ permission: "hr.read", effect: "deny", companyId: null }],
        },
        A,
      ),
    ).toEqual(["*"]);
  });

  it("hak khusus diberikan apa adanya", () => {
    const p = effectivePermissions(
      { roles: [{ permissions: ["sales.read", "sales.all"], companyId: null }], overrides: [] },
      A,
    );
    expect(p).toContain("sales.all");
  });
});

describe("data sensitif (gaji & data pribadi)", () => {
  const perms = (roles: string[], overrides: { permission: string; effect: "grant" | "deny" }[] = []) =>
    effectivePermissions(
      {
        roles: [{ permissions: roles, companyId: null }],
        overrides: overrides.map((o) => ({ ...o, companyId: null })),
      },
      A,
    );

  it("hak lihat/ubah SDM tidak membuka gaji maupun data pribadi; hak kelola membukanya", () => {
    for (const role of ["hr.read", "hr.write"]) {
      const p = perms([role]);
      expect(p).toContain("hr.employees.read");
      expect(canViewSalary(p), role).toBe(false);
      expect(canViewPersonal(p), role).toBe(false);
    }
    const manager = perms(["hr.manage"]);
    expect(canViewSalary(manager)).toBe(true);
    expect(canEditSalary(manager)).toBe(true);
    expect(canViewPersonal(manager)).toBe(true);
  });

  it("bisa diberikan sendiri, dicabut per akun, dan ikut hak Payroll", () => {
    const staff = perms(["hr.write", "hr.salary.read"]);
    expect(canViewSalary(staff)).toBe(true);
    expect(canEditSalary(staff)).toBe(false);
    expect(canViewPersonal(staff)).toBe(false);
    expect(canViewPersonal(perms(["hr.read"], [{ permission: "hr.personal.read", effect: "grant" }]))).toBe(
      true,
    );

    const denied = perms(["hr.manage"], [{ permission: "hr.salary.read", effect: "deny" }]);
    expect(canViewSalary(denied)).toBe(false);
    expect(denied).toContain("hr.employees.manage");

    expect(canViewSalary(perms(["payroll.read", "hr.read"]))).toBe(true);
    expect(canViewSalary(["*"])).toBe(true);
    expect(ALL_PERMISSION_CODES.has("hr.salary.read")).toBe(true);
    expect(ALL_PERMISSION_CODES.has("hr.personal.write")).toBe(true);
  });
});

describe("allowedFor", () => {
  const perms = effectivePermissions(
    {
      roles: [{ permissions: ["hr.write"], companyId: null }],
      overrides: [
        { permission: "hr.recruitment.read", effect: "deny", companyId: null },
        { permission: "hr.leave.delete", effect: "deny", companyId: null },
        { permission: "hr.employees.export", effect: "deny", companyId: null },
      ],
    },
    A,
  );
  it("permission modul diterjemahkan ke fitur pemilik path", () => {
    expect(allowedFor(perms, "hr.read", { path: "/employees" })).toBe(true);
    expect(allowedFor(perms, "hr.read", { path: "/applicants/123" })).toBe(false);
    expect(allowedFor(perms, "hr.write", { path: "/job-openings", method: "POST" })).toBe(false);
    expect(allowedFor(perms, "hr.write", { path: "/leaves/1", method: "PATCH" })).toBe(true);
    expect(allowedFor(perms, "hr.write", { path: "/leaves/1", method: "DELETE" })).toBe(false);
    expect(allowedFor(perms, "hr.read", { path: "/employees/export" })).toBe(false);
    expect(allowedFor(perms, "hr.read", { path: "/hr/recruitment", side: "web" })).toBe(false);
    expect(allowedFor(perms, "hr.read", { path: "/hr/leaves", side: "web" })).toBe(true);
    // Path tanpa fitur: memakai permission modul.
    expect(allowedFor(perms, "hr.read", { path: "/me/whatever" })).toBe(true);
    expect(allowedFor(perms, "hr.manage", { path: "/me/whatever" })).toBe(false);
    expect(allowedFor(["*"], "billing.manage", { path: "/billing" })).toBe(true);
  });

  it("awalan terpanjang menentukan fitur", () => {
    expect(featureForPath("sales", "/sales/commissions/1")?.key).toBe("commissions");
    expect(featureForPath("sales", "/sale-orders/1")?.key).toBe("orders");
    expect(featureForPath("payroll", "/payroll/settings")?.key).toBe("settings");
    expect(featureForPath("payroll", "/payroll/runs", "web")?.key).toBe("runs");
  });
});

describe("delegasi", () => {
  it("hanya hak yang dimiliki pemberi; hak admin hanya oleh admin penuh", () => {
    const granter = effectivePermissions(
      { roles: [{ permissions: ["user.read", "user.write", "hr.write"], companyId: null }], overrides: [] },
      A,
    );
    expect(canDelegate(granter, "hr.read")).toBe(true);
    expect(canDelegate(granter, "hr.recruitment.write")).toBe(true);
    expect(canDelegate(granter, "hr.manage")).toBe(false);
    expect(canDelegate(granter, "accounting.read")).toBe(false);
    expect(canDelegate(granter, "user.write")).toBe(false);
    expect(canDelegate(granter, "*")).toBe(false);
    expect(canDelegate(["*"], "user.write")).toBe(true);
  });

  it("templat hanya memakai kode yang sah", () => {
    for (const t of ROLE_TEMPLATES)
      for (const p of t.permissions) expect(ALL_PERMISSION_CODES.has(p), p).toBe(true);
  });
});
