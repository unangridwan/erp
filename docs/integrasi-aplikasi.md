# Integrasi aplikasi lain dengan ERP

Panduan untuk menghubungkan aplikasi buatan sendiri (contoh di sini: aplikasi manajemen proyek Next.js) ke ERP:

1. **Satu akun login** — pengguna masuk ke aplikasi memakai akun ERP (ERP berperan sebagai penyedia login
   OpenID Connect).
2. **API dengan akun layanan** — server aplikasi membaca data karyawan & departemen dari ERP.
3. **Webhook** — ERP memberi tahu aplikasi saat karyawan/departemen dibuat, diubah, diarsipkan, atau dihapus.

## 1. Daftarkan aplikasi di ERP

Pengaturan › **Aplikasi Terhubung** › _Tambah aplikasi_ (hanya administrator penuh):

| Isian                      | Contoh                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Nama aplikasi              | Aplikasi Proyek                                                                                                |
| Redirect URI               | `https://proyek.perusahaan.co.id/api/auth/callback/erp` (lokal: `http://localhost:4000/api/auth/callback/erp`) |
| URL kembali setelah logout | `https://proyek.perusahaan.co.id/`                                                                             |
| Peran yang boleh masuk     | kosong = semua pengguna aktif; atau pilih peran tertentu                                                       |
| Peran akun layanan (API)   | buat dulu peran berisi _Karyawan › Lihat_ (`hr.read`), lalu pilih peran itu                                    |
| Webhook                    | `https://proyek.perusahaan.co.id/api/erp/webhook` + event karyawan & departemen                                |

Setelah disimpan, ERP menampilkan **Client ID**, **Client secret**, dan **Secret webhook**. Secret hanya
ditampilkan sekali; simpan di variabel lingkungan aplikasi. Bila hilang, pakai tombol _Ganti client secret_ atau
_Ganti secret webhook_.

Hak API aplikasi sama dengan hak peran akun layanannya. Untuk mengubahnya, buka tautan _Atur hak akun layanan_ di
halaman aplikasi (halaman pengguna biasa). Akun layanan tidak bisa login, tidak muncul di daftar pengguna, dan tidak
dihitung dalam batas pengguna paket.

## 2. Login dengan akun ERP (Auth.js / NextAuth v5)

```bash
# .env.local aplikasi proyek
ERP_ISSUER=https://api.erp.perusahaan.co.id        # = API_ORIGIN ERP (tanpa / di akhir)
ERP_WEB=https://erp.perusahaan.co.id               # = WEB_ORIGIN ERP
ERP_CLIENT_ID=<client id dari ERP>
ERP_CLIENT_SECRET=<client secret dari ERP>
ERP_WEBHOOK_SECRET=<secret webhook dari ERP>
AUTH_SECRET=<acak, minimal 32 karakter>
```

```ts
// auth.ts
import NextAuth from "next-auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    {
      id: "erp",
      name: "ERP",
      type: "oidc",
      issuer: process.env.ERP_ISSUER,
      clientId: process.env.ERP_CLIENT_ID,
      clientSecret: process.env.ERP_CLIENT_SECRET,
      authorization: { params: { scope: "openid profile email employee" } },
      checks: ["pkce", "state", "nonce"],
      profile(p) {
        return { id: p.sub, name: p.name, email: p.email, employeeId: p.employee_id };
      },
    },
  ],
  callbacks: {
    jwt({ token, profile, account }) {
      if (profile) {
        token.employeeId = profile.employee_id; // id karyawan ERP → tautkan ke anggota proyek
        token.department = profile.department;
      }
      if (account?.id_token) token.idToken = account.id_token; // untuk logout
      return token;
    },
    session({ session, token }) {
      return { ...session, employeeId: token.employeeId, idToken: token.idToken };
    },
  },
});
```

