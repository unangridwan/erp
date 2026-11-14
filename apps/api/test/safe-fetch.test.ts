import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateAddress, safeFetch } from "../src/common/safe-fetch.js";

/** Penjaga SSRF: URL yang diisi tenant tidak boleh menjangkau alamat internal. */
describe("safe-fetch", () => {
  const flag = process.env.ALLOW_PRIVATE_WEBHOOKS;
  const server = createServer((req, res) => {
    if (req.url === "/redirect") return res.writeHead(302, { Location: "http://127.0.0.1:1/x" }).end();
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
  });
  let base: string;

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    process.env.ALLOW_PRIVATE_WEBHOOKS = flag;
    server.close();
  });

  it("mengenali alamat internal", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "::",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
      "bukan-ip",
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("menolak URL internal, skema lain, dan kredensial di URL", () => {
    process.env.ALLOW_PRIVATE_WEBHOOKS = "false";
    for (const url of [
      "http://127.0.0.1/hook",
      "http://localhost:3001/health",
      "http://[::1]/",
      "http://169.254.169.254/latest/meta-data/",
      "http://2130706433/",
      "http://0x7f.1/",
      "http://redis:6379/",
      "http://db.internal/",
      "ftp://example.com/",
      "file:///etc/passwd",
      "https://user:pass@example.com/",
      "bukan url",
    ])
      expect(() => assertPublicUrl(url), url).toThrow();
    expect(assertPublicUrl("https://hooks.example.com/erp").hostname).toBe("hooks.example.com");
  });

  it("tidak tersambung ke alamat internal dan tidak mengikuti redirect", async () => {
    process.env.ALLOW_PRIVATE_WEBHOOKS = "false";
    await expect(safeFetch(`${base}/`)).rejects.toThrow("internal");
    // Nama host yang resolve ke loopback ditolak saat koneksi dibuat (bukan hanya dari bentuk URL).
    await expect(safeFetch(`${base.replace("127.0.0.1", "localtest.me")}/`)).rejects.toThrow();

    process.env.ALLOW_PRIVATE_WEBHOOKS = "true";
    const ok = await safeFetch(`${base}/`, { method: "POST", body: "{}" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    const redirect = await safeFetch(`${base}/redirect`);
    expect(redirect).toMatchObject({ ok: false, status: 302 });
  });
});
