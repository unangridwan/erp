import { BadRequestException } from "@nestjs/common";
import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/**
 * Pemanggilan HTTP keluar ke URL yang diisi tenant (webhook, discovery SSO). Tanpa penjagaan, URL itu bisa diarahkan
 * ke localhost, jaringan internal, atau metadata cloud (SSRF). Alamat tujuan diperiksa saat koneksi dibuat (bukan
 * hanya saat URL disimpan) sehingga DNS rebinding tidak lolos, dan redirect tidak pernah diikuti.
 */
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 127], // :: dan ::1
  ["64:ff9b::", 96], // NAT64
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(net, prefix, "ipv6");

// Tujuan IPv4-mapped tidak pernah wajar untuk webhook; BlockList terpisah karena aturan IPv6 ::ffff:0:0/96 pada
// daftar utama ikut mencocokkan semua alamat IPv4.
const mapped = new BlockList();
mapped.addSubnet("::ffff:0:0", 96, "ipv6");

/** Alamat loopback, privat, link-local, CGNAT, multicast, atau tercadang. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, "ipv4");
  // IPv4-mapped (::ffff:a.b.c.d) dinilai dari alamat IPv4 di dalamnya.
  if (family === 6) return mapped.check(ip, "ipv6") ? true : blocked.check(ip, "ipv6");
  return true;
}

/** Dev/test: izinkan tujuan lokal (mis. penerima webhook di localhost). Jangan dinyalakan di produksi. */
const allowPrivate = () => process.env.ALLOW_PRIVATE_WEBHOOKS === "true";

/** Validasi bentuk URL tujuan (dipakai saat menyimpan dan sebelum memanggil). */
export function assertPublicUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException("URL tidak valid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new BadRequestException("URL harus http atau https");
  if (url.username || url.password)
    throw new BadRequestException("URL tidak boleh memuat nama pengguna/sandi");
  if (allowPrivate()) return url;
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    throw new BadRequestException("URL harus https");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    !host.includes(".")
  )
    if (!isIP(host)) throw new BadRequestException("URL mengarah ke alamat internal");
  if (isIP(host) && isPrivateAddress(host)) throw new BadRequestException("URL mengarah ke alamat internal");
  return url;
}

/** `lookup` untuk soket: menolak hasil DNS yang mengarah ke alamat internal. */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as unknown as { address: string; family: number }[];
    if (!allowPrivate() && list.some((a) => isPrivateAddress(a.address))) {
      const e = new Error("Alamat tujuan internal ditolak") as NodeJS.ErrnoException;
      e.code = "EBLOCKED";
      return callback(e, "", 0);
    }
    if ((options as { all?: boolean }).all) return callback(null, list as never, 0);
    const first = list[0]!;
    callback(null, first.address, first.family);
  });
};

/** Agent untuk pustaka yang memakai `http(s).get` sendiri (mis. JWKS jarak jauh). */
export const guardedAgents = {
  http: new http.Agent({ lookup: guardedLookup }),
  https: new https.Agent({ lookup: guardedLookup }),
};
export const guardedAgentFor = (url: URL) =>
  url.protocol === "https:" ? guardedAgents.https : guardedAgents.http;

export interface SafeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

const MAX_BODY = 1024 * 1024;

/** POST/GET ke URL luar: tujuan diperiksa, redirect tidak diikuti, isi respons dibatasi 1 MB. */
export async function safeFetch(
  target: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<SafeResponse> {
  const url = assertPublicUrl(target);
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method: init.method ?? "GET",
        headers: {
          ...init.headers,
          ...(init.body !== undefined ? { "Content-Length": String(Buffer.byteLength(init.body)) } : {}),
        },
        agent: guardedAgentFor(url),
        timeout: init.timeoutMs ?? 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY) return req.destroy(new Error("Respons terlalu besar"));
          chunks.push(c);
        });
        res.on("error", reject);
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: async () => text,
            json: async () => JSON.parse(text) as unknown,
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Waktu tunggu habis")));
    req.on("error", reject);
    req.end(init.body);
  });
}
