import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Query,
} from "@nestjs/common";
import { and, desc, eq, lte, schema, type Db } from "@erp/db";
import { BASE_CURRENCY, convertAmount } from "@erp/shared";
import { z } from "zod";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { parse } from "../common/zod.js";

@Injectable()
export class FxService {
  /** Kurs terakhir yang berlaku pada/sebelum `date` (IDR per 1 unit). IDR selalu 1. */
  async rateOn(
    tx: Db,
    currencyCode: string,
    date: string,
  ): Promise<{ rate: string; rateDate: string | null }> {
    if (currencyCode === BASE_CURRENCY) return { rate: "1", rateDate: null };
    const [row] = await tx
      .select({ rate: schema.currencyRates.rate, rateDate: schema.currencyRates.rateDate })
      .from(schema.currencyRates)
      .where(
        and(eq(schema.currencyRates.currencyCode, currencyCode), lte(schema.currencyRates.rateDate, date)),
      )
      .orderBy(desc(schema.currencyRates.rateDate))
      .limit(1);
    if (!row) throw new NotFoundException(`Kurs ${currencyCode} pada/sebelum ${date} belum diisi`);
    return row;
  }
}

const convertQuery = z.object({
  from: z.string().length(3).toUpperCase(),
  to: z.string().length(3).toUpperCase().default(BASE_CURRENCY),
  amount: z.string().regex(/^-?\d+(\.\d+)?$/, "Jumlah tidak valid"),
  date: z
    .string()
    .date()
    .default(() => new Date().toISOString().slice(0, 10)),
});

@Controller("fx")
export class FxController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(FxService) private readonly fx: FxService,
  ) {}

  @Get("convert")
  @RequirePermission("currency.read")
  convert(@Query() query: unknown) {
    const input = parse(convertQuery, query);
    return this.tenantDb.run(async (tx) => {
      const [target] = await tx.select().from(schema.currencies).where(eq(schema.currencies.code, input.to));
      if (!target) throw new BadRequestException(`Mata uang ${input.to} tidak dikenal`);
      const from = await this.fx.rateOn(tx, input.from, input.date);
      const to = await this.fx.rateOn(tx, input.to, input.date);
      return {
        ...input,
        result: convertAmount(input.amount, from.rate, to.rate, target.decimals),
        fromRate: from,
        toRate: to,
      };
    });
  }
}
