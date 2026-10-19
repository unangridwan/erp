import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { acceptInviteSchema, portalInviteSchema, portalLoginSchema } from "@erp/shared";
import type { Request, Response } from "express";
import { Public, RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { setContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { PortalService, type PortalPrincipal } from "./portal.service.js";

type PortalRequest = Request & { portal?: PortalPrincipal };
const ip = (req: Request) => req.ip ?? "unknown";

/** Guard portal: token portal (bukan token user internal); konteks hanya membawa tenant untuk RLS. */
@Injectable()
class PortalGuard implements CanActivate {
  constructor(@Inject(PortalService) private readonly portal: PortalService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<PortalRequest>();
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new UnauthorizedException("Masuk ke portal terlebih dahulu");
    const principal = await this.portal.principal(token);
    req.portal = principal;
    setContext({
      tenantId: principal.tenantId,
      userId: principal.portalUserId,
      companyIds: [],
      companyId: "",
      permissions: [],
    });
    return true;
  }
}

/** Login & penerimaan undangan portal (tanpa token). */
@Public()
@Controller("portal/auth")
export class PortalAuthController {
  constructor(@Inject(PortalService) private readonly portal: PortalService) {}

  @Post("login")
  @HttpCode(200)
  login(@Body() body: unknown, @Req() req: Request) {
    return this.portal.login(parse(portalLoginSchema, body), ip(req));
  }

  @Post("accept")
  @HttpCode(200)
  accept(@Body() body: unknown, @Req() req: Request) {
    return this.portal.accept(parse(acceptInviteSchema, body), ip(req));
  }
}

/** API portal pelanggan. */
@Public()
@UseGuards(PortalGuard)
@Controller("portal")
export class PortalController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(PortalService) private readonly portal: PortalService,
  ) {}

  @Get("me")
  me(@Req() req: PortalRequest) {
    return this.tenantDb.run((tx) => this.portal.me(tx, req.portal!));
  }

  @Get("orders")
  orders(@Req() req: PortalRequest) {
    return this.tenantDb.run((tx) => this.portal.orders(tx, req.portal!));
  }

  @Get("orders/:id")
  order(@Req() req: PortalRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.portal.order(tx, req.portal!, id));
  }

  @Post("orders/:id/accept")
  @HttpCode(200)
  accept(@Req() req: PortalRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.portal.acceptOrder(tx, req.portal!, id));
  }

  @Get("orders/:id/pdf")
  async orderPdf(@Req() req: PortalRequest, @Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const pdf = await this.tenantDb.run((tx) => this.portal.orderPdf(tx, req.portal!, id));
    res.type("application/pdf").attachment(pdf.filename).send(pdf.content);
  }

  @Get("invoices")
  invoices(@Req() req: PortalRequest) {
    return this.tenantDb.run((tx) => this.portal.invoices(tx, req.portal!));
  }

  @Get("invoices/:id")
  invoice(@Req() req: PortalRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.portal.invoice(tx, req.portal!, id));
  }

  @Get("invoices/:id/pdf")
  async invoicePdf(@Req() req: PortalRequest, @Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const pdf = await this.tenantDb.run((tx) => this.portal.invoicePdf(tx, req.portal!, id));
    res.type("application/pdf").attachment(pdf.filename).send(pdf.content);
  }
}

/** Pengelolaan akses portal dari data pelanggan (user internal). */
@Controller("partners")
export class PortalAdminController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(PortalService) private readonly portal: PortalService,
  ) {}

  @Get(":id/portal")
  @RequirePermission("partner.read")
  status(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.portal.status(tx, id));
  }

  @Post(":id/portal-invite")
  @HttpCode(200)
  @RequirePermission("partner.write")
  invite(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(portalInviteSchema, body ?? {});
    return this.tenantDb.run((tx) => this.portal.invite(tx, id, input));
  }

  @Post(":id/portal-revoke")
  @HttpCode(200)
  @RequirePermission("partner.write")
  revoke(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.portal.revoke(tx, id));
  }
}

export { PortalGuard };
