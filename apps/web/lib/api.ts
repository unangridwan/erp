"use client";

import { setErrorUser } from "./error-reporting";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const TOKEN_KEY = "erp.token";
const REFRESH_KEY = "erp.refresh";
const COMPANY_KEY = "erp.company";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Penyimpanan tidak tersedia (mode privat); sesi hanya berlaku di tab ini.
  }
}

export interface Session {
  token: string;
  refreshToken: string;
}

/** Cache tingkat modul (definisi field kustom, jenis kontrak, …) yang harus dibuang saat sesi berganti. */
const sessionResetHooks = new Set<() => void>();
export function onSessionReset(fn: () => void) {
  sessionResetHooks.add(fn);
  return () => sessionResetHooks.delete(fn);
}
const resetSessionCaches = () => sessionResetHooks.forEach((fn) => fn());

export const session = {
  token: () => read(TOKEN_KEY),
  set: (s: Session) => {
    // Login baru (bukan perpanjangan token): data cache milik sesi sebelumnya tidak boleh terbawa.
    if (!read(TOKEN_KEY)) resetSessionCaches();
    write(TOKEN_KEY, s.token);
    write(REFRESH_KEY, s.refreshToken);
  },
  companyId: () => read(COMPANY_KEY),
  setCompanyId: (id: string | null) => write(COMPANY_KEY, id),
  clear: () => {
    write(TOKEN_KEY, null);
    write(REFRESH_KEY, null);
    write(COMPANY_KEY, null);
    setErrorUser(null);
    resetSessionCaches();
  },
  async logout() {
    const refreshToken = read(REFRESH_KEY);
    session.clear();
    if (refreshToken) await rawFetch("/auth/logout", "POST", { refreshToken }).catch(() => undefined);
  },
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors: Record<string, string> = {},
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function rawFetch(path: string, method: string, body?: unknown): Promise<Response> {
  // Pesan error API mengikuti bahasa tampilan.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept-Language": read("erp.locale") === "en" ? "en" : "id",
  };
  const token = read(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  const companyId = read(COMPANY_KEY);
  if (companyId) headers["X-Company-Id"] = companyId;
  return fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Endpoint publik / pemeriksa kode: 401 di sini berarti kredensial atau kode salah, bukan sesi kedaluwarsa. */
const PUBLIC_AUTH = new Set([
  "/auth/login",
  "/auth/signup",
  "/auth/refresh",
  "/auth/logout",
  "/auth/invitation",
  "/auth/accept-invite",
  "/auth/2fa/enable",
  "/auth/2fa/disable",
]);

/** Hasil perpanjangan sesi: "network" = server tak terjangkau (sesi mungkin masih berlaku, jangan logout). */
type RefreshResult = "ok" | "expired" | "network";

/** Satu refresh berjalan untuk semua request yang gagal 401 bersamaan (dalam tab ini). */
let refreshing: Promise<RefreshResult> | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function doRefresh(): Promise<RefreshResult> {
  const used = read(REFRESH_KEY);
  if (!used) return "expired";
  for (let attempt = 0; attempt < 3; attempt++) {
    // Tab lain sudah memperbarui sesi (refresh token berotasi): pakai hasilnya, jangan kirim token lama lagi —
    // server menganggap pemakaian ulang sebagai pencurian dan mencabut semua sesi.
    const current = read(REFRESH_KEY);
    if (current !== used) return current ? "ok" : "expired";
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: used }),
    }).catch(() => null);
    if (res?.ok) {
      session.set((await res.json()) as Session);
      return "ok";
    }
    // Gagal jaringan / dibatasi / server error: coba lagi sebentar lagi; 4xx lain berarti sesi memang berakhir.
    if (res && res.status !== 429 && res.status < 500) return "expired";
    await sleep(1000 * (attempt + 1));
  }
  return "network";
}

function refreshSession(): Promise<RefreshResult> {
  refreshing ??= (async () => {
    // Kunci lintas tab: hanya satu tab yang memutar refresh token pada satu waktu.
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    return locks ? locks.request("erp.refresh", doRefresh) : doRefresh();
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

// Tab lain mengganti perusahaan aktif atau keluar: muat ulang tab ini agar data & penyimpanan tidak tercampur.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === COMPANY_KEY && e.newValue && e.oldValue && e.newValue !== e.oldValue)
      window.location.reload();
    if (e.key === TOKEN_KEY && e.oldValue && !e.newValue && !window.location.pathname.startsWith("/login"))
      window.location.href = "/login";
  });
}

/** Request ke API dengan token & perusahaan aktif; access token kedaluwarsa diperbarui otomatis sekali. */
export async function apiRaw(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const method = init.method ?? "GET";
  const isPublic = PUBLIC_AUTH.has(path);
  let res = await rawFetch(path, method, init.body);
  if (res.status !== 401 || isPublic) return res;
  const refreshed = await refreshSession();
  if (refreshed === "ok") res = await rawFetch(path, method, init.body);
  // Hanya sesi yang benar-benar berakhir yang dikeluarkan; gangguan jaringan sesaat tidak menghapus form yang terisi.
  if (refreshed === "expired" && typeof window !== "undefined") {
    session.clear();
    // Kembali ke halaman semula setelah masuk lagi.
    const here = window.location.pathname + window.location.search;
    window.location.href = here.startsWith("/login") ? "/login" : `/login?next=${encodeURIComponent(here)}`;
  }
  return res;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await apiRaw(path, init);
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errors = (data.errors ?? []) as { path: string; message: string }[];
    const fieldErrors = Object.fromEntries(errors.map((e) => [e.path, e.message]));
    throw new ApiError(res.status, data.message ?? res.statusText, fieldErrors, data);
  }
  return data as T;
}

export interface Me {
  tenantId: string;
  userId: string;
  name: string;
  email: string;
  twoFactorEnabled: boolean;
  platformAdmin: boolean;
  permissions: string[];
  companies: { id: string; code: string; name: string; isDefault: boolean }[];
  activeCompanyId: string;
  subscription: {
    planCode: string;
    planName: string;
    status: "trialing" | "active" | "past_due" | "cancelling" | "expired" | "suspended";
    writable: boolean;
    modules: string[];
    maxUsers: number | null;
    maxCompanies: number | null;
  };
}

const NEXT_KEY = "erp.next";

/** Tujuan setelah login (`?next=`): hanya path internal, bukan URL luar. */
export function safeNext(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}

/** Simpan tujuan setelah login yang melewati penyedia identitas (SSO) — kembali lewat /login/sso. */
export const pendingNext = {
  set(value: string | null) {
    try {
      if (value) sessionStorage.setItem(NEXT_KEY, value);
      else sessionStorage.removeItem(NEXT_KEY);
    } catch {
      // Penyimpanan tidak tersedia: setelah SSO kembali ke beranda.
    }
  },
  take(): string | null {
    try {
      const value = sessionStorage.getItem(NEXT_KEY);
      sessionStorage.removeItem(NEXT_KEY);
      return safeNext(value);
    } catch {
      return null;
    }
  },
};