```ts
// app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

Tombol masuk: `await signIn("erp")`. Bila pengguna belum login di ERP, ia diarahkan ke halaman login ERP (termasuk
SSO/2FA), lalu kembali ke aplikasi.

**Logout dari keduanya** — setelah `signOut({ redirect: false })`, arahkan ke:

```ts
const url = new URL(`${process.env.ERP_WEB}/oauth/logout`);
url.searchParams.set("id_token_hint", session.idToken);
url.searchParams.set("post_logout_redirect_uri", "https://proyek.perusahaan.co.id/");
redirect(url.toString());
```

### Klaim yang tersedia

| Scope      | Klaim                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------- |
| `openid`   | `sub` (id user ERP), `tenant`                                                             |
| `profile`  | `name`, `preferred_username`, `roles` (kode peran)                                        |
| `email`    | `email`, `email_verified`                                                                 |
| `employee` | `employee_id`, `employee_number`, `company_id`, `company_name`, `department`, `job_title` |

Endpoint: discovery `${ERP_ISSUER}/.well-known/openid-configuration`, token `/oauth/token`, userinfo
`/oauth/userinfo`, JWKS `/oauth/jwks`, revoke `/oauth/revoke`, otorisasi & logout di web ERP (`/oauth/authorize`,
`/oauth/logout`). Hanya `response_type=code` dengan PKCE `S256`. Access token login berlaku 15 menit (bawaan, `ACCESS_TOKEN_TTL`; `id_token` 1 jam) dan **hanya**
untuk profil (`/oauth/userinfo`, `/auth/me`, `GET /me/*`); untuk API gunakan akun layanan.

> Pengembangan lokal memakai `http://localhost`. Di produksi issuer, web ERP, dan redirect URI wajib `https://`.

## 3. Panggil API ERP dengan akun layanan

```ts
// lib/erp.ts — token akun layanan (client_credentials), di-cache sampai hampir kedaluwarsa
let cached: { token: string; until: number } | undefined;

async function serviceToken() {
  if (cached && cached.until > Date.now()) return cached.token;
  const res = await fetch(`${process.env.ERP_ISSUER}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(
        `${encodeURIComponent(process.env.ERP_CLIENT_ID!)}:${encodeURIComponent(process.env.ERP_CLIENT_SECRET!)}`,
      ).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`Token ERP gagal: ${res.status} ${await res.text()}`);
  const t = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: t.access_token, until: Date.now() + (t.expires_in - 60) * 1000 };
  return t.access_token;
}

export async function erp<T>(path: string): Promise<T> {
  const res = await fetch(`${process.env.ERP_ISSUER}${path}`, {
    headers: { Authorization: `Bearer ${await serviceToken()}` },
  });
  if (!res.ok) throw new Error(`ERP ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

/** Sinkron karyawan (awal & rekonsiliasi berkala): halaman demi halaman sejak `since`. */
export async function syncEmployees(since?: string) {
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ limit: "500" });
    if (since) q.set("updatedSince", since);
    if (cursor) q.set("cursor", cursor);
    const page = await erp<{ items: Employee[]; nextCursor: string | null }>(`/integrations/employees?${q}`);
    for (const e of page.items) await upsertMember(e); // simpan di database aplikasi proyek
    cursor = page.nextCursor;
  } while (cursor);
}
```

Data karyawan (`/integrations/employees`, juga isi webhook): `id`, `employeeNumber`, `name`, `companyId`,
`companyName`, `departmentId`, `department`, `jobId`, `jobTitle`, `managerId`, `userId` (= `sub` saat login),
`workEmail`, `workPhone`, `personalPhone`, `tags`, `joinDate`, `resignDate`, `active`, `updatedAt`. Data sensitif
(NIK, NPWP, rekening, gaji) tidak pernah dikirim. Departemen: `/integrations/departments` (`id`, `companyId`, `name`,
`parentId`, `managerId`, `active`, `updatedAt`). Akun layanan juga bisa memakai endpoint REST lain sesuai hak
perannya (lihat README).

## 4. Terima webhook

ERP mengirim `POST` JSON ke URL webhook:

```json
{
  "id": "6b0c…",
  "event": "employee.updated",
  "occurredAt": "2026-10-27T09:30:00.000Z",
  "tenant": "maju-bersama",
  "data": { "id": "…", "name": "Dewi Lestari", "department": "Keuangan", "active": true, "…": "…" }
}
```

Header: `X-ERP-Event`, `X-ERP-Delivery` (id unik; abaikan bila sudah diproses), dan
`X-ERP-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`. `data` berisi kondisi **terbaru** saat
dikirim (event `*.deleted` hanya `{ id }`). Balas 2xx dalam 10 detik; selain itu ERP mencoba lagi (30 dtk, 1, 2, 4 …
menit, maksimal 8 kali). Log pengiriman, tes, dan _Kirim ulang_ ada di halaman aplikasi.

```ts
// app/api/erp/webhook/route.ts
import { createHmac, timingSafeEqual } from "node:crypto";

export async function POST(req: Request) {
  const body = await req.text();
  const [, t, v1] = (req.headers.get("x-erp-signature") ?? "").match(/^t=(\d+),v1=([0-9a-f]{64})$/) ?? [];
  const expected = createHmac("sha256", process.env.ERP_WEBHOOK_SECRET!).update(`${t}.${body}`).digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300; // tolak pengiriman ulang lama
  if (!v1 || !fresh || !timingSafeEqual(Buffer.from(v1), Buffer.from(expected)))
    return new Response("signature tidak valid", { status: 401 });

  const event = JSON.parse(body) as { id: string; event: string; data: { id: string } };
  switch (event.event) {
    case "employee.created":
    case "employee.updated":
    case "employee.reactivated":
      await upsertMember(event.data);
      break;
    case "employee.archived": // resign / dinonaktifkan: lepas dari proyek aktif
    case "employee.deleted":
      await deactivateMember(event.data.id);
      break;
  }
  return new Response("ok");
}
```

Event yang tersedia: `employee.created|updated|archived|reactivated|deleted`,
`department.created|updated|archived|reactivated|deleted`.
