import { BadRequestException, Module } from "@nestjs/common";
import { schema, type Db } from "@erp/db";
import { accountSchema, assetSchema, journalSchema, taxSchema } from "@erp/shared";
import { ActivityService } from "../activity/activity.service.js";
import { createCrudController } from "../common/crud.js";
import { MasterModule } from "../master/master.module.js";
import { SequenceService } from "../sequences/sequence.service.js";
import {
  AccountingController,
  MovesController,
  PaymentsController,
  ReportsController,
} from "./accounting.controller.js";
import { AssetService, validateAsset } from "./asset.service.js";
import { BankService } from "./bank.service.js";
import { BudgetService } from "./budget.service.js";
import { ClosingService } from "./closing.service.js";
import { assertCenters, assertCompanyAccounts } from "./context.js";
import { AllocationController, AllocationService, StatisticalKeysController } from "./allocation.module.js";
import {
  ControllingController,
  ControllingService,
  CostCentersController,
  ProfitCentersController,
} from "./controlling.module.js";
import {
  AssetActionsController,
  BankController,
  BudgetsController,
  ClosingAndExportController,
  FxRevaluationController,
} from "./extended.controller.js";
import { FxRevaluationService } from "./fx-revaluation.service.js";
import { MoveService } from "./move.service.js";
import { PaymentService } from "./payment.service.js";
import { ReconcileService } from "./reconcile.service.js";
import { ReportService } from "./reports.service.js";
import { AccountingScheduler, RecurringController, RecurringService } from "./recurring.module.js";

/** Akun rujukan (akun pajak, akun bawaan jurnal) harus milik perusahaan yang sama. */
const sameCompanyAccount = (field: string) => async (tx: Db, values: Record<string, unknown>) => {
  const id = values[field];
  if (typeof id === "string") {
    await assertCompanyAccounts(tx, String(values.companyId ?? ""), [{ path: field, id }]);
  }
};

const AccountsController = createCrudController({
  path: "accounts",
  model: "account",
  table: schema.accounts,
  schema: accountSchema,
  read: "accounting.read",
  write: "accounting.manage",
  searchColumns: [schema.accounts.code, schema.accounts.name],
  orderBy: schema.accounts.code,
  companyColumn: schema.accounts.companyId,
  perCompany: true,
  beforeSave: async (tx, values) => {
    await assertCenters(
      tx,
      String(values.companyId ?? ""),
      [
        {
          costCenterId: values.defaultCostCenterId as string | null | undefined,
          profitCenterId: values.defaultProfitCenterId as string | null | undefined,
        },
      ],
      "",
    );
  },
});

const JournalsController = createCrudController({
  path: "journals",
  model: "journal",
  table: schema.journals,
  schema: journalSchema,
  read: "accounting.read",
  write: "accounting.manage",
  searchColumns: [schema.journals.code, schema.journals.name],
  orderBy: schema.journals.code,
  companyColumn: schema.journals.companyId,
  perCompany: true,
  beforeSave: sameCompanyAccount("defaultAccountId"),
});

const TaxesController = createCrudController({
  path: "taxes",
  model: "tax",
  table: schema.taxes,
  schema: taxSchema,
  read: "accounting.read",
  write: "accounting.manage",
  searchColumns: [schema.taxes.name],
  orderBy: schema.taxes.name,
  companyColumn: schema.taxes.companyId,
  perCompany: true,
  beforeSave: sameCompanyAccount("accountId"),
});

/** Aset tetap: CRUD generik untuk draft; konfirmasi & penyusutan lewat AssetActionsController. */
const AssetsController = createCrudController({
  path: "assets",
  model: "asset",
  table: schema.assets,
  schema: assetSchema,
  read: "accounting.read",
  write: "accounting.write",
  searchColumns: [schema.assets.name, schema.assets.code],
  orderBy: schema.assets.name,
  companyColumn: schema.assets.companyId,
  perCompany: true,
  beforeSave: validateAsset,
  beforeDelete: async (_tx, row) => {
    if (row.state !== "draft") throw new BadRequestException("Hanya aset draft yang bisa dihapus");
  },
});

@Module({
  imports: [MasterModule],
  controllers: [
    AccountingController,
    AccountsController,
    JournalsController,
    TaxesController,
    MovesController,
    PaymentsController,
    ReportsController,
    BankController,
    AssetActionsController,
    FxRevaluationController,
    AssetsController,
    BudgetsController,
    ClosingAndExportController,
    RecurringController,
    CostCentersController,
    ProfitCentersController,
    ControllingController,
    StatisticalKeysController,
    AllocationController,
  ],
  providers: [
    ControllingService,
    AllocationService,
    ActivityService,
    SequenceService,
    MoveService,
    ReconcileService,
    PaymentService,
    ReportService,
    BankService,
    AssetService,
    BudgetService,
    ClosingService,
    FxRevaluationService,
    RecurringService,
    AccountingScheduler,
  ],
  exports: [MoveService, PaymentService, ReconcileService, AccountingScheduler, ControllingService],
})
export class AccountingModule {}
