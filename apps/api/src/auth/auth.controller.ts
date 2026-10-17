import { Body, Controller, Get, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { acceptInviteSchema, loginSchema, refreshSchema, signupSchema, totpCodeSchema } from "@erp/shared";
import type { Request } from "express";
import { z } from "zod";
import { parse } from "../common/zod.js";
import { currentContext } from "../common/request-context.js";
import { AuthService, type Principal } from "./auth.service.js";
import { Public } from "./decorators.js";

const tokenSchema = z.object({ token: z.string().min(20) });
const ip = (req: Request) => req.ip ?? "unknown";

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post("signup")
  signup(@Body() body: unknown, @Req() req: Request) {
    return this.auth.signup(parse(signupSchema, body), ip(req));
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body() body: unknown, @Req() req: Request) {
    return this.auth.login(parse(loginSchema, body), ip(req));
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body() body: unknown, @Req() req: Request) {
    return this.auth.refresh(parse(refreshSchema, body).refreshToken, ip(req));
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  async logout(@Body() body: unknown) {
    await this.auth.logout(parse(refreshSchema, body).refreshToken);
  }

  @Get("me")
  me(@Req() req: Request & { principal: Principal }) {
    return { ...req.principal, activeCompanyId: currentContext().companyId };
  }

  @Post("2fa/setup")
  @HttpCode(200)
  setupTotp() {
    return this.auth.setupTotp(currentContext().userId);
  }

  @Post("2fa/enable")
  @HttpCode(204)
  async enableTotp(@Body() body: unknown) {
    await this.auth.enableTotp(currentContext().userId, parse(totpCodeSchema, body).code);
  }

  @Post("2fa/disable")
  @HttpCode(204)
  async disableTotp(@Body() body: unknown) {
    await this.auth.disableTotp(currentContext().userId, parse(totpCodeSchema, body).code);
  }

  /** Token undangan dikirim lewat body (bukan URL) agar tidak tercatat di log akses. */
  @Public()
  @Post("invitation")
  @HttpCode(200)
  invitation(@Body() body: unknown) {
    return this.auth.invitationInfo(parse(tokenSchema, body).token);
  }

  @Public()
  @Post("accept-invite")
  acceptInvite(@Body() body: unknown, @Req() req: Request) {
    return this.auth.acceptInvitation(parse(acceptInviteSchema, body), ip(req));
  }
}
