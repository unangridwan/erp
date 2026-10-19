"use client";

import { ApiError } from "./api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const TOKEN_KEY = "erp.portal";

/** Sesi portal pelanggan (terpisah dari sesi user internal). */
export const portalSession = {
  token: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string | null) => {
    try {
      if (token === null) localStorage.removeItem(TOKEN_KEY);
      else localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Penyimpanan tidak tersedia; sesi hanya berlaku di halaman ini.
    }
  },
};

export async function portalFetch(path: string, init: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = portalSession.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 401 && !path.startsWith("/portal/auth/") && typeof window !== "undefined") {
    portalSession.set(null);
    window.location.href = "/portal/login";
  }
  return res;
}

export async function portalApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await portalFetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.message ?? res.statusText, {}, data);
  return data as T;
}

/** Unduh berkas (PDF) dari API portal. */
export async function portalDownload(path: string, filename: string) {
  const res = await portalFetch(path);
  if (!res.ok) throw new Error(res.statusText);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
