import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put, Query, Req, Res } from "@nestjs/common";
import { ssoConfigSchema } from "@erp/shared";
import type { Request, Response } from "express";
import { z } from "zod";
import { CONFIG, type AppConfig } from "../config.js";
import { TenantDb } from "../common/database.js";
import { parse } from "../common/zod.js";
import { AllowInactive, Public, RequirePermission } from "./decorators.js";
import { SsoService } from "./sso.service.js";

const COOKIE = "erp_sso";
const meta = (req: Request) => ({ ip: req.ip ?? "unknown", userAgent: req.headers["user-agent"] ?? null });
const cookie = (req: Request, name: string) =>
  (req.headers.cookie ?? "")
    .split(";")
    .map((c) => c.trim().split("="))
    .find(([k]) => k === name)?.[1];

@AllowInactive()
@Controller("auth/sso")
export class SsoController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(SsoService) private readonly sso: SsoService,
  ) {}

  /** Untuk halaman login: tombol SSO tenant. */
  @Public()
  @Get("provider")
  provider(@Query("tenant") slug: string) {
    return this.sso.providerFor(String(slug ?? ""));
  }

  /** Mulai login: arahkan peramban ke penyedia identitas. */
  @Public()
  @Get("start/:slug")
  async start(@Param("slug") slug: string, @Req() req: Request, @Res() res: Response) {
    try {
      const { url, bind } = await this.sso.start(slug, meta(req).ip);
      const secure = this.config.apiOrigin.startsWith("https://") ? "; Secure" : "";
      res.setHeader(
        "Set-Cookie",
        `${COOKIE}=${bind}; Path=/auth/sso; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
      );
      res.redirect(302, url);
    } catch (e) {
      this.fail(res, slug, e);
    }
  }

  /**
   * Kembali dari penyedia identitas. Sesi diserahkan ke web lewat fragmen URL berisi refresh token: web langsung
   * menukarnya (rotasi), sehingga token di URL hanya bisa dipakai sekali.
   */
  @Public()
  @Get("callback")
  async callback(@Query() query: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/auth/sso; HttpOnly; SameSite=Lax; Max-Age=0`);
    if (query.error) return this.fail(res, "", new Error(query.error_description || query.error));
    try {
      const input = parse(z.object({ code: z.string().min(1), state: z.string().min(1) }), query);
      const { session } = await this.sso.callback({ ...input, bind: cookie(req, COOKIE) }, meta(req));
      res.redirect(
        302,
        `${this.config.webOrigin}/login/sso#refresh=${encodeURIComponent(session.refreshToken)}`,
      );
    } catch (e) {
      this.fail(res, "", e);
    }
  }

  @Get("config")
  @RequirePermission("settings.manage")
  getConfig() {
    return this.tenantDb.run(
      async (tx) => (await this.sso.getConfig(tx)) ?? { redirectUri: this.sso.redirectUri },
    );
  }

  @Put("config")
  @RequirePermission("settings.manage")
  saveConfig(@Body() body: unknown) {
    const input = parse(ssoConfigSchema, body);
    return this.tenantDb.run((tx) => this.sso.saveConfig(tx, input));
  }

  @Delete("config")
  @HttpCode(204)
  @RequirePermission("settings.manage")
  async deleteConfig() {
    await this.tenantDb.run((tx) => this.sso.deleteConfig(tx));
  }

  private fail(res: Response, slug: string, e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const params = new URLSearchParams({ ssoError: message, ...(slug ? { tenant: slug } : {}) });
    res.redirect(302, `${this.config.webOrigin}/login?${params}`);
  }
}
