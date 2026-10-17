import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasPermission, type Permission } from "@erp/shared";
import type { Request } from "express";
import { setContext } from "../common/request-context.js";
import { AuthService, type Principal } from "./auth.service.js";
import { IS_PUBLIC, REQUIRED_PERMISSION } from "./decorators.js";

export const COMPANY_HEADER = "x-company-id";

/** Guard global: verifikasi JWT, muat principal, tetapkan perusahaan aktif, cek permission. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new UnauthorizedException("Butuh autentikasi");

    const principal = await this.auth.loadPrincipal(await this.auth.verifyToken(token));
    if (!principal) throw new UnauthorizedException("User tidak aktif");

    const companyIds = principal.companies.map((c) => c.id);
    const requested = req.headers[COMPANY_HEADER];
    const companyId =
      typeof requested === "string" && requested
        ? requested
        : (principal.companies.find((c) => c.isDefault) ?? principal.companies[0])?.id;
    if (!companyId || !companyIds.includes(companyId)) {
      throw new ForbiddenException("Tidak punya akses ke perusahaan ini");
    }

    req.principal = principal;
    setContext({
      tenantId: principal.tenantId,
      userId: principal.userId,
      companyIds,
      companyId,
      permissions: principal.permissions,
    });

    const required = this.reflector.getAllAndOverride<Permission | undefined>(REQUIRED_PERMISSION, targets);
    if (required && !hasPermission(principal.permissions, required)) {
      throw new ForbiddenException(`Butuh permission ${required}`);
    }
    return true;
  }
}
