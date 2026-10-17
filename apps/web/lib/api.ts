"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
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

export const session = {
  token: () => read(TOKEN_KEY),
  set: (s: Session) => {
    write(TOKEN_KEY, s.token);
    write(REFRESH_KEY, s.refreshToken);
  },
  companyId: () => read(COMPANY_KEY),
  setCompanyId: (id: string | null) => write(COMPANY_KEY, id),
  clear: () => {
    write(TOKEN_KEY, null);
    write(REFRESH_KEY, null);
    write(COMPANY_KEY, null);
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
  const headers: Record<string, string> = { "Content-Type": "application/json" };
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

/** Endpoint publik: 401 di sini berarti kredensial salah, bukan sesi kedaluwarsa. */
const PUBLIC_AUTH = new Set([
  "/auth/login",
  "/auth/signup",
  "/auth/refresh",
  "/auth/logout",
  "/auth/invitation",
  "/auth/accept-invite",
]);

/** Satu refresh berjalan untuk semua request yang gagal 401 bersamaan. */
let refreshing: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const refreshToken = read(REFRESH_KEY);
    if (!refreshToken) return false;
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => null);
    if (!res?.ok) return false;
    session.set((await res.json()) as Session);
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Request ke API dengan token & perusahaan aktif; access token kedaluwarsa diperbarui otomatis sekali. */
export async function apiRaw(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const method = init.method ?? "GET";
  const isPublic = PUBLIC_AUTH.has(path);
  let res = await rawFetch(path, method, init.body);
  if (res.status === 401 && !isPublic && (await refreshSession())) {
    res = await rawFetch(path, method, init.body);
  }
  if (res.status === 401 && !isPublic && typeof window !== "undefined") {
    session.clear();
    window.location.href = "/login";
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
  name: string;
  email: string;
  twoFactorEnabled: boolean;
  permissions: string[];
  companies: { id: string; code: string; name: string; isDefault: boolean }[];
  activeCompanyId: string;
}
