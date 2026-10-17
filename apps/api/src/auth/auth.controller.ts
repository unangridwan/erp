import { Body, Controller, Get, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { loginSchema, signupSchema } from "@erp/shared";
import type { Request } from "express";
import { parse } from "../common/zod.js";
import { currentContext } from "../common/request-context.js";
import { AuthService, type Principal } from "./auth.service.js";
import { Public } from "./decorators.js";

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post("signup")
  signup(@Body() body: unknown) {
    return this.auth.signup(parse(signupSchema, body));
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body() body: unknown) {
    return this.auth.login(parse(loginSchema, body));
  }

  @Get("me")
  me(@Req() req: Request & { principal: Principal }) {
    return { ...req.principal, activeCompanyId: currentContext().companyId };
  }
}
