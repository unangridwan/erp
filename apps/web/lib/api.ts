"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const TOKEN_KEY = "erp.token";
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

export const session = {
  token: () => read(TOKEN_KEY),
  setToken: (token: string | null) => write(TOKEN_KEY, token),
  companyId: () => read(COMPANY_KEY),
  setCompanyId: (id: string | null) => write(COMPANY_KEY, id),
  clear: () => {
    write(TOKEN_KEY, null);
    write(COMPANY_KEY, null);
  },
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = session.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  const companyId = session.companyId();
  if (companyId) headers["X-Company-Id"] = companyId;

  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      session.clear();
      window.location.href = "/login";
    }
    const fieldErrors = Object.fromEntries(
      ((data.errors ?? []) as { path: string; message: string }[]).map((e) => [e.path, e.message]),
    );
    throw new ApiError(res.status, data.message ?? res.statusText, fieldErrors);
  }
  return data as T;
}

export interface Me {
  tenantId: string;
  name: string;
  email: string;
  permissions: string[];
  companies: { id: string; code: string; name: string; isDefault: boolean }[];
  activeCompanyId: string;
}
