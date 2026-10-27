import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Query, Req, Res } from "@nestjs/common";
import { oauthAuthorizeSchema } from "@erp/shared";
import type { Request, Response } from "express";
import type { Principal } from "../auth/auth.service.js";
import { AllowInactive, Public } from "../auth/decorators.js";
import { parse } from "../common/zod.js";
import { OAuthError, OAuthService } from "./oauth.service.js";
import { OidcKeysService } from "./oidc-keys.service.js";

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Endpoint penyedia login OpenID Connect (discovery, JWKS, token, userinfo, revoke, logout). */
@AllowInactive()
@Controller()
export class OAuthController {
  constructor(
    @Inject(OAuthService) private readonly oauth: OAuthService,
    @Inject(OidcKeysService) private readonly keys: OidcKeysService,
  ) {}

  @Public()
  @Get(".well-known/openid-configuration")
  discovery() {
    return this.oauth.discovery();
  }

  @Public()
  @Get("oauth/jwks")
  jwks() {
    return this.keys.jwks();
  }

  /** Untuk halaman web: nama aplikasi & tenant, validasi redirect URI sebelum login. */
  @Public()
  @Get("oauth/client")
  client(@Query() q: Record<string, string>) {
    return this.oauth.clientInfo(
      String(q.client_id ?? ""),
      str(q.redirect_uri),
      str(q.post_logout_redirect_uri),
    );
  }

  /** Dipanggil halaman web `/oauth/authorize` atas nama user yang sedang login. */
  @Post("oauth/authorize")
  @HttpCode(200)
  authorize(@Req() req: Request & { principal: Principal }, @Body() body: unknown) {
    return this.oauth.authorize(req.principal, parse(oauthAuthorizeSchema, body));
  }

  @Public()
  @Post("oauth/token")
  async token(@Req() req: Request, @Res() res: Response, @Headers("authorization") authorization?: string) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    try {
      res.status(200).json(await this.oauth.token(this.form(req), authorization, req.ip ?? "unknown"));
    } catch (e) {
      this.fail(res, e);
    }
  }

  @Public()
  @Get("oauth/userinfo")
  userinfo(@Headers("authorization") authorization?: string) {
    return this.oauth.userinfo(authorization);
  }

  @Public()
  @Post("oauth/revoke")
  async revoke(@Req() req: Request, @Res() res: Response, @Headers("authorization") authorization?: string) {
    try {
      await this.oauth.revoke(this.form(req), authorization);
      res.status(200).json({});
    } catch (e) {
      this.fail(res, e);
    }
  }

  /** Untuk halaman web `/oauth/logout`: cabut token aplikasi & tentukan URL kembali. */
  @Public()
  @Post("oauth/logout")
  @HttpCode(200)
  logout(@Body() body: Record<string, unknown>) {
    return this.oauth.logout({
      clientId: str(body?.client_id),
      idTokenHint: str(body?.id_token_hint),
      postLogoutRedirectUri: str(body?.post_logout_redirect_uri),
      state: str(body?.state),
    });
  }

  private form(req: Request): Record<string, string | undefined> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, str(v)]));
  }

  private fail(res: Response, e: unknown) {
    if (e instanceof OAuthError) {
      if (e.status === 401) res.setHeader("WWW-Authenticate", 'Basic realm="oauth"');
      res.status(e.status).json({ error: e.error, error_description: e.message });
      return;
    }
    throw e;
  }
}
