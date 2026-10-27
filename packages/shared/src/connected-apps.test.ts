import { describe, expect, it } from "vitest";
import { connectedAppSchema, isAllowedRedirectUri, normalizeScope } from "./connected-apps.js";

describe("aplikasi terhubung", () => {
  it("normalizeScope: openid wajib, scope tak dikenal dibuang, urutan tetap", () => {
    expect(normalizeScope("email openid foo profile")).toBe("openid profile email");
    expect(normalizeScope("profile email")).toBeUndefined();
    expect(normalizeScope(undefined)).toBeUndefined();
  });

  it("redirect URI: https, atau http hanya localhost; tanpa fragmen", () => {
    expect(isAllowedRedirectUri("https://proyek.example.com/api/auth/callback/erp")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:3000/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:3000/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://proyek.example.com/cb")).toBe(false);
    expect(isAllowedRedirectUri("https://proyek.example.com/cb#x")).toBe(false);
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("bukan url")).toBe(false);
  });

  it("skema: event webhook dikenal saja", () => {
    expect(connectedAppSchema.safeParse({ name: "X", webhookEvents: ["employee.created"] }).success).toBe(
      true,
    );
    expect(connectedAppSchema.safeParse({ name: "X", webhookEvents: ["invoice.posted"] }).success).toBe(
      false,
    );
  });
});
