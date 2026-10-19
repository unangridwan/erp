import { Module } from "@nestjs/common";
import { ActivityService } from "../activity/activity.service.js";
import { AccountingModule } from "../accounting/accounting.module.js";
import { MasterModule } from "../master/master.module.js";
import { PurchaseModule } from "../purchase/purchase.module.js";
import { SalesModule } from "../sales/sales.module.js";
import { IntercompanyService } from "./intercompany.service.js";

/** Aturan dokumen antar perusahaan; hanya mendaftarkan kait ke modul penjualan, pembelian & akuntansi. */
@Module({
  imports: [MasterModule, AccountingModule, SalesModule, PurchaseModule],
  providers: [ActivityService, IntercompanyService],
})
export class IntercompanyModule {}
