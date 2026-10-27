import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { allowedFor, permissionModule, type Permission } from "@erp/shared";
import type { Request } from "express";
import { setContext } from "../common/request-context.js";
import { BillingService } from "../billing/billing.service.js";
import { AuthService, type Principal } from "./auth.service.js";
import { ALLOW_INACTIVE, IS_PUBLIC, PLATFORM_ADMIN, REQUIRED_PERMISSION } from "./decorators.js";

export const COMPANY_HEADER = "x-company-id";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Guard global: verifikasi JWT, muat principal, tetapkan perusahaan aktif, cek permission. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new UnauthorizedException("Butuh autentikasi");

    const requested = req.headers[COMPANY_HEADER];
    const principal = await this.auth.loadPrincipal(
      await this.auth.verifyToken(token),
      typeof requested === "string" && requested ? requested : undefined,
    );
    if (!principal) throw new UnauthorizedException("User tidak aktif");

    const companyIds = principal.companies.map((c) => c.id);
    const companyId = principal.companyId;
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
    // Permission modul diterjemahkan ke fitur pemilik path (mis. hr.read di /applicants → hr.recruitment.read).
    if (required && !allowedFor(principal.permissions, required, { path: req.path, method: req.method })) {
      throw new ForbiddenException(`Butuh permission ${required}`);
    }
    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN, targets)) {
      if (!principal.platformAdmin) throw new ForbiddenException("Khusus admin platform");
      return true;
    }

    // Paket langganan: modul yang tidak termasuk paket terkunci; langganan berakhir = baca saja.
    const access = await this.billing.access(principal.tenantId);
    const module = required && permissionModule(required);
    if (module) this.billing.assertModule(access, module);
    if (!SAFE_METHODS.has(req.method) && !this.reflector.getAllAndOverride<boolean>(ALLOW_INACTIVE, targets))
      this.billing.assertWritable(access);
    return true;
  }
}
