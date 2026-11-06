/* eslint-disable @typescript-eslint/no-explicit-any -- respons API berupa JSON tanpa tipe. */
/** Klien HTTP kecil untuk API ERP: token, perusahaan aktif, coba ulang. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly path: string,
  ) {
    super(
      `${status} ${path}: ${typeof body === "object" ? JSON.stringify(body).slice(0, 600) : String(body)}`,
    );
  }
}

export class Api {
  token = "";
  refreshToken = "";
  company: string | null = null;
  calls = 0;
  constructor(readonly base: string) {}

  async req<T = any>(method: string, path: string, body?: unknown, company = this.company): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      this.calls++;
      let res: Response;
      try {
        res = await fetch(this.base + path, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
            ...(company ? { "X-Company-Id": company } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e) {
        if (attempt < 4) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw e;
      }
      if (res.status === 401 && this.refreshToken && attempt === 0) {
        await this.refresh();
        continue;
      }
      if ((res.status === 429 || res.status >= 502) && attempt < 6) {
        await sleep(1000 * 2 ** Math.min(attempt, 4));
        continue;
      }
      const text = await res.text();
      const data = text ? safeJson(text) : null;
      if (!res.ok) throw new ApiError(res.status, data, `${method} ${path}`);
      return data as T;
    }
  }
  get<T = any>(path: string, company?: string | null) {
    return this.req<T>("GET", path, undefined, company === undefined ? this.company : company);
  }
  post<T = any>(path: string, body?: unknown, company?: string | null) {
    return this.req<T>("POST", path, body ?? {}, company === undefined ? this.company : company);
  }
  put<T = any>(path: string, body?: unknown, company?: string | null) {
    return this.req<T>("PUT", path, body ?? {}, company === undefined ? this.company : company);
  }
  patch<T = any>(path: string, body?: unknown, company?: string | null) {
    return this.req<T>("PATCH", path, body ?? {}, company === undefined ? this.company : company);
  }
  /** Daftar lengkap (endpoint list memuat s.d. 5.000 baris). */
  async list<T = any>(path: string, company?: string | null): Promise<T[]> {
    const sep = path.includes("?") ? "&" : "?";
    const r = await this.get<any>(`${path}${sep}limit=5000`, company);
    return (Array.isArray(r) ? r : (r.items ?? [])) as T[];
  }

  async login(email: string, password: string, tenantSlug: string) {
    const r = await this.req<any>("POST", "/auth/login", { email, password, tenantSlug }, null);
    this.setSession(r);
  }
  setSession(r: any) {
    this.token = r.token ?? r.accessToken;
    this.refreshToken = r.refreshToken ?? "";
  }
  private async refresh() {
    const r = await fetch(this.base + "/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: this.refreshToken }),
    });
    if (r.ok) this.setSession(await r.json());
  }
}

const safeJson = (t: string) => {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
