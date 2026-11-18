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
  private credentials: { email: string; password: string; tenantSlug: string } | null = null;
  private refreshing: Promise<void> | null = null;
  constructor(readonly base: string) {}

  async req<T = any>(method: string, path: string, body?: unknown, company = this.company): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      this.calls++;
      let res: Response;
      const token = this.token;
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
      if (res.status === 401 && attempt < 2 && (this.refreshToken || this.credentials)) {
        await this.renew(token);
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
  /** Klien yang selalu memakai perusahaan `company` (aman dipakai paralel antar-perusahaan). */
  as(company: string) {
    return {
      get: <T = any>(path: string) => this.get<T>(path, company),
      post: <T = any>(path: string, body?: unknown) => this.post<T>(path, body, company),
      put: <T = any>(path: string, body?: unknown) => this.put<T>(path, body, company),
      patch: <T = any>(path: string, body?: unknown) => this.patch<T>(path, body, company),
      list: <T = any>(path: string) => this.list<T>(path, company),
    };
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
    this.credentials = { email, password, tenantSlug };
  }
  setSession(r: any) {
    this.token = r.token ?? r.accessToken;
    this.refreshToken = r.refreshToken ?? "";
  }
  /**
   * Perbarui sesi sekali untuk semua permintaan paralel yang kena 401 (refresh token dipakai bersamaan dianggap
   * pemakaian ulang oleh server). Bila refresh gagal, login ulang dengan kredensial yang sama.
   */
  private renew(staleToken: string) {
    if (this.token !== staleToken) return Promise.resolve();
    this.refreshing ??= (async () => {
      try {
        const r = this.refreshToken
          ? await fetch(this.base + "/auth/refresh", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ refreshToken: this.refreshToken }),
            }).catch(() => null)
          : null;
        if (r?.ok) this.setSession(await r.json());
        else if (this.credentials) {
          const c = this.credentials;
          const res = await fetch(this.base + "/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(c),
          });
          if (res.ok) this.setSession(await res.json());
        }
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
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
